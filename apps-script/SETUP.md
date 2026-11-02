# 2nd Brain sync setup (about 10 minutes)

## 1. Update the script
1. Open **2nd Brain Data** (the sheet in your 2nd Brain Drive folder) → **Extensions → Apps Script**.
2. Delete what's there, paste all of `Code.gs` from this folder, **Save**.
3. Pick **setup** → **Run**. Approve access (Advanced → Go to project → Allow). It now also opens your Little Elm training plan sheet, so approve the extra access if asked.
4. **Execution log** → copy `Your 2nd Brain key: …` (same key as before if you already had one).

## 2. Publish
- First time: **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
- Already deployed: **Deploy → Manage deployments → pencil → Version: New version → Deploy**. The URL stays the same.

"Anyone" only means the URL is reachable; every request without your key is rejected. Don't share the key.

## 3. Connect each device
Open https://devaughnwoodyard.github.io/life-board/ → the small dot in the top-right corner (or **⋯ → Google sync**) → paste the URL and key → **Connect**. Phone: Safari → Share → **Add to Home Screen**.

Notes and to-dos from the old Life Board app come across on the first sync.

## What syncs
| | Where it lives |
|---|---|
| To-dos, notes, folders, habits, Spanish phrases | "Data" tab of 2nd Brain Data (newest edit wins) |
| Note files, Granola imports, summaries | Drive → 2nd Brain → Notes → Work / Personal → folder |
| Calendar | Your visible Google calendars, 2 weeks back to ~10 weeks ahead |
| Workouts | The **Ironman 70.3 Little Elm 2027 — Training Plan** sheet (planned sessions; actuals from columns E–G once the Garmin/Strava script runs there). Reloads every 3 hours or from Google sync → Reload training plan. If you make a new plan sheet, set Script Property `PLAN_SHEET_ID`. |

Calendar colors: a time in the title (e.g. "Dentist 3:30pm") = **appointment** (yellow). A person's name in the title (e.g. "Lunch with Dana") = **with people** (red). Add names the app doesn't know in **Google sync → Names**; names of your event guests are learned automatically.

## Quick capture (voice or text)
Tap the mic button (bottom right; **Ctrl/Cmd + J** on desktop):
- `To do Friday, call the dentist` · `To do [Nov 14] book flights at 7pm` · `To do tomorrow, renew passport`
- `Work note Vendor reviews, pricing came in 8% higher` → goes in the **Vendor reviews** folder if it exists, otherwise **General**. `Work note [New folder], …` creates the folder.
- `Personal note …` works the same way. Anything else becomes a to-do for Today.
- Say "comma" if the dictation doesn't add one. A toast confirms what was created, with **Undo**.

iPhone voice: works in Safari. If the home-screen app says voice isn't available, tap in the box and use the keyboard's mic key; the same commands work.

## Granola
Notes → **Import Granola** (or **⋯ → Import Granola notes**). Paste a note copied from Granola or pick exported `.md`/`.txt` files. Each becomes a note with its meeting date; the original file uploads to Drive.

Open an imported note → **Summary**: date, main topics and to-dos (with **Add** buttons), saved on the note and uploaded as `Summary - <title>.md`. For Claude-quality summaries add Script Property `ANTHROPIC_KEY` (Project Settings → Script Properties); without it the app uses its built-in summary.

## Siri
Shortcuts → **+**: **Dictate Text** → **Get Contents of URL** (your `/exec` URL, Method POST, Request Body JSON: `action` = `add`, `token` = your key, `text` = Dictated Text) → **Show Notification** "Added". Say the same commands ("To do Friday, call the dentist"); they're created on the app's next sync.

## Send the plan to Garmin (through Intervals.icu)
1. Make a free account at https://intervals.icu → **Settings** → connect **Garmin Connect** → turn on **Upload planned workouts**.
2. Intervals.icu **Settings → Developer Settings**: copy **Athlete ID** (looks like `i123456`) and **API Key**.
3. Apps Script → ⚙️ **Project Settings → Script Properties → Add**: `ICU_ATHLETE` = athlete ID, `ICU_KEY` = API key. Save.
4. Paste the latest Code.gs, **Deploy → Manage deployments → ✏️ → New version**.
5. In the app: sync dot → **Send plan to Garmin** (or run `sendPlanToGarmin` in the editor). Re-run any time the plan changes; it updates the same workouts.
On the watch: Run/Bike/Swim → Training → **Today's workout** (or Calendar). Runs use HR zones, rides use watts, swims and lifts are timed.
