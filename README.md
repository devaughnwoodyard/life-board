# Life Board

Personal week-first board: To Do / Upcoming, Week view, habits, workouts, Plan day, Close the day, notes, and voice entry. Runs offline on iPhone as a home-screen app.

**Install:** open https://devaughnwoodyard.github.io/life-board/ in Safari → Share → **Add to Home Screen**. Open it once while online; after that it works with no connection.

## Data
Stored on the device and works offline. Optional sync to your own Google Sheet via Apps Script: see `apps-script/SETUP.md`. Also enables a Siri Shortcut for quick adds.

## Not wired yet
Workout plan import, Garmin/Strava actuals, Google Calendar reminders, and Claude file processing.

## Files
- `index.html`: the whole app
- `sw.js`: offline cache (network-first for the page, so updates arrive when online)
- `manifest.webmanifest`, `icons/`: home-screen install
