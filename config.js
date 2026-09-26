// ============================================================
// CONFIGURE THESE BEFORE DEPLOYING
// ============================================================
const CONFIG = {
  // OAuth 2.0 Client ID from Google Cloud Console
  // (APIs & Services > Credentials > Create OAuth client ID > Web application)
  CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",

  // ---- Default sheet, shown the very first time the app is opened.
  // After that, sheets you add/switch to in the app are remembered in the
  // browser (localStorage), and you can edit or add more from the UI.
  DEFAULT_SHEET_LABEL: "Section A",
  DEFAULT_SPREADSHEET_ID: "16j8MJ9roVxDaYpLeK6syVE08Upp3qXqVifK-ikmrb2Y",
  DEFAULT_SHEET_NAME: "Sheet1",
  DEFAULT_LAYOUT: "normal", // "normal" or "lab" — see LAYOUT_PRESETS below

  // Warning thresholds (consecutive missed classes, counting back from the
  // most recent class before the one you're about to take). Same for every
  // section, regardless of layout.
  WARN_LEVELS: [
    { min: 1, label: "Missed last class", cls: "warn-1" },
    { min: 2, label: "Missed last 2 classes", cls: "warn-2" },
    { min: 3, label: "Missed 3+ classes", cls: "warn-3" },
  ],
};

// ============================================================
// Sheet layouts — each section you add picks one of these.
// Columns are numbered A=1, B=2, C=3, D=4, E=5 ... to match the Sheets API.
// ============================================================
const LAYOUT_PRESETS = {
  // Your original layout: serial / ID / name in A–C, one date per column
  // from D to AE, students in rows 5–44, attendance mark read from AG.
  normal: {
    type: "normal",
    label: "Normal (A–AE)",
    description: "Serial in A, ID in B, Name in C. Dates D→AE, rows 5–44. Mark read from AG.",
    serialCol: 1,   // A
    idCol: 2,       // B
    nameCol: 3,     // C
    dateRow: 4,
    firstDateCol: 4,  // D
    lastDateCol: 31,  // AE
    firstStudentRow: 5,
    lastStudentRow: 44,
    markCols: [{ label: "Mark", col: 33 }], // AG
  },

  // Matches the "7th Semester Lab" style sheet: Serial in A, ID in B, Name in
  // C, one date per column from D to Q, students in rows 5–43 (row 44 is a
  // TOTAL row), and three read-only summary columns: #Att-Total (R),
  // Att-Marks(10) (S), Percentage% (T).
  lab: {
    type: "lab",
    label: "Lab-style (D5:Q43)",
    description: "Serial in A, ID in B, Name in C. Dates D→Q, rows 5–43. Marks read from R/S/T.",
    serialCol: 1,   // A
    idCol: 2,       // B
    nameCol: 3,     // C
    dateRow: 4,
    firstDateCol: 4,  // D
    lastDateCol: 17,  // Q
    firstStudentRow: 5,
    lastStudentRow: 43,
    markCols: [
      { label: "Att", col: 18 },   // R — #Att-Total
      { label: "Marks", col: 19 }, // S — Att-Marks(10)
      { label: "%", col: 20 },     // T — Percentage%
    ],
  },
};
