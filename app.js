/* =========================================================
   Attendance Taker
   Reads roster + date headers from a Google Sheet and writes
   a single day's attendance column, refusing to overwrite a
   date that already has data. Supports switching between
   multiple section sheets (each set to a Theory or Lab class
   type, with its own date-column range and mark column),
   absence-streak warnings, and automatically finding the true
   last student row on sheets that grow past the usual size or
   have a trailing "total" row.
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
function migrateProfile(p) {
  if (!p.layout) {
    // Older saved profiles from before layouts existed — they used the
    // "normal" A–AE structure, so map them onto that preset.
    p.layout = JSON.parse(JSON.stringify(LAYOUT_PRESETS.normal));
  }
  return p;
}

function loadProfiles() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("rollcall_profiles") || "null"); } catch (e) {}
  if (stored && Array.isArray(stored) && stored.length) {
    profiles = stored.map(migrateProfile);
  } else {
    profiles = [{
      id: "default",
      label: CONFIG.DEFAULT_SHEET_LABEL || "Section A",
      spreadsheetId: CONFIG.DEFAULT_SPREADSHEET_ID,
      sheetName: CONFIG.DEFAULT_SHEET_NAME || "Sheet1",
      layout: JSON.parse(JSON.stringify(LAYOUT_PRESETS[CONFIG.DEFAULT_LAYOUT || "normal"])),
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
    const tab = document.createElement("span");
    tab.className = "sheet-tab" + (p.id === activeProfileId ? " active" : "");

    const label = document.createElement("button");
    label.type = "button";
    label.className = "sheet-tab-label";
    label.textContent = p.label;
    label.addEventListener("click", () => switchSheet(p.id));
    tab.appendChild(label);

    if (profiles.length > 1) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "sheet-tab-delete";
      del.setAttribute("aria-label", `Delete ${p.label}`);
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteProfile(p.id);
      });
      tab.appendChild(del);
    }

    wrap.appendChild(tab);
  });
}

function deleteProfile(id) {
  const p = profiles.find((x) => x.id === id);
  if (!p || profiles.length <= 1) return;
  const ok = confirm(`Remove "${p.label}" from this app? This only removes it from your browser's list — the spreadsheet itself is untouched.`);
  if (!ok) return;
  profiles = profiles.filter((x) => x.id !== id);
  persistProfiles();
  renderSheetTabs();
  if (activeProfileId === id) {
    switchSheet(profiles[0].id);
  }
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
  const layoutType = p && p.layout ? p.layout.type : "normal";
  document.querySelectorAll('input[name="layoutType"]').forEach((r) => { r.checked = r.value === layoutType; });
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
  const layoutRadio = document.querySelector('input[name="layoutType"]:checked');
  const layoutType = layoutRadio ? layoutRadio.value : "normal";
  const layout = JSON.parse(JSON.stringify(LAYOUT_PRESETS[layoutType] || LAYOUT_PRESETS.normal));

  if (!label) { el("sheetModalStatus").textContent = "Give this section a label."; return; }
  if (!spreadsheetId) { el("sheetModalStatus").textContent = "That doesn't look like a valid Google Sheet link or ID."; return; }

  if (modalMode === "add") {
    const id = "s" + Date.now();
    profiles.push({ id, label, spreadsheetId, sheetName: tab, layout });
    persistProfiles();
    closeSheetModal();
    renderSheetTabs();
    switchSheet(id);
  } else {
    const p = getActiveProfile();
    p.label = label;
    p.spreadsheetId = spreadsheetId;
    p.sheetName = tab;
    p.layout = layout;
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
// GIS access tokens expire (~1 hour) and initTokenClient always needs a
// tokenClient set up on each page load, but we can skip the *visible*
// sign-in screen: once the person has signed in once, we remember that in
// this browser and try a silent (no popup) token request automatically on
// every future visit, only falling back to the "Sign in with Google"
// button if that silent attempt doesn't succeed (e.g. consent was revoked,
// or third-party cookies are blocked).
const HAS_SIGNED_IN_KEY = "rollcall_has_signed_in";

function requestToken(promptValue) {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) reject(resp);
      else resolve(resp.access_token);
    };
    tokenClient.requestAccessToken({ prompt: promptValue });
  });
}

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
    callback: () => {}, // overridden per-call by requestToken()
  });

  el("signInBtn").addEventListener("click", async () => {
    try {
      accessToken = await requestToken("consent");
      localStorage.setItem(HAS_SIGNED_IN_KEY, "1");
      onSignedIn();
    } catch (e) {
      setDateStatus("Sign-in failed: " + (e.error || e.message || "unknown error"));
    }
  });

  el("signOutBtn").addEventListener("click", () => {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    localStorage.removeItem(HAS_SIGNED_IN_KEY);
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

  // Try to resume the session quietly, without showing the sign-in screen.
  if (localStorage.getItem(HAS_SIGNED_IN_KEY) === "1") {
    el("lede").textContent = "Signing you back in…";
    requestToken("")
      .then((token) => {
        accessToken = token;
        onSignedIn();
      })
      .catch(() => {
        // silent attempt failed (revoked, expired session, blocked cookies…) —
        // fall back to asking the person to sign in normally.
        el("lede").textContent = "Sign in with the Google account that owns the attendance spreadsheet to begin.";
      });
  }
});

// Re-authenticate silently and retry once if a request comes back
// unauthorized (expired token mid-session).
async function ensureFreshToken401Retry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!/^401/.test(e.message || "")) throw e;
    accessToken = await requestToken("");
    return fn();
  }
}


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
  return ensureFreshToken401Retry(async () => {
    const opts = Object.assign({}, options);
    opts.headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${accessToken}` });
    const res = await fetch(url, opts);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }
    return res.json();
  });
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
// `L.lastStudentRow` from the layout preset is only a starting point. We
// always scan a generous number of rows past it and use whichever row the
// last actual student is on — so a section that grows past 40+ students
// (extra rows added at the bottom) keeps working with no config changes.
const ROW_GROWTH_SCAN = 500;

async function loadRosterAndDates() {
  const p = getActiveProfile();
  const L = p.layout;

  const maxRosterCol = Math.max(L.serialCol, L.idCol, L.nameCol);
  const scanToRow = L.firstStudentRow + ROW_GROWTH_SCAN;
  const rosterRange = `${p.sheetName}!A${L.firstStudentRow}:${colToLetter(maxRosterCol)}${scanToRow}`;
  const rosterRows = await getRange(rosterRange);

  roster = [];
  let detectedLastRow = L.firstStudentRow - 1;
  for (let i = 0; i < rosterRows.length; i++) {
    const row = rosterRows[i];
    const sheetRow = L.firstStudentRow + i;
    const id = (row[L.idCol - 1] || "").toString().trim();
    const name = (row[L.nameCol - 1] || "").toString().trim();
    if (!id && !name) continue;
    roster.push({ row: sheetRow, serial: (row[L.serialCol - 1] || i + 1).toString(), id, name });
    detectedLastRow = sheetRow;
  }
  // Update the layout's lastStudentRow in memory so every other function
  // (attendance grid, marks, warnings) uses the real roster size this
  // session. Never shrink below the preset's original floor.
  L.lastStudentRow = Math.max(detectedLastRow, L.firstStudentRow);

  const firstLetter = colToLetter(L.firstDateCol);
  const lastLetter = colToLetter(L.lastDateCol);
  const dateRange = `${p.sheetName}!${firstLetter}${L.dateRow}:${lastLetter}${L.dateRow}`;
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
    const L = p.layout;
    const firstLetter = colToLetter(L.firstDateCol);
    const lastLetter = colToLetter(L.lastDateCol);
    dateHeaders = (await getRange(`${p.sheetName}!${firstLetter}${L.dateRow}:${lastLetter}${L.dateRow}`))[0] || [];

    let matchIndex = -1;
    for (let i = 0; i < dateHeaders.length; i++) {
      const parsed = parseFlexibleDate(dateHeaders[i]);
      if (parsed && dateKey(parsed) === key) { matchIndex = i; break; }
    }

    if (matchIndex === -1) {
      let emptyIndex = -1;
      const totalCols = L.lastDateCol - L.firstDateCol + 1;
      for (let i = 0; i < totalCols; i++) {
        if (!dateHeaders[i] || dateHeaders[i].toString().trim() === "") { emptyIndex = i; break; }
      }
      if (emptyIndex === -1) {
        setDateStatus(`Every date column in this section (${firstLetter}:${lastLetter}) is already used. Add more date columns in the sheet, or edit this section's layout.`);
        el("loadDateBtn").disabled = false;
        return;
      }
      currentColIndex = L.firstDateCol + emptyIndex;
      const colLetter = colToLetter(currentColIndex);
      await putRange(`${p.sheetName}!${colLetter}${L.dateRow}`, [[formatDateForSheet(dt)]]);
      dateHeaders[emptyIndex] = formatDateForSheet(dt);
      await openTakeStep();
    } else {
      currentColIndex = L.firstDateCol + matchIndex;
      const colLetter = colToLetter(currentColIndex);
      const existing = await getRange(`${p.sheetName}!${colLetter}${L.firstStudentRow}:${colLetter}${L.lastStudentRow}`);
      const hasData = existing.some((r) => r[0] !== undefined && r[0].toString().trim() !== "");
      if (hasData) {
        await showAlreadyRecorded(existing);
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
async function showAlreadyRecorded(existingValues) {
  el("alreadyDateLabel").textContent = currentDateLabel;
  showStep("alreadyStep");

  let marks = {};
  try { marks = await fetchMarks(); } catch (e) { /* non-fatal */ }

  const tbody = el("readonlyTable").querySelector("tbody");
  tbody.innerHTML = "";
  roster.forEach((s, i) => {
    const val = (existingValues[i] && existingValues[i][0]) || "";
    const present = val.toString().trim() === "1";
    const mark = marks[s.row] || "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.serial}</td>
      <td>${s.id}</td>
      <td>${s.name}</td>
      <td><span class="status-pill ${present ? "status-present" : "status-absent"}">${present ? "Present" : "Absent"}</span></td>
      <td class="mark-cell">${mark}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------- Absence-streak warnings ---------- */
async function computeWarnings() {
  const p = getActiveProfile();
  const L = p.layout;
  const WARN_LEVELS = CONFIG.WARN_LEVELS;
  const warnings = {};
  if (currentColIndex <= L.firstDateCol) return warnings;

  const heldCols = [];
  for (let c = L.firstDateCol; c < currentColIndex; c++) {
    if (dateHeaders[c - L.firstDateCol] && dateHeaders[c - L.firstDateCol].toString().trim() !== "") {
      heldCols.push(c);
    }
  }
  if (!heldCols.length) return warnings;

  const firstLetter = colToLetter(L.firstDateCol);
  const lastLetter = colToLetter(currentColIndex - 1);
  const grid = await getRange(`${p.sheetName}!${firstLetter}${L.firstStudentRow}:${lastLetter}${L.lastStudentRow}`);

  heldCols.sort((a, b) => b - a); // most recent first

  roster.forEach((s) => {
    const rowOffset = s.row - L.firstStudentRow;
    const rowValues = grid[rowOffset] || [];
    let streak = 0;
    for (const c of heldCols) {
      const colOffset = c - L.firstDateCol;
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
  let marks = {};
  try { [warnings, marks] = await Promise.all([computeWarnings(), fetchMarks()]); } catch (e) { /* non-fatal */ }

  const tbody = el("rosterTable").querySelector("tbody");
  tbody.innerHTML = "";
  roster.forEach((s) => {
    const w = warnings[s.row];
    const badge = w ? `<span class="warn-badge ${w.cls}">${w.label}</span>` : "";
    const mark = marks[s.row] || "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.serial}</td>
      <td>${s.id}</td>
      <td>${s.name}${badge}</td>
      <td class="mark-cell">${mark}</td>
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

/* ---------- Attendance mark column(s) — READ ONLY ----------
   The sheet itself calculates these (formulas). The app never writes to
   them; it only fetches the current values to display next to each
   student. The "normal" layout has one mark column; "lab" has three
   (Att-Total, Marks, Percentage), shown combined. */
async function fetchMarks() {
  const p = getActiveProfile();
  const L = p.layout;
  if (!L.markCols || !L.markCols.length) return {};

  const perCol = await Promise.all(L.markCols.map(async (m) => {
    const letter = colToLetter(m.col);
    const rows = await getRange(`${p.sheetName}!${letter}${L.firstStudentRow}:${letter}${L.lastStudentRow}`);
    return { label: m.label, rows };
  }));

  const marks = {};
  for (let r = L.firstStudentRow; r <= L.lastStudentRow; r++) {
    const offset = r - L.firstStudentRow;
    const parts = perCol.map((pc) => {
      const v = pc.rows[offset];
      return v && v[0] !== undefined ? v[0].toString().trim() : "";
    });
    if (perCol.length === 1) {
      marks[r] = parts[0];
    } else {
      marks[r] = perCol
        .map((pc, i) => (parts[i] ? `${pc.label} ${parts[i]}` : null))
        .filter(Boolean)
        .join(" · ");
    }
  }
  return marks;
}

async function submitAttendance() {
  const p = getActiveProfile();
  const L = p.layout;
  const colLetter = colToLetter(currentColIndex);

  el("submitBtn").disabled = true;
  el("takeStatus").textContent = "Checking the column is still empty…";

  try {
    const existing = await getRange(`${p.sheetName}!${colLetter}${L.firstStudentRow}:${colLetter}${L.lastStudentRow}`);
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
    for (let r = L.firstStudentRow; r <= L.lastStudentRow; r++) {
      values.push([byRow[r] !== undefined ? byRow[r] : ""]);
    }
    await putRange(`${p.sheetName}!${colLetter}${L.firstStudentRow}:${colLetter}${L.lastStudentRow}`, values);

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
