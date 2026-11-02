"""Build the 2nd Brain web app from the design mockup + the wiring layer.

usage: python3 tools/build_2b.py
Reads  src/2nd-brain-mockup.html, src/wire.css, src/wire.js
Writes index.html, sw.js, manifest.webmanifest (icons/ are reused)
"""
import hashlib, json, os, re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(root, p), encoding="utf-8").read()
app, css, js = rd("src/2nd-brain-mockup.html"), rd("src/wire.css"), rd("src/wire.js")

def must(a, b):
    global app
    assert app.count(a) == 1, ("not found exactly once", a[:70], app.count(a))
    app = app.replace(a, b)

# own storage key; mark demo content so the wiring layer starts the real app empty
must("const KEY='life-board-twenty-directions-v3'", "const KEY='second-brain-v1'")
must("if(!data?.tasks||!data?.phrases)data=seed();", "if(!data?.tasks||!data?.phrases){data=seed();data.__demo=1}")
app = app.replace('Hourly sync · preview', 'Hourly sync').replace('Google Sheet preview', 'Google Sheet')
# real page head
head = ('<title>2nd Brain</title>'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
        '<meta name="apple-mobile-web-app-title" content="2nd Brain">'
        '<link rel="manifest" href="manifest.webmanifest">'
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
        '<link rel="icon" href="icons/icon-192.png">')
must("</head>", head + "</head>")
app = app.rstrip()
if app.endswith("</html>"): app = app[:-7]
if app.endswith("</body>"): app = app[:-7]
app += "\n<style id=\"wire-css\">\n" + css + "</style>\n<script id=\"wire-js\">\n" + js + "</script>\n</body></html>\n"

build = hashlib.sha1(app.encode()).hexdigest()[:8]
app = app.replace('<title>2nd Brain</title>', '<title>2nd Brain</title><meta name="2b-build" content="' + build + '">', 1)
open(os.path.join(root, "index.html"), "w", encoding="utf-8").write(app)

sw = rd("sw.js")
sw = re.sub(r"build [0-9a-f]{8}", "build " + build, sw)
sw = re.sub(r"const CACHE = '[^']+';", "const CACHE = 'lifeboard-" + build + "';", sw)
sw = sw.replace("// Life Board service worker", "// 2nd Brain service worker")
open(os.path.join(root, "sw.js"), "w", encoding="utf-8").write(sw)

manifest = {
    "name": "2nd Brain", "short_name": "2nd Brain",
    "description": "To-dos, notes, calendar, training and habits in one place",
    "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#f3f5f9", "theme_color": "#f5f5f8",
    "icons": [
        {"src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "./icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    "shortcuts": [{"name": "Quick capture", "short_name": "Capture", "url": "./?capture=1"}],
}
open(os.path.join(root, "manifest.webmanifest"), "w").write(json.dumps(manifest, indent=2) + "\n")
print("built", build, len(app), "bytes")
