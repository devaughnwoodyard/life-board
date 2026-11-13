// 2nd Brain service worker — build 5ac7c134
// App shell: network-first for the page (so updates land when online), cache fallback offline.
// Fonts: stale-while-revalidate.
const CACHE = 'lifeboard-5ac7c134';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];

// Always fetch the shell fresh (never from the HTTP cache), so this worker's cache holds exactly its own build.
const fresh = u => fetch(new Request(u, { cache: 'reload' }));
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fresh(u).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  let upgraded = false;
  e.waitUntil(caches.keys()
    .then(keys => { const old = keys.filter(k => k.startsWith('lifeboard-') && k !== CACHE); upgraded = old.length > 0; return Promise.all(old.map(k => caches.delete(k))); })
    .then(() => self.clients.claim())
    // after an upgrade, a page opened under the previous worker may be an old build: reload it once onto this one
    .then(() => upgraded ? self.clients.matchAll({ type: 'window' }) : [])
    // not awaited: the reload's own request can only be answered once this activation has finished
    .then(list => { list.forEach(c => { try { c.navigate(c.url).catch(() => {}); } catch (x) {} }); })
    .catch(() => {}));
});

// The page: straight from the network every time (no HTTP cache, no stale copy); the saved copy is only for when you're offline.
function page(req) {
  const saved = () => caches.open(CACHE).then(c => c.match('./index.html')).then(r => r || caches.match('./index.html'));
  const net = fetch(new Request(new URL('./', self.registration.scope).href, { cache: 'no-store' })).then(res => {
    if (!res.ok) throw new Error('bad status');
    const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy));
    return res;
  });
  const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000));
  return Promise.race([net, slow]).catch(() => saved().then(r => r || net));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.searchParams.has('b')) return;   // update probe: always straight to the network, never cached

  if (req.mode === 'navigate') {
    if (url.origin === location.origin && url.searchParams.has('state')) return;   // sign-in callbacks pass through untouched
    e.respondWith(page(req));
    return;
  }
  if (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname)) return;   // never serve the page itself cache-first

  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
  }
});

// Notifications (3 AM workout, 3 PM Spanish recap) sent by your Apps Script through the Cloudflare Worker
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '2nd Brain', { body: d.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: d.tag || undefined, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate ? c.navigate(url) : null; return c.focus(); } }
    return clients.openWindow(url);
  }));
});
