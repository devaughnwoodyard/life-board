# Life Board in Google Sheets: setup (about 5 minutes)

Your sheet: https://docs.google.com/spreadsheets/d/12eJizqfpUTKF_G_6BfDf9CyDs-hBiVKGaNJUfKPNp0A/edit

1. Open the sheet. **Extensions → Apps Script**.
2. Delete what's in the editor, paste all of `Code.gs`, click **Save**.
3. Choose **setup** in the function dropdown, click **Run**, and approve access
   (Advanced → Go to project → Allow). It asks for Sheets, Calendar and triggers.
4. Go back to the sheet and reload it. You'll have ten tabs and a **Life Board** menu.

## Tabs
- **Today**: day score, streak, day load vs capacity, Knock it out, today's to-dos, today's calendar, next 7 days.
- **Tasks**: one row per task. Tick Done and the Done date fills in. Repeating tasks make their next copy. 3+ days overdue turns red.
- **Week**: this week and next, day by day, tasks plus calendar events.
- **Calendar**: your Google Calendar, refreshed every hour (and from the menu).
- **Habits**: tick boxes per day, 7- and 30-day rates, strongest/weakest/median, week over week, two charts.
- **Workouts**: planned vs actual, auto score capped at 150%, your score overrides it, 60-day summary.
- **Notes**: Personal/Work. Tick "Make it a task" and it lands in Tasks.
- **Days**: Close the day log (11:50pm automatically, or Life Board → Close the day). Feeds the streak.
- **Spanish Quiz**: Life Board → New Spanish quiz. 10 phrases from your Spanish for Life Tool sheet. Misses come back at the bottom; correct days fill the Prueba columns; every answer goes to its Quiz Log tab.
- **Settings**: day capacity, calendar range, sheet links, Siri key.

## Siri (optional)
Apps Script → **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone** → copy the `/exec` URL.
Shortcuts app → new shortcut: **Dictate Text** → **Get Contents of URL** (the URL, Method POST, Request Body JSON:
`action` = `add`, `token` = Siri key from Settings, `text` = Dictated Text) → **Show Notification**. Name it "Life Board".
"Hey Siri, Life Board" → "Task call mom tomorrow at 6pm", "Note ask Sam about QA", "Spanish dale means go for it".
