/* =========================================================
   Attendance Taker
   Reads roster + date headers from a Google Sheet and writes
   a single day's attendance column, refusing to overwrite a
   date that already has data. Supports switching between
   multiple section sheets, absence-streak warnings, and a
   running attendance-percentage column (AG).
   ========================================================= */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let tokenClient = null;
let accessToken = null;
let roster = [];        // [{row, serial, id, name}]
let dateHeaders = [];   // raw strings from row 4, index 0 = FIRST_DATE_COL
let currentColIndex = null; // absolute column number (e.g. 4 for D)
let currentDateLabel = "";
let profiles = [];      // [{id, label, spreadsheetId, sheetName}]
let activeProfileId = null;
let modalMode = "add";

const el = (id) => document.getElementById(id);

/* ---------- Column helpers ---------- */
function colToLetter(col) {
  let s = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function pad2(n) { return String(n).padStart(2, "0"); }

/* ---------- Date parsing / formatting ---------- */
// Sheet dates are written like "14-Sep-26". We also try to parse ISO and
// other common formats in case older entries used something else.
function parseFlexibleDate(str) {
  if (str === undefined || str === null) return null;
  const s = str.toString().trim();
  if (!s) return null;

  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIdx = MONTHS.findIndex((mo) => mo.toLowerCase() === m[2].toLowerCase());
    let year = parseInt(m[3], 10);
    if (m[3].length === 2) year += 2000;
    if (monthIdx >= 0) return new Date(year, monthIdx, day);
  }

  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); // ISO
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); // D/M/Y
  if (m) {
    let year = parseInt(m[3], 10);
    if (m[3].length === 2) year += 2000;
    return new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function dateKey(dt) {
  if (!dt) return null;
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function formatDateForSheet(dt) {
  return `${pad2(dt.getDate())}-${MONTHS[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
}

function prettyDate(dt) {
  return dt.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/* ---------- Sheet profiles (multi-section support) ---------- */
function loadProfiles() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("rollcall_profiles") || "null"); } catch (e) {}
  if (stored && Array.isArray(stored) && stored.length) {
    profiles = stored;
  } else {
    profiles = [{
      id: "default",
      label: CONFIG.DEFAULT_SHEET_LABEL || "Section A",
      spreadsheetId: CONFIG.DEFAULT_SPREADSHEET_ID,
      sheetName: CONFIG.DEFAULT_SHEET_NAME || "Sheet1",
    }];
    persistProfiles();
  }
  activeProfileId = localStorage.getItem("rollcall_active") || profiles[0].id;
  if (!profiles.some((p) => p.id === activeProfileId)) activeProfileId = profiles[0].id;
}

function persistProfiles() {
  localStorage.setItem("rollcall_profiles", JSON.stringify(profiles));
}

function getActiveProfile() {
  return profiles.find((p) => p.id === activeProfileId) || profiles[0];
}

function extractSpreadsheetId(input) {
  const s = (input || "").trim();
  const m = /\/d\/([a-zA-Z0-9-_]+)/.exec(s);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

function renderSheetTabs() {
  const wrap = el("sheetTabs");
  wrap.innerHTML = "";
  profiles.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "sheet-tab" + (p.id === activeProfileId ? " active" : "");
    btn.textContent = p.label;
    btn.addEventListener("click", () => switchSheet(p.id));
    wrap.appendChild(btn);
  });
}

async function switchSheet(id) {
  if (id === activeProfileId && roster.length) { showStep("dateStep"); return; }
  activeProfileId = id;
  localStorage.setItem("rollcall_active", id);
  renderSheetTabs();
  showStep("dateStep");
  setDateStatus("Loading roster…");
  const p = getActiveProfile();
  el("activeSheetLabel").textContent = `${p.label} — tab "${p.sheetName}"`;
  try {
    await loadRosterAndDates();
    setDateStatus("");
  } catch (e) {
    setDateStatus("Could not load the sheet: " + e.message);
  }
}

/* ---------- Add / edit sheet modal ---------- */
el_ready(() => {
  el("addSheetBtn").addEventListener("click", () => openSheetModal("add"));
  el("editSheetBtn").addEventListener("click", () => openSheetModal("edit"));
  el("sheetModalCancel").addEventListener("click", closeSheetModal);
  el("sheetModalSave").addEventListener("click", saveSheetModal);
  el("sheetModalRemove").addEventListener("click", removeSheetModal);
});

function openSheetModal(mode) {
  modalMode = mode;
  const p = mode === "edit" ? getActiveProfile() : null;
  el("sheetModalTitle").textContent = mode === "edit" ? "Change this section's sheet" : "Add a section sheet";
  el("sheetLabelInput").value = p ? p.label : "";
  el("sheetUrlInput").value = p ? p.spreadsheetId : "";
  el("sheetTabInput").value = p ? p.sheetName : "Sheet1";
  el("sheetModalStatus").textContent = "";
  el("sheetModalRemove").classList.toggle("hidden", !(mode === "edit" && profiles.length > 1));
  el("sheetModal").classList.remove("hidden");
}

function closeSheetModal() {
  el("sheetModal").classList.add("hidden");
}

function saveSheetModal() {
  const label = el("sheetLabelInput").value.trim();
  const idInput = el("sheetUrlInput").value.trim();
  const tab = el("sheetTabInput").value.trim() || "Sheet1";
  const spreadsheetId = extractSpreadsheetId(idInput);

  if (!label) { el("sheetModalStatus").textContent = "Give this section a label."; return; }
  if (!spreadsheetId) { el("sheetModalStatus").textContent = "That doesn't look like a valid Google Sheet link or ID."; return; }

  if (modalMode === "add") {
    const id = "s" + Date.now();
    profiles.push({ id, label, spreadsheetId, sheetName: tab });
    persistProfiles();
    closeSheetModal();
    renderSheetTabs();
    switchSheet(id);
  } else {
    const p = getActiveProfile();
    p.label = label;
    p.spreadsheetId = spreadsheetId;
    p.sheetName = tab;
    persistProfiles();
    closeSheetModal();
    renderSheetTabs();
    switchSheet(p.id);
  }
}

function removeSheetModal() {
  if (profiles.length <= 1) return;
  profiles = profiles.filter((p) => p.id !== activeProfileId);
  persistProfiles();
  closeSheetModal();
  renderSheetTabs();
  switchSheet(profiles[0].id);
}

/* ---------- tiny helper so listeners attach after DOM parse ---------- */
function el_ready(fn) {
  if (document.readyState !== "loading") fn();
  else document.addEventListener("DOMContentLoaded", fn);
}

/* ---------- Google Identity Services ---------- */
window.addEventListener("load", () => {
  loadProfiles();

  // logo: try logo.png, fall back to the diamond mark
  const logoImg = el("logoImg");
  logoImg.addEventListener("load", () => {
    logoImg.classList.remove("hidden");
    el("logoFallback").classList.add("hidden");
  });
  logoImg.addEventListener("error", () => {
    logoImg.classList.add("hidden");
    el("logoFallback").classList.remove("hidden");
  });
  logoImg.src = "logo.png";

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: async (resp) => {
      if (resp.error) {
        setDateStatus("Sign-in failed: " + resp.error);
        return;
      }
      accessToken = resp.access_token;
      onSignedIn();
    },
  });

  el("signInBtn").addEventListener("click", () => {
    tokenClient.requestAccessToken({ prompt: "consent" });
  });

  el("signOutBtn").addEventListener("click", () => {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    location.reload();
  });

  el("loadDateBtn").addEventListener("click", handleDateChosen);
  el("backFromAlready").addEventListener("click", () => showStep("dateStep"));
  el("submitBtn").addEventListener("click", submitAttendance);
  el("markAllPresent").addEventListener("click", () => setAllToggles(true));
  el("markAllAbsent").addEventListener("click", () => setAllToggles(false));
  el("takeAnotherBtn").addEventListener("click", () => {
    showStep("dateStep");
    el("dateInput").value = "";
    setDateStatus("");
  });

  el("dateInput").valueAsDate = new Date();
});

async function onSignedIn() {
  el("signInBtn").classList.add("hidden");
  el("signedInArea").classList.remove("hidden");
  el("gate").classList.add("hidden");
  el("sheetsBar").classList.remove("hidden");

  try {
    const info = await sheetsFetch(`https://www.googleapis.com/oauth2/v2/userinfo`);
    el("userEmail").textContent = info.email || "";
  } catch (e) {}

  renderSheetTabs();
  const p = getActiveProfile();
  el("activeSheetLabel").textContent = `${p.label} — tab "${p.sheetName}"`;

  showStep("dateStep");
  setDateStatus("Loading roster…");
  try {
    await loadRosterAndDates();
    setDateStatus("");
  } catch (e) {
    setDateStatus("Could not load the sheet: " + e.message);
  }
}

/* ---------- Sheets API wrapper ---------- */
async function sheetsFetch(url, options = {}) {
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${accessToken}` });
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getRange(a1Range) {
  const p = getActiveProfile();
  const url = `${SHEETS_API}/${p.spreadsheetId}/values/${encodeURIComponent(a1Range)}`;
  const data = await sheetsFetch(url);
  return data.values || [];
}

async function putRange(a1Range, values) {
  const p = getActiveProfile();
  const url = `${SHEETS_API}/${p.spreadsheetId}/values/${encodeURIComponent(a1Range)}?valueInputOption=RAW`;
  return sheetsFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range: a1Range, values }),
  });
}

/* ---------- Load roster + date row ---------- */
async function loadRosterAndDates() {
  const p = getActiveProfile();
  const { FIRST_STUDENT_ROW, LAST_STUDENT_ROW, DATE_ROW, FIRST_DATE_COL, LAST_DATE_COL } = CONFIG;

  const rosterRange = `${p.sheetName}!A${FIRST_STUDENT_ROW}:C${LAST_STUDENT_ROW}`;
  const rosterRows = await getRange(rosterRange);

  roster = [];
  for (let i = 0; i < rosterRows.length; i++) {
    const row = rosterRows[i];
    const sheetRow = FIRST_STUDENT_ROW + i;
    const id = (row[1] || "").toString().trim();
    const name = (row[2] || "").toString().trim();
    if (!id && !name) continue;
    roster.push({ row: sheetRow, serial: (row[0] || i + 1).toString(), id, name });
  }

  const firstLetter = colToLetter(FIRST_DATE_COL);
  const lastLetter = colToLetter(LAST_DATE_COL);
  const dateRange = `${p.sheetName}!${firstLetter}${DATE_ROW}:${lastLetter}${DATE_ROW}`;
  const dateRows = await getRange(dateRange);
  dateHeaders = dateRows[0] || [];
}

/* ---------- Step: date chosen ---------- */
async function handleDateChosen() {
  const raw = el("dateInput").value; // yyyy-mm-dd
  if (!raw) { setDateStatus("Pick a date first."); return; }
  const [y, mo, d] = raw.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const key = dateKey(dt);
  currentDateLabel = prettyDate(dt);

  el("loadDateBtn").disabled = true;
  setDateStatus("Checking the sheet…");

  try {
    const p = getActiveProfile();
    const { DATE_ROW, FIRST_DATE_COL, LAST_DATE_COL } = CONFIG;
    const firstLetter = colToLetter(FIRST_DATE_COL);
    const lastLetter = colToLetter(LAST_DATE_COL);
    dateHeaders = (await getRange(`${p.sheetName}!${firstLetter}${DATE_ROW}:${lastLetter}${DATE_ROW}`))[0] || [];

    let matchIndex = -1;
    for (let i = 0; i < dateHeaders.length; i++) {
      const parsed = parseFlexibleDate(dateHeaders[i]);
      if (parsed && dateKey(parsed) === key) { matchIndex = i; break; }
    }

    if (matchIndex === -1) {
      let emptyIndex = -1;
      const totalCols = LAST_DATE_COL - FIRST_DATE_COL + 1;
      for (let i = 0; i < totalCols; i++) {
        if (!dateHeaders[i] || dateHeaders[i].toString().trim() === "") { emptyIndex = i; break; }
      }
      if (emptyIndex === -1) {
        setDateStatus("Every date column in the sheet (D:AE) is already used. Extend LAST_DATE_COL in config.js and add columns in the sheet.");
        el("loadDateBtn").disabled = false;
        return;
      }
      currentColIndex = FIRST_DATE_COL + emptyIndex;
      const colLetter = colToLetter(currentColIndex);
      await putRange(`${p.sheetName}!${colLetter}${DATE_ROW}`, [[formatDateForSheet(dt)]]);
      dateHeaders[emptyIndex] = formatDateForSheet(dt);
      await openTakeStep();
    } else {
      currentColIndex = FIRST_DATE_COL + matchIndex;
      const colLetter = colToLetter(currentColIndex);
      const { FIRST_STUDENT_ROW, LAST_STUDENT_ROW } = CONFIG;
      const existing = await getRange(`${p.sheetName}!${colLetter}${FIRST_STUDENT_ROW}:${colLetter}${LAST_STUDENT_ROW}`);
      const hasData = existing.some((r) => r[0] !== undefined && r[0].toString().trim() !== "");
      if (hasData) {
        showAlreadyRecorded(existing);
      } else {
        await openTakeStep();
      }
    }
  } catch (e) {
    setDateStatus("Something went wrong: " + e.message);
  }
  el("loadDateBtn").disabled = false;
}

function setDateStatus(msg) { el("dateStatus").textContent = msg; }

/* ---------- Step: already recorded (read-only) ---------- */
function showAlreadyRecorded(existingValues) {
  el("alreadyDateLabel").textContent = currentDateLabel;
  const tbody = el("readonlyTable").querySelector("tbody");
  tbody.innerHTML = "";
  roster.forEach((s, i) => {
    const val = (existingValues[i] && existingValues[i][0]) || "";
    const present = val.toString().trim() === "1";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.serial}</td>
      <td>${s.id}</td>
      <td>${s.name}</td>
      <td><span class="status-pill ${present ? "status-present" : "status-absent"}">${present ? "Present" : "Absent"}</span></td>
    `;
    tbody.appendChild(tr);
  });
  showStep("alreadyStep");
}

/* ---------- Absence-streak warnings ---------- */
async function computeWarnings() {
  const { FIRST_DATE_COL, FIRST_STUDENT_ROW, LAST_STUDENT_ROW, WARN_LEVELS } = CONFIG;
  const warnings = {};
  if (currentColIndex <= FIRST_DATE_COL) return warnings;

  const heldCols = [];
  for (let c = FIRST_DATE_COL; c < currentColIndex; c++) {
    if (dateHeaders[c - FIRST_DATE_COL] && dateHeaders[c - FIRST_DATE_COL].toString().trim() !== "") {
      heldCols.push(c);
    }
  }
  if (!heldCols.length) return warnings;

  const p = getActiveProfile();
  const firstLetter = colToLetter(FIRST_DATE_COL);
  const lastLetter = colToLetter(currentColIndex - 1);
  const grid = await getRange(`${p.sheetName}!${firstLetter}${FIRST_STUDENT_ROW}:${lastLetter}${LAST_STUDENT_ROW}`);

  heldCols.sort((a, b) => b - a); // most recent first

  roster.forEach((s) => {
    const rowOffset = s.row - FIRST_STUDENT_ROW;
    const rowValues = grid[rowOffset] || [];
    let streak = 0;
    for (const c of heldCols) {
      const colOffset = c - FIRST_DATE_COL;
      const val = (rowValues[colOffset] || "").toString().trim();
      if (val === "1") break;
      streak++;
      if (streak >= 3) break;
    }
    if (streak > 0) {
      let level = WARN_LEVELS[0];
      for (const lvl of WARN_LEVELS) if (streak >= lvl.min) level = lvl;
      warnings[s.row] = level;
    }
  });

  return warnings;
}

/* ---------- Step: take attendance ---------- */
async function openTakeStep() {
  el("takeDateLabel").textContent = `Take attendance — ${currentDateLabel}`;
  el("takeSub").textContent = `Column ${colToLetter(currentColIndex)} in the sheet. Toggle each student, then save.`;
  el("takeStatus").textContent = "Checking recent attendance…";
  showStep("takeStep");

  let warnings = {};
  try { warnings = await computeWarnings(); } catch (e) { /* non-fatal */ }

  const tbody = el("rosterTable").querySelector("tbody");
  tbody.innerHTML = "";
  roster.forEach((s) => {
    const w = warnings[s.row];
    const badge = w ? `<span class="warn-badge ${w.cls}">${w.label}</span>` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.serial}</td>
      <td>${s.id}</td>
      <td>${s.name}${badge}</td>
      <td><input type="checkbox" class="present-toggle" data-row="${s.row}" checked /></td>
    `;
    tbody.appendChild(tr);
  });
  updateCountLabel();
  tbody.querySelectorAll(".present-toggle").forEach((cb) => cb.addEventListener("change", updateCountLabel));
  el("takeStatus").textContent = "";
}

function setAllToggles(present) {
  document.querySelectorAll(".present-toggle").forEach((cb) => (cb.checked = present));
  updateCountLabel();
}

function updateCountLabel() {
  const boxes = Array.from(document.querySelectorAll(".present-toggle"));
  const presentCount = boxes.filter((b) => b.checked).length;
  el("countLabel").textContent = `${presentCount} present · ${boxes.length - presentCount} absent · ${boxes.length} total`;
}

/* ---------- Attendance-percentage column (AG) ---------- */
async function recomputeMarks() {
  const p = getActiveProfile();
  const { FIRST_DATE_COL, LAST_DATE_COL, FIRST_STUDENT_ROW, LAST_STUDENT_ROW, MARK_COL, DATE_ROW } = CONFIG;

  const firstLetter = colToLetter(FIRST_DATE_COL);
  const lastLetter = colToLetter(LAST_DATE_COL);
  const headers = (await getRange(`${p.sheetName}!${firstLetter}${DATE_ROW}:${lastLetter}${DATE_ROW}`))[0] || [];
  const heldOffsets = [];
  for (let i = 0; i < (LAST_DATE_COL - FIRST_DATE_COL + 1); i++) {
    if (headers[i] && headers[i].toString().trim() !== "") heldOffsets.push(i);
  }

  const grid = await getRange(`${p.sheetName}!${firstLetter}${FIRST_STUDENT_ROW}:${lastLetter}${LAST_STUDENT_ROW}`);
  const values = [];
  for (let r = FIRST_STUDENT_ROW; r <= LAST_STUDENT_ROW; r++) {
    const rowValues = grid[r - FIRST_STUDENT_ROW] || [];
    let present = 0;
    heldOffsets.forEach((off) => { if ((rowValues[off] || "").toString().trim() === "1") present++; });
    const pct = heldOffsets.length ? Math.round((present / heldOffsets.length) * 1000) / 10 : 0;
    values.push([heldOffsets.length ? `${pct}%` : ""]);
  }

  const markLetter = colToLetter(MARK_COL);
  await putRange(`${p.sheetName}!${markLetter}${FIRST_STUDENT_ROW}:${markLetter}${LAST_STUDENT_ROW}`, values);
}

async function submitAttendance() {
  const p = getActiveProfile();
  const { FIRST_STUDENT_ROW, LAST_STUDENT_ROW } = CONFIG;
  const colLetter = colToLetter(currentColIndex);

  el("submitBtn").disabled = true;
  el("takeStatus").textContent = "Checking the column is still empty…";

  try {
    const existing = await getRange(`${p.sheetName}!${colLetter}${FIRST_STUDENT_ROW}:${colLetter}${LAST_STUDENT_ROW}`);
    const hasData = existing.some((r) => r[0] !== undefined && r[0].toString().trim() !== "");
    if (hasData) {
      el("takeStatus").textContent = "Attendance for this date was just saved elsewhere, so this submission was blocked to avoid overwriting it.";
      el("submitBtn").disabled = false;
      return;
    }

    el("takeStatus").textContent = "Saving…";
    const boxes = document.querySelectorAll(".present-toggle");
    const byRow = {};
    boxes.forEach((cb) => { byRow[cb.dataset.row] = cb.checked ? "1" : ""; });
    const values = [];
    for (let r = FIRST_STUDENT_ROW; r <= LAST_STUDENT_ROW; r++) {
      values.push([byRow[r] !== undefined ? byRow[r] : ""]);
    }
    await putRange(`${p.sheetName}!${colLetter}${FIRST_STUDENT_ROW}:${colLetter}${LAST_STUDENT_ROW}`, values);

    try { await recomputeMarks(); } catch (e) { /* non-fatal, marks can be refreshed later */ }

    const presentCount = Array.from(boxes).filter((b) => b.checked).length;
    el("doneMessage").textContent = `Saved attendance for ${currentDateLabel} — ${presentCount} of ${boxes.length} present.`;
    showStep("doneStep");
  } catch (e) {
    el("takeStatus").textContent = "Save failed: " + e.message;
  }
  el("submitBtn").disabled = false;
}

/* ---------- Step visibility ---------- */
function showStep(id) {
  ["gate", "dateStep", "alreadyStep", "takeStep", "doneStep"].forEach((s) => {
    el(s).classList.toggle("hidden", s !== id);
  });
}
