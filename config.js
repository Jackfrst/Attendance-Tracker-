// ============================================================
// CONFIGURE THESE FOUR VALUES BEFORE DEPLOYING
// ============================================================
const CONFIG = {
  // OAuth 2.0 Client ID from Google Cloud Console
  // (APIs & Services > Credentials > Create OAuth client ID > Web application)
  CLIENT_ID: "163116448655-u1bk1bdadu6tsmcf40lj2ceedsio8v0a.apps.googleusercontent.com",

  // The long ID in your sheet's URL:
  // https://docs.google.com/spreadsheets/d/ >>THIS PART<< /edit
  SPREADSHEET_ID: "16j8MJ9roVxDaYpLeK6syVE08Upp3qXqVifK-ikmrb2Y",

  // The tab name at the bottom of the spreadsheet (e.g. "Sheet1")
  SHEET_NAME: "CSE 4101 A",

  // Sheet layout (matches the structure you described).
  // Change these only if your sheet layout differs.
  FIRST_STUDENT_ROW: 5, // B5 = first student ID, C5 = first student name
  LAST_STUDENT_ROW: 44, // row 44 = last student
  DATE_ROW: 4, // row 4 holds the date headers
  FIRST_DATE_COL: 4, // column D = 4 (A=1, B=2, C=3, D=4...)
  LAST_DATE_COL: 31, // column AE = 31
};
