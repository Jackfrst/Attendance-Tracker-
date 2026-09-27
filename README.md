# Roll Call — Attendance Taker

A tiny static web app for taking daily attendance and saving it straight into your
Google Sheet. No backend/server — it runs entirely in the browser and talks to the
Google Sheets API using your own Google sign-in, so it deploys for free on GitHub Pages.

**How it matches your sheets:**

*Theory* (e.g. your original sheet):
- `A5:A` — serial numbers, `B5:B` — student ID, `C5:C` — student name
- `D4:AE4` — one date per column (row 4), saved as `14-Sep-26`
- `D5:AE?` — attendance grid (`1` = present, blank = absent) — rows run from 5
  down to however many students that sheet actually has
- `AG` column — attendance mark per student, next to each matching row

*Lab* (e.g. your lab-classes sheet):
- Same `A:C` roster columns
- `D4:Q4` — one date per column
- `D5:Q?` — attendance grid
- `S` column — attendance mark per student

Either way, the app **never writes to the mark column** — it only reads and displays
whatever value is already there (e.g. a percentage formula), and it automatically
finds the true last student row on each sheet, so a class with more or fewer students
than usual — and a "total" row sitting right after the last student — are both handled
without any configuration.

**Safety rule built in:** if a date column already has any attendance saved, the app
opens it in **read-only** mode showing who was present/absent, and will not let you
overwrite it. Before saving, it also re-checks the column is still empty (in case two
people submit at once).

**Multiple sections:** the app can hold several sheets (e.g. "Section A", "Section B"),
each with its own spreadsheet link, tab name, **and layout**. Switch between them with
the tabs under the header; add a new one with **+ Add section**, change the current
one's link/layout with **Change link**, or delete any tab you don't need anymore with
the **×** on it (you'll be asked to confirm — this only removes it from the app, never
touches the actual spreadsheet). These are remembered in the browser
(`localStorage`), so each device/browser you use keeps its own list — add the same
sections again on any new device or browser you take attendance from. You always need
at least one section, so the last remaining one can't be deleted.

**Two class types to choose from when adding a section:**
- **Theory** — your original layout: Serial in A, ID in B, Name in C, one date per
  column D→AE (28 possible dates), attendance mark read from column AG.
- **Lab** — matches your lab-class sheet: same Serial/ID/Name in A–C, but one date per
  column D→Q (14 possible dates), and the attendance mark read from column S instead.

Either way, students always start at row 5, and the app automatically finds wherever
the *last real student* is — however many rows that sheet has, and however a "total"
or summary row right after the last student is arranged, since that row has no ID or
name of its own and gets skipped automatically. You never need to tell the app how
many students a sheet has.

If a sheet you use is arranged differently from either of these two, tell me the exact
columns/rows and I can add a third class type.

**Absence warnings:** when you open a date to take attendance, each student who missed
recent classes gets a small badge next to their name, based on consecutive classes
missed immediately before this one: 1 missed class, 2 in a row, or 3+ in a row (each
a different color). This only looks at previously *recorded* dates — it doesn't count
class days that haven't been taken yet.

**Staying signed in:** after your first sign-in, the app remembers that in this
browser and quietly re-authenticates on every future visit — no click needed, as
long as your Google session is still active and you haven't revoked access. If that
silent attempt fails (session expired, access revoked, or third-party cookies
blocked), it falls back to showing the normal **Sign in with Google** button. **Sign
out** clears this and always asks you to sign in again next time. This only remembers
the *device/browser*, not the person — if you use a shared computer, still sign out
when you're done.

**Logo:** drop a `logo.png` file into the project folder (next to `index.html`) and it
will automatically appear in the header. If no `logo.png` is present, a plain diamond
mark is shown instead — nothing to configure either way.

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
DEFAULT_SHEET_LABEL: "Section A",
DEFAULT_SPREADSHEET_ID: "16j8MJ9roVxDaYpLeK6syVE08Upp3qXqVifK-ikmrb2Y", // already filled in
DEFAULT_SHEET_NAME: "Sheet1", // must match your actual tab name exactly
DEFAULT_LAYOUT: "normal", // "normal" = Theory, "lab" = Lab
```

This is just the **first** sheet you'll see when you open the app — add your lab
sheet, Section B, C, etc. from inside the app itself with **+ Add section** (picking
**Theory** or **Lab** there), no code changes needed for those.

The two class-type presets (`LAYOUT_PRESETS.normal` and `LAYOUT_PRESETS.lab`) at the
top of `config.js` define the columns each type uses. You shouldn't need to touch
these unless a sheet's layout is genuinely different from both — see the class-type
descriptions above for exactly what each preset expects.

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

## Adding or switching sections

- **+ Add section**: give it a label (e.g. "Lab — 3rd Year"), paste the full Google
  Sheet link (or just the ID), the tab name, and pick **Theory** or **Lab** — then
  **Save**. It's added to the tabs and becomes active immediately.
- **Change link**: edit the currently active section's link, tab, or class type
  without adding a new one — handy if you paste the wrong sheet, rename a tab, or
  picked the wrong class type by mistake.
- Click any tab to switch to that section; the roster and dates reload automatically.
- Delete a section with the **×** on its tab (you'll be asked to confirm first) — this
  only removes it from this browser's list, never touches the spreadsheet. At least
  one section always has to remain.

## Mobile

The app is fully responsive — sign-in, the section tabs, date picker, and the
roster table all adapt to a phone screen, with large tap targets for the checkboxes
and buttons. The roster table scrolls horizontally on very narrow screens instead of
squeezing columns unreadably. No extra setup needed; open the same deployed link on
your phone's browser. If you want a one-tap icon on your home screen, use your
phone browser's "Add to Home Screen" option after opening the site.

## Notes / limitations

- Theory sheets have 28 possible date columns (D→AE); lab sheets have 14 (D→Q).
  Once all of a sheet's date columns are used, extend `lastDateCol` for that layout in
  `config.js` and add matching columns in the sheet.
- Sign-in uses your own Google account's permissions — anyone you don't want
  editing the sheet shouldn't be given this app's link and sign in with an editor
  account. If several instructors share a roster, each just signs in with their own
  editor-access Google account.
- No student data is stored anywhere except your Google Sheet — the app itself has
  no database.
