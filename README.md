# Roll Call — Attendance Taker

A tiny static web app for taking daily attendance and saving it straight into your
Google Sheet. No backend/server — it runs entirely in the browser and talks to the
Google Sheets API using your own Google sign-in, so it deploys for free on GitHub Pages.

**How it matches your sheet:**
- `A5:A` — serial numbers
- `B5:B` — student ID
- `C5:C` — student name
- `D4:AE4` — one date per column (row 4)
- `D5:AE44` — attendance grid (`1` = present, blank = absent)

**Safety rule built in:** if a date column already has any attendance saved, the app
opens it in **read-only** mode and will not let you overwrite it. Before saving, it
also re-checks the column is still empty (in case two people submit at once).

---

## 1. Enable the Sheets API and get a Client ID

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a
   new project (or use an existing one).
2. **APIs & Services → Library** → search for **Google Sheets API** → click **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you have Google Workspace, then Internal is fine).
   - Fill in app name (e.g. "Roll Call"), your email, and save through the steps.
   - Under **Test users** (if the app is in "Testing" mode), add your own Google
     account email — otherwise sign-in will be blocked.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add the URL you'll deploy to, e.g.
     `https://YOUR-USERNAME.github.io` (add `http://localhost:5500` too if you want
     to test locally with a local server).
   - Click **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## 2. Share the sheet with yourself (if not already)

Just make sure the Google account you'll sign in with in the app has **Editor**
access to the spreadsheet — if it's your own sheet, this is already true.

## 3. Fill in `config.js`

Open `config.js` and set:

```js
CLIENT_ID: "your-client-id.apps.googleusercontent.com",
SPREADSHEET_ID: "16j8MJ9roVxDaYpLeK6syVE08Upp3qXqVifK-ikmrb2Y", // already filled in
SHEET_NAME: "Sheet1", // must match your actual tab name exactly
```

The row/column numbers (`FIRST_STUDENT_ROW`, `LAST_DATE_COL`, etc.) already match the
layout you described. Only change them if your sheet structure is different.

> If your class list ever grows past row 44, or you need more than 28 date columns
> (D→AE), update `LAST_STUDENT_ROW` / `LAST_DATE_COL` in `config.js` to match.

## 4. Deploy on GitHub Pages

```bash
git init
git add .
git commit -m "Attendance app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build and deployment → Source: Deploy from a
branch → Branch: main / (root)**. Your app will be live at
`https://YOUR-USERNAME.github.io/YOUR-REPO/`.

Go back to Google Cloud Console → your OAuth client → make sure this exact URL (no
trailing path) is listed under **Authorized JavaScript origins**.

## 5. Using it

1. Open the deployed link, click **Sign in with Google**, and approve access.
2. Pick the class date and click **Continue**.
   - If that date has no attendance yet, you'll see the class roster to mark.
   - If it's a brand-new date not yet in row 4, the app claims the next empty
     column and labels it with your chosen date.
   - If attendance for that date already exists, you'll see it read-only instead.
3. Toggle each student (all default to present — use **Mark all absent** to flip
   the default if that's easier for your class), then **Save attendance**.

## Notes / limitations

- The sheet only has 28 date columns (D→AE) as built — good for roughly one month:
  once all 28 are used, extend `LAST_DATE_COL` in `config.js` and add columns in
  the sheet.
- Sign-in uses your own Google account's permissions — anyone you don't want
  editing the sheet shouldn't be given this app's link and sign in with an editor
  account. If several instructors share the roster, each just signs in with their
  own editor-access Google account.
- No student data is stored anywhere except your Google Sheet — the app itself has
  no database.
