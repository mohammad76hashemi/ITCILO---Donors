# Donor & Partner Explorer

## Files

| File | What it does |
|---|---|
| `index.html` | Page structure: top bar, header, search and filters, list, profile panel, and the dialogs (login, Donor Profile Card form, My submissions, Review, Manage filters) |
| `css/styles.css` | Colours, fonts and layout of the library |
| `css/portal.css` | Top bar, forms and dialogs |
| `js/config.js` | Shared settings: filter fields and labels, default filters, SDG names |
| `js/keywords.js` | **Word lists for "Describe what you are looking for".** Add synonyms here (e.g. "aids" → Health) |
| `js/store.js` | **Data layer.** Login, submissions, approvals, profile edits and filter settings. Saves to the database when `server.py` runs, otherwise in the browser only |
| `js/app.js` | The library: loads data, search, describe box, filters, list, CSV download, profile panel and profile editor |
| `js/portal.js` | Login, the Donor Profile Card form, My submissions, admin review and Manage filters |
| `data/donors.json` | The donor profiles written by the course team |
| `img/` | Browser-tab icon |
| `server.py` | Small server (plain Python, nothing to install). Serves the site and is the database: profiles go into `data/donors.json`, everything else into `server-data/store.json` |
| `start.command` / `start.bat` | Double-click to start the server and open the site (`start.command` on Mac, `start.bat` on Windows) |

Scripts load in this order: `config.js` → `keywords.js` → `store.js` → `app.js` → `portal.js`.

## Run it on your computer

```bash
python3 server.py
```
Then open http://localhost:8000. Submissions, approvals, profile edits and filter settings are saved in `server-data/store.json` and are the same in every browser. `server-data/store.backup.json` holds the version before the last change. To let other computers on your network use it: `python3 server.py --host 0.0.0.0`.

Without the server (`python -m http.server 8000`, Live Server, or GitHub Pages) the site still works, but nothing reaches the database: a red banner says so to anyone logged in.

(Double-clicking `index.html` does not work, because the browser blocks loading `donors.json`.)

## Features

- **Describe what you are looking for.** Visitors write a sentence or paragraph ("I run an NGO working on HIV/AIDS in Africa and need a loan"). The site finds keywords from the word lists in `js/keywords.js` and from the values already in the data (including country names), shows them as chips (click a chip to ignore it), and ranks donors by how many keywords they match. A solid tag on a card = the donor has that tag; a dashed tag = the word only appears in its text. No AI is involved.
- **Describe box location.** The round search button at the bottom right opens it; a tip bubble points to it on each visit and hides itself after a few seconds.
- **Who submitted what.** The card form asks for the participant's full name and student ID (pre-filled from their last card); the email comes from the login. In Review, every card shows name, student ID and email, and the **Participants** tab lists everyone with their counts. Click a name to see all their cards with a dated history (submitted, returned with the note, resubmitted, approved, edited).
- **Select, Print and CSV.** Print and CSV appear next to the search box only after a search, a filter, a description or a selection. Tick “Select” on any cards. **Print** (next to the search box) prints the full profile of each selected organisation on a clean page; **CSV** downloads them as a spreadsheet. With nothing selected, both use every organisation currently shown.
- **Returned cards.** A participant whose card was returned sees “1 returned” in the top bar and a message on login. In “My submissions” returned cards come first, with the reviewer note and an “Edit and resubmit” button.
- **Pages.** Results show 10 organisations per page, with page numbers under the list. Change the number in `js/config.js` (`DPE.PAGE_SIZE`). A new search or filter goes back to page 1.
- **Footer text.** The data source and disclaimer come from `meta.sourceNote` and `meta.disclaimer` in `data/donors.json`. A logged-in admin can also change them with **Edit footer** at the bottom of the page; "Restore original text" goes back to the text in `donors.json`. Leave a box empty to hide that line.
- **Admin: add, edit, delete profiles.** "+ Add profile" in the top bar, and Edit / Delete in each profile. With the server running, changes are saved directly in `data/donors.json`.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Participant | student@demo.org | demo |
| Admin | admin@demo.org | demo |

Any other email with the password `demo` also logs in as a participant.

**Demo limitation:** the accounts are demo accounts and passwords are not secure, so do not put `server.py` on the public internet as it is. Without `server.py`, everything stays in one browser: to test the approval flow, log in as the participant, submit a card, log out, then log in as the admin in the same browser.

## Going live

`server.py` is enough for a classroom or a shared computer. For a public site with real accounts, replace the functions inside `js/store.js` with calls to a real backend (for example Supabase: login, a `submissions` table with a `status` column, and access rules so only admins can approve). The other files do not need to change.

## Add or edit a donor written by the course team

Edit `data/donors.json` (see the notes in the file's existing entries): unique `id`, same spelling for sectors, regions and modalities, SDGs as numbers, empty links as `""`, blank line (`\n\n`) for a new paragraph.
