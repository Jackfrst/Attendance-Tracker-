/* =========================================================
   Attendance Taker
   Reads roster + date headers from a Google Sheet and writes
   a single day's attendance column, refusing to overwrite a
   date that already has data.
   ========================================================= */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

let tokenClient = null;
let accessToken = null;
let roster = [];        // [{row, serial, id, name}]
let dateHeaders = [];   // raw strings from row 4, index 0 = FIRST_DATE_COL
let currentColIndex = null; // absolute column number (e.g. 4 for D)
let currentDateLabel = "";

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

function normalizeDate(d) {
  // Accepts a Date object or a string; returns YYYY-MM-DD or null if unparseable.
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prettyDate(iso) {
  const dt = new Date(iso + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/* ---------- Google Identity Services ---------- */
window.addEventListener("load", () => {
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
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
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

  // default date input to today
  el("dateInput").valueAsDate = new Date();
});

async function onSignedIn() {
  el("signInBtn").classList.add("hidden");
  el("signedInArea").classList.remove("hidden");
  el("gate").classList.add("hidden");

  try {
    const info = await sheetsFetch(
      `https://www.googleapis.com/oauth2/v2/userinfo`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      true
    );
    el("userEmail").textContent = info.email || "";
  } catch (e) {
    // non-fatal
  }

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
async function sheetsFetch(url, options = {}, rawUrl = false) {
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({}, opts.headers, {
    Authorization: `Bearer ${accessToken}`,
  });
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getRange(a1Range) {
  const url = `${SHEETS_API}/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(a1Range)}`;
  const data = await sheetsFetch(url);
  return data.values || [];
}

async function putRange(a1Range, values) {
  const url = `${SHEETS_API}/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(a1Range)}?valueInputOption=RAW`;
  return sheetsFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range: a1Range, values }),
  });
}

/* ---------- Load roster + date row ---------- */
async function loadRosterAndDates() {
  const { SHEET_NAME, FIRST_STUDENT_ROW, LAST_STUDENT_ROW, DATE_ROW, FIRST_DATE_COL, LAST_DATE_COL } = CONFIG;

  const rosterRange = `${SHEET_NAME}!A${FIRST_STUDENT_ROW}:C${LAST_STUDENT_ROW}`;
  const rosterRows = await getRange(rosterRange);

  roster = [];
  for (let i = 0; i < rosterRows.length; i++) {
    const row = rosterRows[i];
    const sheetRow = FIRST_STUDENT_ROW + i;
    const id = (row[1] || "").toString().trim();
    const name = (row[2] || "").toString().trim();
    if (!id && !name) continue; // skip fully blank rows
    roster.push({
      row: sheetRow,
      serial: (row[0] || i + 1).toString(),
      id,
      name,
    });
  }

  const firstLetter = colToLetter(FIRST_DATE_COL);
  const lastLetter = colToLetter(LAST_DATE_COL);
  const dateRange = `${SHEET_NAME}!${firstLetter}${DATE_ROW}:${lastLetter}${DATE_ROW}`;
  const dateRows = await getRange(dateRange);
  dateHeaders = dateRows[0] || [];
}

/* ---------- Step: date chosen ---------- */
async function handleDateChosen() {
  const raw = el("dateInput").value; // yyyy-mm-dd
  if (!raw) {
    setDateStatus("Pick a date first.");
    return;
  }
  const iso = normalizeDate(raw);
  currentDateLabel = prettyDate(iso);

  el("loadDateBtn").disabled = true;
  setDateStatus("Checking the sheet…");

  try {
    // refresh date headers in case sheet changed
    const { SHEET_NAME, DATE_ROW, FIRST_DATE_COL, LAST_DATE_COL } = CONFIG;
    const firstLetter = colToLetter(FIRST_DATE_COL);
    const lastLetter = colToLetter(LAST_DATE_COL);
    const dateRange = `${SHEET_NAME}!${firstLetter}${DATE_ROW}:${lastLetter}${DATE_ROW}`;
    dateHeaders = (await getRange(dateRange))[0] || [];

    let matchIndex = -1; // 0-based offset from FIRST_DATE_COL
    for (let i = 0; i < dateHeaders.length; i++) {
      if (normalizeDate(dateHeaders[i]) === iso) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      // look for a fully empty column to place this new date
      let emptyIndex = -1;
      const totalCols = LAST_DATE_COL - FIRST_DATE_COL + 1;
      for (let i = 0; i < totalCols; i++) {
        if (!dateHeaders[i] || dateHeaders[i].toString().trim() === "") {
          emptyIndex = i;
          break;
        }
      }
      if (emptyIndex === -1) {
        setDateStatus("Every date column in the sheet (D:AE) is already used. Extend the sheet's date range before adding more days.");
        el("loadDateBtn").disabled = false;
        return;
      }
      currentColIndex = FIRST_DATE_COL + emptyIndex;
      const colLetter = colToLetter(currentColIndex);
      // write the date header now, so the slot is reserved
      await putRange(`${SHEET_NAME}!${colLetter}${DATE_ROW}`, [[raw]]);
      await openTakeStep(false);
    } else {
      currentColIndex = FIRST_DATE_COL + matchIndex;
      // check whether this column already has attendance data
      const colLetter = colToLetter(currentColIndex);
      const { FIRST_STUDENT_ROW, LAST_STUDENT_ROW } = CONFIG;
      const existing = await getRange(`${SHEET_NAME}!${colLetter}${FIRST_STUDENT_ROW}:${colLetter}${LAST_STUDENT_ROW}`);
      const hasData = existing.some((r) => r[0] !== undefined && r[0].toString().trim() !== "");
      if (hasData) {
        showAlreadyRecorded(existing);
      } else {
        await openTakeStep(false);
      }
    }
  } catch (e) {
    setDateStatus("Something went wrong: " + e.message);
  }
  el("loadDateBtn").disabled = false;
}

function setDateStatus(msg) {
  el("dateStatus").textContent = msg;
}

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

/* ---------- Step: take attendance ---------- */
async function openTakeStep() {
  el("takeDateLabel").textContent = `Take attendance — ${currentDateLabel}`;
  el("takeSub").textContent = `Column ${colToLetter(currentColIndex)} in the sheet. Toggle each student, then save.`;

  const tbody = el("rosterTable").querySelector("tbody");
  tbody.innerHTML = "";
  roster.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.serial}</td>
      <td>${s.id}</td>
      <td>${s.name}</td>
      <td><input type="checkbox" class="present-toggle" data-row="${s.row}" checked /></td>
    `;
    tbody.appendChild(tr);
  });
  updateCountLabel();
  tbody.querySelectorAll(".present-toggle").forEach((cb) => {
    cb.addEventListener("change", updateCountLabel);
  });

  el("takeStatus").textContent = "";
  showStep("takeStep");
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

async function submitAttendance() {
  const { SHEET_NAME, FIRST_STUDENT_ROW, LAST_STUDENT_ROW } = CONFIG;
  const colLetter = colToLetter(currentColIndex);

  el("submitBtn").disabled = true;
  el("takeStatus").textContent = "Checking the column is still empty…";

  try {
    // guard against a double submission / another device saving first
    const existing = await getRange(`${SHEET_NAME}!${colLetter}${FIRST_STUDENT_ROW}:${colLetter}${LAST_STUDENT_ROW}`);
    const hasData = existing.some((r) => r[0] !== undefined && r[0].toString().trim() !== "");
    if (hasData) {
      el("takeStatus").textContent = "Attendance for this date was just saved elsewhere, so this submission was blocked to avoid overwriting it.";
      el("submitBtn").disabled = false;
      return;
    }

    el("takeStatus").textContent = "Saving…";
    const boxes = document.querySelectorAll(".present-toggle");
    // build values keyed by sheet row so gaps in roster are handled safely
    const byRow = {};
    boxes.forEach((cb) => {
      byRow[cb.dataset.row] = cb.checked ? "1" : "";
    });
    const values = [];
    for (let r = FIRST_STUDENT_ROW; r <= LAST_STUDENT_ROW; r++) {
      values.push([byRow[r] !== undefined ? byRow[r] : ""]);
    }

    await putRange(`${SHEET_NAME}!${colLetter}${FIRST_STUDENT_ROW}:${colLetter}${LAST_STUDENT_ROW}`, values);

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
