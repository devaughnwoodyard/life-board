# 2nd Brain

To-dos, notes (folders + files), Google Calendar, Little Elm training plan, habits and Spanish in one app. Mobile layout under 900px, desktop command center above. Works offline; syncs through Google Apps Script.

**Open:** https://devaughnwoodyard.github.io/life-board/ (iPhone: Safari → Share → Add to Home Screen)
**Set up sync:** `apps-script/SETUP.md`

## Build
`python3 tools/build_2b.py` → writes `index.html`, `sw.js`, `manifest.webmanifest` from:
- `src/2nd-brain-mockup.html`: the design (drop a new mockup here to restyle)
- `src/wire.js`, `src/wire.css`: sync, calendar, training plan, Drive files, quick capture (voice + commands), Granola import/summary

`src/lifeboard.html` + `tools/build_app.py` are the retired Life Board app; don't run that build (it overwrites `index.html`).
