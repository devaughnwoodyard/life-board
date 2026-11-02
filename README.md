# 2nd Brain

To-dos, notes (folders + files), Google Calendar, Little Elm training plan, habits and Spanish in one app. Glass Mosaic layout: phone under 700px, desktop above. Works offline; syncs through Google Apps Script.

**Open:** https://devaughnwoodyard.github.io/life-board/ (iPhone: Safari → Share → Add to Home Screen)
**Set up sync:** `apps-script/SETUP.md`

## Build
`python3 tools/build_2b.py` → writes `index.html`, `sw.js`, `manifest.webmanifest` from:
- `src/mockup.html`: the design (Weekline · Glass Mosaic). To restyle, drop a new mockup here and update the `must(...)` patches in the build script.
- `src/wire.js`, `src/wire.css`: sync, calendar, training plan, Drive files, quick capture (voice + commands), Granola import/summary

`src/retired/` holds the previous mockup and wiring; `src/lifeboard.html` + `tools/build_app.py` are the retired Life Board app. Don't run that build (it overwrites `index.html`).
