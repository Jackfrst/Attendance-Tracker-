// ============================================================
// CONFIGURE THESE BEFORE DEPLOYING
// ============================================================

// Column numbers: A=1, B=2, C=3, D=4 ... Q=17 ... S=19 ... AE=31, AG=33.
//
// "lastStudentRow" below is just a starting guess — the app always scans
// well past it and locks onto wherever the last real student actually is,
// so sheets with more (or fewer) than the usual number of students, and
// the "total" row some sheets have right after the last student, are both
// handled automatically. You never need to edit lastStudentRow by hand.
const LAYOUT_PRESETS = {
  // Theory sheet: serial/ID/name in A–C, one date per column D→AE,
  // attendance mark read from column AG.
  normal: {
    type: "normal",
    serialCol: 1, idCol: 2, nameCol: 3,
    firstStudentRow: 5,
    lastStudentRow: 44,
    dateRow: 4,
    firstDateCol: 4,  // D
    lastDateCol: 31,  // AE
    markCols: [{ col: 33, label: "" }], // AG
  },
  // Lab sheet: same A–C layout, but dates only run D→Q, and the
  // attendance mark is read from column S instead.
  lab: {
    type: "lab",
    serialCol: 1, idCol: 2, nameCol: 3,
    firstStudentRow: 5,
    lastStudentRow: 43,
    dateRow: 4,
    firstDateCol: 4,  // D
    lastDateCol: 17,  // Q
    markCols: [{ col: 19, label: "" }], // S
  },
};

const CONFIG = {
  // OAuth 2.0 Client ID from Google Cloud Console
  // (APIs & Services > Credentials > Create OAuth client ID > Web application)
  CLIENT_ID: "163116448655-u1bk1bdadu6tsmcf40lj2ceedsio8v0a.apps.googleusercontent.com",

  // ---- Default sheet, shown the very first time the app is opened.
  // After that, sections you add/edit/delete in the app are remembered in
  // the browser (localStorage) — this is just the starting point.
  DEFAULT_SHEET_LABEL: "Section A",
  DEFAULT_SPREADSHEET_ID: "16j8MJ9roVxDaYpLeK6syVE08Upp3qXqVifK-ikmrb2Y",
  DEFAULT_SHEET_NAME: "CSE 4101 A",
  DEFAULT_LAYOUT: "normal", // "normal" (theory) or "lab" — see LAYOUT_PRESETS above

  // Warning thresholds (consecutive missed classes, counting back from the
  // most recent class before the one you're about to take).
  WARN_LEVELS: [
    { min: 1, label: "Missed last class", cls: "warn-1" },
    { min: 2, label: "Missed last 2 classes", cls: "warn-2" },
    { min: 3, label: "Missed 3+ classes", cls: "warn-3" },
  ],
};
