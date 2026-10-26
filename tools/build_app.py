"""Build the Life Board PWA from the prototype page.

usage: python3 tools/build_app.py src/lifeboard.html .
Writes index.html, manifest.webmanifest, sw.js, icons/, README.md, .nojekyll
"""
import json, re, sys, hashlib, os
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, "icons"), exist_ok=True)
app = open(src, encoding="utf-8").read()
def must(a, b):
    global app
    assert app.count(a) == 1, a[:60]
    app = app.replace(a, b)
# real app: Field look following the phone's light/dark, empty start, own storage key
must("skin:'notes',theme:'dark',", "skin:'notes',theme:'system',")
must("  let h=`<div class=\"bsync\"><span>Garmin synced <b>${hm(S.woSync)}</b>", "  if(!S.wo.length)return `<div class=\"bsync\"><span>Not connected yet. Your plan from Google Sheets and actuals from Garmin show up here once sync is set up.</span></div>`;\n  let h=`<div class=\"bsync\"><span>Garmin synced <b>${hm(S.woSync)}</b>")
must("const KEY='lifeboard-swiss-v1';", "const KEY='lifeboard-v1';")
must("function seed(){", "function seed(){seedDemo();Object.assign(S,{tasks:[],notes:[],people:[],tags:[],closes:{},wo:[],habits:[],es:esFix({})})}\nfunction seedDemo(){")

# split the artifact page into its parts
title_m = re.search(r"<title>.*?</title>\s*", app, re.S)
body = app[title_m.end():] if title_m else app
style_m = re.search(r"<style>.*?</style>", body, re.S)
style = style_m.group(0)
body = body[:style_m.start()] + body[style_m.end():]
font_m = re.search(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^"]*">\s*', body)
font = font_m.group(0).strip()
body = body[:font_m.start()] + body[font_m.end():]

version = hashlib.sha1(app.encode()).hexdigest()[:8]

pwa_css = """<style>
/* standalone (home-screen) overrides */
html,body{margin:0;overflow:hidden;overscroll-behavior:none}
.ttl,.hint,.modes[aria-label="Look"]{display:none}
@media (max-width:520px){.ph .hd{padding-top:calc(10px + env(safe-area-inset-top,0px))}}
body{-webkit-user-select:none;user-select:none}
input,textarea{-webkit-user-select:text;user-select:text}
</style>"""

sw_reg = """<script>
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}
</script>"""

head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<title>Life Board</title>
<meta name="theme-color" content="#efe8da" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121410" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Life Board">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">
<link rel="icon" type="image/png" href="./icons/icon-192.png">
{font}
{style}
{pwa_css}
</head>
<body>
"""
html = head + body.strip() + "\n" + sw_reg + f"\n<!-- build {version} -->\n</body>\n</html>\n"
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(html)

manifest = {
    "name": "Life Board",
    "short_name": "Life Board",
    "description": "Week-first personal kanban with habits and training",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#efe8da",
    "theme_color": "#1f4d37",
    "icons": [
        {"src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "./icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
open(os.path.join(out, "manifest.webmanifest"), "w").write(json.dumps(manifest, indent=2) + "\n")

sw = f"""// Life Board service worker — build {version}
// App shell: network-first for the page (so updates land when online), cache fallback offline.
// Fonts: stale-while-revalidate.
const CACHE = 'lifeboard-{version}';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
}});

self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lifeboard-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
}});

self.addEventListener('fetch', e => {{
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {{
    e.respondWith(
      fetch(req).then(res => {{
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }}).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }}

  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {{
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {{
      const net = fetch(req).then(res => {{ c.put(req, res.clone()); return res; }}).catch(() => hit);
      return hit || net;
    }})));
    return;
  }}

  if (url.origin === location.origin) {{
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {{
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }})));
  }}
}});
"""
open(os.path.join(out, "sw.js"), "w").write(sw)

# icons: green tile, three beige board columns, one red card
BG, COL, RED = (31, 77, 55), (239, 232, 218), (184, 50, 42)
def icon(size, pad=0.0):
    im = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(im)
    s = size * (1 - 2 * pad); o = size * pad; u = s / 24.0
    P = lambda x, y: (o + x * u, o + y * u)
    for x, h in [(3, 14), (10, 10), (17, 6)]:
        d.rectangle([P(x, 4), P(x + 4.6, 4 + h)], fill=COL)
    d.rectangle([P(3, 19.6), P(7.6, 21.4)], fill=RED)
    return im
icon(180, 0.14).save(os.path.join(out, "icons", "apple-touch-icon.png"))
icon(192, 0.14).save(os.path.join(out, "icons", "icon-192.png"))
icon(512, 0.14).save(os.path.join(out, "icons", "icon-512.png"))
icon(512, 0.24).save(os.path.join(out, "icons", "icon-maskable-512.png"))

open(os.path.join(out, ".nojekyll"), "w").write("")

readme = """# Life Board

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
"""
open(os.path.join(out, "README.md"), "w").write(readme)
print("built", version, "->", out)
