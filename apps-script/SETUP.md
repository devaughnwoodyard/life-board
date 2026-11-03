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
Open https://devaughnwoodyard.github.io/life-board/ → the dot button in the header → paste the URL and key → **Connect**. Phone: Safari → Share → **Add to Home Screen**.

To-dos, notes and habits saved by the previous version come across on the first sync.

## What syncs
| | Where it lives |
|---|---|
| To-dos, notes, habits, workouts, events | "Data" tab of 2nd Brain Data (newest edit wins) |
| Note files, Granola imports, summaries | Drive → 2nd Brain → Notes → Work / Personal → folder |
| Calendar | Your visible Google calendars, 2 weeks back to ~10 weeks ahead |
| Workouts | Planned sessions from the **Ironman 70.3 Little Elm 2027 — Training Plan** sheet; completed Garmin activities from its **Activities** tab (see below). Reloads every 30 min or from Google sync → Reload training plan. New plan sheet? Set Script Property `PLAN_SHEET_ID`. |

Calendar colors: a time in the title (e.g. "Dentist 3:30pm") = **appointment** (yellow). A person's name in the title (e.g. "Lunch with Dana") = **with people** (red). Add names the app doesn't know in **Google sync → Names**; names of your event guests are learned automatically.

## Moving training sessions
Workouts tab: drag a session to another day or slot (on the phone, press and hold, then drag). Dropping onto a slot that already has a session stacks them (the sheet cell holds both, e.g. `Run + Swim`); the toast offers **Swap instead**. **⇅ Swap** flips a day's AM and PM. Editing a session's date or AM/PM also writes to the sheet. Each change rewrites that day's AM/PM, bail rule and planned run miles (AA–AH) and Planned Hrs in the plan sheet within a few seconds; offline changes wait for the next sync. The weekly summary columns (AN onward) are fixed numbers and don't recalculate when a session moves to another week.

## Quick capture (voice or text)
Tap the mic in the header, or **+** (**Ctrl/Cmd + J** on desktop):
- `To do Friday, call the dentist` · `To do [Nov 14] book flights at 7pm` · `To do tomorrow, renew passport`
- `Work note Vendor reviews, pricing came in 8% higher` → goes in the **Vendor reviews** folder if it exists, otherwise **General**. `Work note [New folder], …` creates the folder.
- `Personal note …` works the same way. `Work to do …` makes a Work to-do. Anything else becomes a Personal to-do for today.
- Say "comma" if the dictation doesn't add one. A toast confirms what was created, with **Undo**.

iPhone voice: works in Safari. If the home-screen app says voice isn't available, tap in the box and use the keyboard's mic key; the same commands work.

## Granola
Notes → the book icon next to **+**. Paste a note copied from Granola or pick exported `.md`/`.txt` files. Each becomes a note with its meeting date; the original file uploads to Drive.

Open an imported note → **Summary**: date, main topics and to-dos (with **Add** buttons), saved on the note and uploaded as `Summary - <title>.md`. For Claude-quality summaries add Script Property `ANTHROPIC_KEY` (Project Settings → Script Properties); without it the app uses its built-in summary.

## Siri
Shortcuts → **+**: **Dictate Text** → **Get Contents of URL** (your `/exec` URL, Method POST, Request Body JSON: `action` = `add`, `token` = your key, `text` = Dictated Text) → **Show Notification** "Added". Say the same commands ("To do Friday, call the dentist"); they're created on the app's next sync.

## Garmin → plan sheet (through Strava, one time, ~5 min)
Garmin Connect must already auto-upload to Strava (Garmin Connect app → Settings → Connected Apps → Strava).
1. https://www.strava.com/settings/api → create an app. Name: `2nd Brain`, Website: `https://devaughnwoodyard.github.io/life-board/`, **Authorization Callback Domain: `script.google.com`**. Copy **Client ID** and **Client Secret**.
2. Apps Script → ⚙️ **Project Settings → Script Properties → Add**: `STRAVA_ID` = Client ID, `STRAVA_SECRET` = Client Secret. Save.
3. Paste the latest Code.gs → **Save** → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
4. Pick **connectStrava** → **Run**. Open the link in the Execution log → **Authorize**. The page says "Strava connected".

After that, every hour the script copies new activities into the plan sheet's **Activities** tab and fills columns E–J on the matching day; the weekly actual-hours columns read from that tab. 2nd Brain marks a planned session done when a matching sport shows up that day. Sleep/HRV/Body Battery don't come through Strava.

## Optional: push structured workouts to the watch (Intervals.icu)
1. Make a free account at https://intervals.icu → **Settings** → connect **Garmin Connect** → turn on **Upload planned workouts**.
2. Intervals.icu **Settings → Developer Settings**: copy **Athlete ID** (looks like `i123456`) and **API Key**.
3. Apps Script → ⚙️ **Project Settings → Script Properties → Add**: `ICU_ATHLETE` = athlete ID, `ICU_KEY` = API key. Save.
4. Paste the latest Code.gs, **Deploy → Manage deployments → ✏️ → New version**.
5. In the app: sync dot → **Send plan to Garmin** (or run `sendPlanToGarmin` in the editor). Re-run any time the plan changes; it updates the same workouts.
On the watch: Run/Bike/Swim → Training → **Today's workout** (or Calendar). Runs use HR zones, rides use watts, swims and lifts are timed.

## Notifications (3 AM workout, 3 PM Spanish recap)
Needs the home-screen app (Safari › Share › Add to Home Screen), iOS 16.4+.
1. Free account at https://dash.cloudflare.com → **Workers & Pages → Create → Create Worker** → name it `2nd-brain-push` → **Deploy** → **Edit code** → replace everything with your `push-worker.js` (with SEND_KEY / VAPID keys filled in) → **Deploy**. Copy the `https://2nd-brain-push.<you>.workers.dev` URL.
2. Code.gs needs `PUSH_KEY` = the Worker's SEND_KEY (or Script Property PUSH_KEY). Paste, Save, Deploy a New version.
3. In the home-screen app: sync dot → **Notifications** → paste the Worker URL → **Turn on notifications** → Allow. A test arrives right away.
Times follow the Apps Script time zone (Project Settings › Time zone); Google runs each within its hour (3:00–3:59 AM, 3:00–3:59 PM). Tapping the workout opens Workouts; the Spanish recap opens a quiz.
