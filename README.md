# Life Board

Personal week-first board: To Do / Upcoming, Week view, habits, workouts, Plan day, Close the day, notes, and voice entry. Runs offline on iPhone as a home-screen app.

**Install:** open https://devaughnwoodyard.github.io/life-board/ in Safari → Share → **Add to Home Screen**. Open it once while online; after that it works with no connection.

## Data
Everything is stored on the device (localStorage). Nothing is sent anywhere yet. Deleting the home-screen app deletes its data.

## Not wired yet
Google Sheets sync, workout plan import, Garmin/Strava actuals and Google Calendar reminders.

## Files
- `index.html`: the whole app
- `sw.js`: offline cache (network-first for the page, so updates arrive when online)
- `manifest.webmanifest`, `icons/`: home-screen install
