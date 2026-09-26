// ============================================================
// CONFIGURE THESE BEFORE DEPLOYING
// ============================================================
const CONFIG = {
  // OAuth 2.0 Client ID from Google Cloud Console
  // (APIs & Services > Credentials > Create OAuth client ID > Web application)
  CLIENT_ID: "163116448655-u1bk1bdadu6tsmcf40lj2ceedsio8v0a.apps.googleusercontent.com",

  // ---- Default sheet, shown the very first time the app is opened.
  // After that, sheets you add/switch to in the app are remembered in the
  // browser (localStorage), and you can edit or add more from the UI.
  DEFAULT_SHEET_LABEL: "Section A",
  DEFAULT_SPREADSHEET_ID: "16j8MJ9roVxDaYpLeK6syVE08Upp3qXqVifK-ikmrb2Y",
  DEFAULT_SHEET_NAME: "Section A",

  // Sheet layout — must be identical across every section sheet you add.
  FIRST_STUDENT_ROW: 5, // B5 = first student ID, C5 = first student name
  LAST_STUDENT_ROW: 44, // row 44 = last student
  DATE_ROW: 4, // row 4 holds the date headers
  FIRST_DATE_COL: 4, // column D = 4 (A=1, B=2, C=3, D=4...)
  LAST_DATE_COL: 31, // column AE = 31
  MARK_COL: 33, // column AG — running attendance percentage per student

  // Warning thresholds (consecutive missed classes, counting back from the
  // most recent class before the one you're about to take).
  WARN_LEVELS: [
    { min: 1, label: "Missed last class", cls: "warn-1" },
    { min: 2, label: "Missed last 2 classes", cls: "warn-2" },
    { min: 3, label: "Missed 3+ classes", cls: "warn-3" },
  ],
};
