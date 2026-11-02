/* ===== 2nd Brain: real-app wiring (Glass Mosaic mockup) =====
   Runs after the mockup script. Adds: Google sync (Apps Script), Google Calendar, Little Elm training plan
   with Garmin actuals, Drive uploads, quick capture with voice + commands, Granola import + summaries. */
(() => {
'use strict';
const CFG_KEY = '2b-sync', HASH_KEY = '2b-hash', DIRTY_KEY = '2b-dirty', CAL_KEY = '2b-cal', OLD_KEY = 'second-brain-v1';
const COLLS = ['tasks', 'notes', 'habits', 'workouts', 'events'];
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let cfg = ls.get(CFG_KEY, {});
let hashes = ls.get(HASH_KEY, null);
let dirty = ls.get(DIRTY_KEY, {});
let calCache = ls.get(CAL_KEY, []);
const saveCfg = () => ls.set(CFG_KEY, cfg);
const localDay = d => day(d);
const plusDays = (iso, n) => add(iso, n);
const cap = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const TAB = t => { t = String(t || '').toLowerCase(); return t === 'work' ? 'Work' : t === 'spanish' ? 'Spanish' : 'Personal'; };
const HABITS = [['Spanish', 'Daily practice'], ['Movement', 'Move daily'], ['Mindfulness', 'Pause and reflect'], ['Gratitude', 'Name something you appreciate']];
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ICONS = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/></svg>'
};

addEventListener('error', e => { try { notify('App error: ' + (e.message || e)); } catch (x) {} });
addEventListener('unhandledrejection', e => { try { notify('App error: ' + ((e.reason && e.reason.message) || e.reason)); } catch (x) {} });
/* ---------- 1. Real app, not a preview ---------- */
let firstRun = false;
if (data.__demo) {
  firstRun = true;
  ['tasks', 'events', 'notes', 'workouts'].forEach(c => { data[c] = []; });
  data.habits = HABITS.map(([title, goal]) => ({ id: 'hab-' + slug(title), title, goal, days: [] }));
  delete data.__demo;
}
// Habits with a fixed id per title, so every device shares the same four rows.
function dedupeHabits() {
  let changed = false;
  const byTitle = {};
  data.habits.forEach(h => {
    const k = String(h.title || '').trim().toLowerCase();
    if (!byTitle[k]) { byTitle[k] = h; return; }
    const keep = byTitle[k]; keep.days = [...new Set([...(keep.days || []), ...(h.days || [])])]; changed = true;
  });
  data.habits = Object.values(byTitle);
  data.habits.forEach(h => { const want = HABITS.find(x => x[0].toLowerCase() === String(h.title || '').trim().toLowerCase()); if (want && h.id !== 'hab-' + slug(want[0])) { h.id = 'hab-' + slug(want[0]); changed = true; } });
  return changed;
}
try { dedupeHabits(); } catch (e) {}

/* ---------- 2. Change tracking + sync ---------- */
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h.toString(36); };
const syncable = (c, x) => x && x.id != null && !(c === 'workouts' && String(x.id).startsWith('gp-')) && !(c === 'events' && x.gcal);
function snapshot() {
  const out = {};
  COLLS.forEach(c => { out[c] = {}; (data[c] || []).forEach(x => { if (syncable(c, x)) out[c][x.id] = hash(JSON.stringify(x)); }); });
  return out;
}
function markChanges() {
  const now = Date.now(), cur = snapshot();
  if (hashes) COLLS.forEach(c => {
    const a = hashes[c] || {}, b = cur[c];
    for (const k in b) if (a[k] !== b[k]) dirty[c + '|' + k] = { u: now };
    for (const k in a) if (!(k in b)) dirty[c + '|' + k] = { u: now, del: 1 };
  });
  hashes = cur; ls.set(HASH_KEY, hashes); ls.set(DIRTY_KEY, dirty);
}
const _save = save;
save = function () { try { planChanges(); } catch (e) { console.warn(e); } const ok = _save(); markChanges(); schedule(); return ok; };
let timer = null, syncing = false, again = false;
function schedule(ms = 2500) { if (!cfg.url) return; clearTimeout(timer); timer = setTimeout(() => sync(), ms); }

// Fallback transport: a <script> tag (works where cross-site fetch is blocked)
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = '__2bcb' + Math.random().toString(36).slice(2), sc = document.createElement('script');
    const done = () => { delete window[cb]; sc.remove(); clearTimeout(t); };
    const t = setTimeout(() => { done(); rej(new Error('No reply from Google (blocked or old script version)')); }, 25000);
    window[cb] = j => { done(); res(j); };
    sc.onerror = () => { done(); rej(new Error('Google sent back a page instead of data. Usually Safari is signed into more than one Google account, or the URL is wrong. Open the /exec link in Safari: it should show {"ok":false,"error":"bad key"}')); };
    sc.src = url + '&callback=' + cb; document.head.appendChild(sc);
  });
}
async function api(body) {
  if (!cfg.url) throw new Error('Paste the web app URL (ends in /exec)');
  if (!cfg.token) throw new Error('Paste your key from the setup() log');
  const payload = JSON.stringify(Object.assign({}, body, { token: cfg.token }));
  let r;
  const getUrl = cfg.url + (cfg.url.includes('?') ? '&' : '?') + 'payload=' + encodeURIComponent(payload);
  if (getUrl.length < 7000) {
    try { r = await fetch(getUrl, { redirect: 'follow' }); }
    catch (e) {
      try { r = await fetch(cfg.url, { method: 'POST', body: payload, redirect: 'follow' }); }
      catch (e2) { const j = await jsonp(getUrl); if (!j.ok) throw new Error(j.error || 'Server error'); cfg.via = 'jsonp'; return j; }
    }
  } else {
    try { r = await fetch(cfg.url, { method: 'POST', body: payload, redirect: 'follow' }); }
    catch (e) { throw new Error('Could not reach the script with a large upload. Update Code.gs and deploy a new version.'); }
  }
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch (e) { throw new Error(/doGet|doPost/.test(txt) ? 'The deployment has old code: deploy a new version' : 'Unexpected reply from Google'); }
  if (!j.ok) throw new Error(j.error || 'Server error');
  return j;
}

// Rows written by earlier versions of the app use other shapes: translate them on the way in.
let oldFolders = ls.get('2b-folders', {});   // folder id → name, from the previous app's "folders" rows
function fromOldApp(c, d) {
  if (!d || typeof d !== 'object') return null;
  if (c === 'folders') { if (d.id && d.name) { oldFolders[d.id] = d.name; ls.set('2b-folders', oldFolders); } return null; }
  if (c === 'tasks') {
    if (d.src === 'gcal' || d.dropped) return null;
    if (d.category && d.repeat) return d;
    return { id: d.id, title: d.title || '(untitled)', category: /work/i.test(d.category || d.realm || d.cat || '') ? 'Work' : 'Personal', date: d.date || '', time: d.time || '', done: !!d.done || d.status === 'done', repeat: d.repeat || 'none', notes: d.notes || d.note || '' };
  }
  if (c === 'notes') {
    const tab = TAB(d.tab || (d.realm === 'work' || /work/i.test(d.cat || '') ? 'work' : 'personal'));
    let folder = d.folder || 'General';
    if (oldFolders[folder]) folder = oldFolders[folder]; else if (/^(gen-|f)[a-z0-9]+$/.test(folder) && folder !== 'General') folder = /^gen-/.test(folder) ? 'General' : folder;
    const body = d.body != null ? d.body : esc(d.text || '').replace(/\n/g, '<br>');
    return Object.assign({}, d, { tab, folder, title: d.title || plain(body).split('\n')[0].slice(0, 80) || 'Note', body, entered: d.entered || new Date(d.updated || Date.now()).toISOString(), updated: /T/.test(d.updated || '') ? d.updated : d.entered || new Date().toISOString() });
  }
  if (c === 'habits') {
    if (Array.isArray(d.days)) return d;
    const log = d.log || d.done || d.checks || {};
    return { id: d.id, title: d.title || d.name || 'Habit', goal: d.goal || d.target || '', days: Array.isArray(log) ? log : Object.keys(log).filter(k => log[k]) };
  }
  if (c === 'workouts') {
    if (String(d.id).startsWith('gp-')) return null;
    if (d.slot && d.target != null) return d;
    return { id: d.id, title: d.title || 'Session', date: d.date || today, slot: /pm/i.test(d.time || d.slot || '') ? 'PM' : 'AM', kind: cap(d.kind || 'Other'), target: Number(d.planned || d.duration || d.target) || 30, actual: d.actual != null ? Number(d.actual) : null, effort: Number(d.effort) || 4, actualEffort: d.actualEffort || null, notes: d.notes || '' };
  }
  if (c === 'events') return d.gcal ? null : d;
  return d;
}
// Spanish phrases from the previous app become notes in Spanish › Phrases (same id prefix on every device)
function phraseNote(d) {
  if (!d || !d.id || !(d.es || d.en)) return null;
  const body = '<p><b>' + esc(d.es || '') + '</b></p>' + (d.en ? '<p>' + esc(d.en) + '</p>' : '') + (d.note ? '<p>' + esc(d.note) + '</p>' : '');
  const at = d.entered || new Date().toISOString();
  return { id: 'ph-' + d.id, tab: 'Spanish', folder: 'Phrases', title: String(d.es || d.en).slice(0, 160), body, entered: at, updated: at, source: 'phrase', es: d.es || '', en: d.en || '', note: d.note || '', passes: Array.isArray(d.passes) ? d.passes : [], reviews: Array.isArray(d.reviews) ? d.reviews : [] };
}
// Local data saved by the previous app version (same device): bring it across once.
function markAllDirty() { const u = Date.now(); COLLS.forEach(c => (data[c] || []).forEach(x => { if (syncable(c, x)) dirty[c + '|' + x.id] = { u }; })); ls.set(DIRTY_KEY, dirty); }
(function migrateLocal() {
  const old = ls.get(OLD_KEY, null) || ls.get(OLD_KEY + '-backup', null);
  if (old && typeof old === 'object' && !cfg.migratedV1) {
    ls.set(OLD_KEY + '-backup', old);   // keep a copy until the next version
    (old.folders || []).forEach(f => { try { fromOldApp('folders', f); } catch (e) {} });
    ['tasks', 'notes', 'habits', 'workouts'].forEach(c => (old[c] || []).forEach(x => {
      try { const d = fromOldApp(c, x); if (!d || data[c].some(y => y.id === d.id)) return; data[c].push(d); } catch (e) { console.warn('skip', c, e); }
    }));
    (old.phrases || []).forEach(x => { try { const d = phraseNote(x); if (d && !data.notes.some(y => y.id === d.id)) data.notes.push(d); } catch (e) {} });
    try { localStorage.removeItem(OLD_KEY); } catch (e) {}
  }
  // one-time: pull everything from the Sheet again and push everything this device has
  if (!cfg.migratedV1) {
    try { dedupeHabits(); } catch (e) {}
    cfg.migratedV1 = Date.now(); cfg.since = 0; cfg.planAt = 0; saveCfg(); _save(); hashes = null; markChanges(); markAllDirty();
  }
})();

async function sync(manual) {
  if (!cfg.url) { if (manual) syncSheet(); return; }
  if (syncing) { again = true; return; }
  syncing = true; cfg.status = 'Syncing…'; paintStatus();
  try {
    markChanges();
    const sent = {};
    Object.keys(dirty).forEach(k => { if (!COLLS.includes(k.split('|')[0])) delete dirty[k]; });
    const rows = Object.entries(dirty).map(([k, v]) => {
      const i = k.indexOf('|'), c = k.slice(0, i), idv = k.slice(i + 1);
      sent[k] = v.u;
      const item = (data[c] || []).find(x => String(x.id) === idv);
      return v.del || !item ? { c, id: idv, u: v.u, del: 1 } : { c, id: idv, u: v.u, d: item };
    });
    const res = await api({ action: 'sync', since: cfg.since || 0, rows, cal: 75 });
    Object.keys(sent).forEach(k => { if (dirty[k] && dirty[k].u === sent[k]) delete dirty[k]; });
    let changed = false;
    const incoming = res.rows || [];
    incoming.filter(r => r.c === 'folders' && !r.del).forEach(r => fromOldApp('folders', r.d));
    incoming.filter(r => r.c === 'phrases').forEach(r => {
      const nid = 'ph-' + r.id, at = data.notes.findIndex(x => x.id === nid);
      if (r.del) { if (at >= 0 && data.notes[at].source === 'phrase') { data.notes.splice(at, 1); changed = true; } return; }
      if (at >= 0) return;   // already a note (and maybe edited since)
      const d = phraseNote(r.d); if (d) { data.notes.push(d); dirty['notes|' + nid] = { u: Date.now() }; changed = true; }
    });
    incoming.forEach(r => {
      if (!COLLS.includes(r.c) || dirty[r.c + '|' + r.id]) return;
      if (!r.del) { try { r.d = fromOldApp(r.c, r.d); } catch (e) { r.d = null; } if (!r.d) return; }
      const list = data[r.c] = data[r.c] || [];
      const at = list.findIndex(x => String(x.id) === String(r.id));
      if (r.del) { if (at >= 0) { list.splice(at, 1); changed = true; } }
      else if (at >= 0) { if (JSON.stringify(list[at]) !== JSON.stringify(r.d)) { list[at] = r.d; changed = true; } }
      else { list.push(r.d); changed = true; }
    });
    cfg.since = res.now;
    if (res.cal) { calCache = res.cal; ls.set(CAL_KEY, calCache); learnNames(); }
    if (applyCalendar()) changed = true;
    if (Object.keys(cfg.planQ || {}).length) setTimeout(pushPlan, 0);
    const hasPlan = (data.workouts || []).some(w => String(w.id).startsWith('gp-'));
    if (!hasPlan || Date.now() - (cfg.planAt || 0) > 30 * 60e3) { try { if (await loadPlan()) changed = true; } catch (e) { cfg.planError = e.message; } }
    if (dedupeHabits()) changed = true;
    if (changed) { _save(); hashes = null; markChanges(); if (Object.keys(dirty).length) schedule(1500); }
    (res.inbox || []).forEach(x => runCommand(x.text, { from: 'Siri' }));
    cfg.status = 'Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    cfg.lastOk = Date.now(); saveCfg();
    if (changed && !$('#modal-root').children.length) render();
    if (manual) notify('Synced with Google.');
    uploadFiles();
  } catch (e) {
    cfg.status = 'Not synced: ' + e.message; saveCfg();
    if (manual) notify('Sync failed: ' + e.message);
  } finally {
    syncing = false; paintStatus();
    if (again) { again = false; schedule(500); }
  }
}
addEventListener('online', () => sync());
const BUILD = document.querySelector('meta[name="2b-build"]')?.content || '';
let lastCheck = 0;
async function checkUpdate() {
  if (!BUILD || location.protocol !== 'https:' || Date.now() - lastCheck < 60e3) return; lastCheck = Date.now();
  try {
    const t = await (await fetch('./index.html?b=' + Date.now(), { cache: 'no-store' })).text();
    const m = t.match(/name="2b-build" content="([0-9a-f]+)"/);
    if (m && m[1] !== BUILD) {
      if ($('#modal-root').children.length) { actionToast('A new version of 2nd Brain is ready.', 'Update', () => location.reload()); return; }
      try { sessionStorage.setItem('2b-updated', m[1]); } catch (e) {}
      location.reload();
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
setTimeout(checkUpdate, 4000);
try { if (sessionStorage.getItem('2b-updated') === BUILD) { sessionStorage.removeItem('2b-updated'); setTimeout(() => notify('Updated to the latest version.'), 600); } } catch (e) {}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 5 * 60 * 1000);

/* ---------- 3. Files (IndexedDB until they reach Drive) ---------- */
const FS = (() => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('2BF', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('f', mode), q = fn(t.objectStore('f')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  return { get: k => tx('readonly', s => s.get(k)).catch(() => null), put: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => {}), del: k => tx('readwrite', s => s.delete(k)).catch(() => {}) };
})();
const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
let uploading = false;
async function uploadFiles() {
  if (uploading || !cfg.url) return; uploading = true;
  let changed = false;
  try {
    for (const n of data.notes || []) for (const f of n.files || []) {
      if (f.drive !== 'pending') continue;
      const blob = await FS.get(f.id); if (!blob) continue;
      try {
        const r = await api({ action: 'file', name: f.name, mime: f.type || 'application/octet-stream', b64: await toB64(blob), work: n.tab === 'Work', folder: n.folder || 'General' });
        Object.assign(f, { drive: 'saved', driveId: r.id, url: r.url }); changed = true;
      } catch (e) { cfg.status = 'File upload failed: ' + e.message; }
    }
  } finally { uploading = false; }
  if (changed) save();
}

/* ---------- 4. Google Calendar: people = name in title, appointment = time in title ---------- */
const COMMON_NAMES = 'aaron adam adrian alan alex alexa alexander alexis alice alicia allison amanda amber amy ana andre andrea andrew angela anna anne anthony antonio april ashley austin ava barbara ben benjamin beth betty bill blake bob brad brandon brenda brian brianna brittany brooke bruce bryan caleb cameron carl carlos carmen carol caroline carter casey catherine charles charlie chelsea chris christian christina christine christopher cindy claire cody colin connor courtney craig crystal cynthia dan dana daniel danielle dave david dawn dean deborah debra denise derek diana diane dominic donald donna doug douglas dylan ed edward elena eli elijah elizabeth ella ellen emily emma eric erica erin ethan evan eve frank gabriel gary george grace greg gregory hailey hannah harry heather helen henry holly ian isaac isabel isabella jack jackie jacob jake james jamie jane janet jared jason jasmine jay jeff jeffrey jen jenna jennifer jeremy jerry jesse jessica jill jim jimmy joan joe joel john johnny jon jonathan jordan jose joseph josh joshua joy juan judy julia julian julie justin karen kate katherine kathy katie kayla keith kelly ken kevin kim kimberly kristen kyle lara laura lauren leah lee leo liam lily linda lindsey lisa logan lori louis lucas lucy luis luke madison maggie marcus margaret maria marie mark martin mary matt matthew megan melissa mia michael michelle mike mitch molly monica morgan nancy natalie nate nathan neil nicholas nick nicole noah nolan olivia omar oscar owen paige pam pat patricia patrick paul peter phil philip rachel raj ray rebecca ricardo richard rick riley rob robert robin ron ruby russell ryan sam samantha samuel sandra sara sarah scott sean seth shannon sharon shawn sophia stacy stephanie stephen steve steven susan sydney tanya taylor teresa terry thomas tiffany tim timothy tina todd tom tony tracy travis trevor tyler valerie vanessa victor victoria vincent wayne wendy will william zach zachary priya ravi arjun anil sanjay deepak ahmed ali fatima mohammed omar yusuf wei li chen jin hiro yuki sofia mateo diego camila lucia valentina gabriela jorge miguel pedro rafael';
let NAMES = new Set();
function learnNames() {
  NAMES = new Set(COMMON_NAMES.split(' '));
  (cfg.names || '').split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean).forEach(n => NAMES.add(n));
  calCache.forEach(e => (e.people || []).forEach(p => { const first = String(p).split(/[\s@.]/)[0].toLowerCase(); if (first.length > 1) NAMES.add(first); }));
}
learnNames();
const TIME_IN_TITLE = /\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b/i;
const APPT_WORDS = /appointment|\bappt\b|dentist|doctor|\bdr\.?\s|clinic|therapy|haircut|barber|physio|\bvet\b|check-?up|massage|optometr|dermatolog|orthodont|chiro/i;
function namesInTitle(title) {
  const found = [];
  const words = String(title).match(/[A-Za-z][A-Za-z'’-]+/g) || [];
  words.forEach(w => { const k = w.toLowerCase().replace(/['’]s$/, ''); if (/^[A-Z]/.test(w) && NAMES.has(k)) found.push(w.replace(/['’]s$/, '')); });
  const m = String(title).match(/\b(?:with|w\/)\s+([A-Z][a-z]+)/); if (m && !found.includes(m[1])) found.push(m[1]);
  return found;
}
function eventKind(e) {
  if (TIME_IN_TITLE.test(e.title)) return { appt: true, people: [] };
  const who = namesInTitle(e.title);
  if (who.length) return { appt: false, people: who };
  if ((e.people || []).length) return { appt: false, people: e.people };
  if (APPT_WORDS.test(e.title)) return { appt: true, people: [] };
  return { appt: false, people: [] };
}
const addMin = (hm, m) => { if (!hm || !m) return ''; const [h, mi] = hm.split(':').map(Number); const t = h * 60 + mi + m; return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
// Google events live in data.events next to local ones (marked gcal, never synced back)
function applyCalendar() {
  const gc = calCache.map(e => {
    const k = eventKind(e);
    return { id: 'gc-' + e.id, title: e.title, date: e.date, time: e.time || '', end: addMin(e.time, e.dur), notes: e.loc || '', gcal: true, cal: e.cal || 'Google Calendar', kind: k.appt ? 'appt' : k.people.length ? 'people' : '', people: k.people };
  });
  const before = JSON.stringify(data.events.filter(e => e.gcal));
  if (before === JSON.stringify(gc)) return false;
  data.events = data.events.filter(e => !e.gcal).concat(gc);
  return true;
}
applyCalendar();

/* ---------- 5. Training plan from the Little Elm sheet (+ Garmin actuals via the Activities tab) ---------- */
const KIND = s => /run|race/i.test(s) ? 'Run' : /bike|ride|spin/i.test(s) ? 'Bike' : /swim/i.test(s) ? 'Swim' : /yoga|mobility/i.test(s) ? 'Yoga' : /upper|legs|plyo|strength/i.test(s) ? 'Strength' : '';
const ACT_KIND = s => /run/i.test(s) ? 'Run' : /ride|bike|cycl/i.test(s) ? 'Bike' : /swim/i.test(s) ? 'Swim' : /yoga|pilates|stretch|mobility/i.test(s) ? 'Yoga' : /weight|workout|strength|crossfit|hiit/i.test(s) ? 'Strength' : '';
const EFFORT = (s, kind) => /threshold|tempo|goal hm|vo2|sweet spot|race|hill/i.test(s) ? 8 : /long/i.test(s) ? 6 : kind === 'Strength' ? 6 : kind === 'Yoga' ? 2 : 4;
async function loadPlan() {
  const r = await api({ action: 'plan' });
  const prev = {}; (data.workouts || []).forEach(w => { if (String(w.id).startsWith('gp-')) prev[w.id] = w; });
  const out = [];
  (r.rows || []).forEach(p => {
    const acts = (p.acts || (p.act ? [p.act] : [])).map(a => Object.assign({ kind: ACT_KIND(String(a.sport || '')) }, a));
    [['AM', p.am], ['PM', p.pm]].forEach(([slot, s]) => {
      const sports = String((s || [])[0] || '').split(/\s*\+\s*/), sessions = String((s || [])[1] || '').split(/\s+\|\s+/), minsL = String((s || [])[2] == null ? '' : s[2]).split('+');
      const parts = sessions.length > 1 && sports.length === sessions.length ? sessions.map((x, i) => [sports[i], x, minsL[i], i]) : [[(s || [])[0], (s || [])[1], (s || [])[2], 0]];
      parts.forEach(([sport, session, mins, si]) => {
      const kind = KIND(sport || ''); if (!kind || !session) return;
      const ai = acts.findIndex(a => a.kind === kind && !a.used); const act = ai >= 0 ? acts[ai] : null; if (act) act.used = true;
      const id = 'gp-' + p.date + '-' + slot.toLowerCase() + (si ? '-' + si : ''), old = prev[id] || {};
      const target = Number(mins) || 30, mi = kind === 'Run' && Number(p.mi) ? Number(p.mi) : 0;
      out.push({
        id, title: String(session).trim().slice(0, 160), date: p.date, slot, kind, target, effort: EFFORT(session, kind),
        actual: act ? Number(act.min) || target : (old.actual != null ? old.actual : null), actualEffort: act ? old.actualEffort || null : old.actualEffort || null,
        notes: old.notes || (p.bail ? 'Bail rule: ' + p.bail : ''), plan: true, miles: mi || undefined, sport: String(sport), bail: p.bail || '', garmin: act ? { name: act.name || '', mi: act.mi || null, hr: act.hr || null } : undefined
      });
      });
    });
  });
  if (!out.length) return false;
  if (Object.keys(cfg.planQ || {}).length) return false;   // local moves not on the sheet yet: don't overwrite them
  data.workouts = (data.workouts || []).filter(w => !String(w.id).startsWith('gp-')).concat(out);
  planSnap = snapPlan();
  cfg.planAt = Date.now(); cfg.garminAt = r.synced || ''; cfg.strava = r.strava || null; delete cfg.planError; saveCfg();
  return true;
}

// Efficiency counts planned sessions that came and went without a Garmin activity as 0%.
workoutScore = function () {
  const rows = data.workouts.filter(w => w.actual !== null || (w.plan && w.date < today));
  return rows.length ? Math.round(rows.reduce((s, w) => s + Math.min((w.actual || 0) / w.target, 1) * 100, 0) / rows.length) : 0;
};

/* ---------- 5a. Workout type icons ---------- */
const SPORT_SVG = {
  Run: '<circle cx="14.5" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M10.5 11l2-3 3.5 2 2.5 3M12.5 8l-4 1-2 3M11 15l-2.5-3"/>',
  Bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5l4-7h6l3 7M9.5 9.5l3 7h-7M14 6h3l-1.5 3.5"/>',
  Swim: '<circle cx="16" cy="6" r="2"/><path d="M3 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M3 21c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M6 13l4-4 3 2 2-2"/>',
  Strength: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  Yoga: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M5 10l7 2 7-2M7 20l5-6 5 6M4 20h16"/>',
  Other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'
};
const sportIcon = k => `<svg class="sport-ic sport-${(SPORT_SVG[k] ? k : 'Other').toLowerCase()}" viewBox="0 0 24 24" aria-hidden="true">${SPORT_SVG[k] || SPORT_SVG.Other}</svg>`;
function decorateSportIcons() {
  const kindOf = id => { const w = data.workouts.find(x => x.id === id); return w && w.kind; };
  document.querySelectorAll('.session').forEach(el => { const id = el.dataset.wid || el.querySelector('[data-act="workout-edit"]')?.dataset.id; const b = el.querySelector('b'); if (id && b && !b.querySelector('.sport-ic')) b.insertAdjacentHTML('afterbegin', sportIcon(kindOf(id))); });
  document.querySelectorAll('.session-preview button[data-act="workout-log"]').forEach(el => { const b = el.querySelector('b'); if (b && !b.querySelector('.sport-ic')) b.insertAdjacentHTML('afterbegin', sportIcon(kindOf(el.dataset.id))); });
  document.querySelectorAll('.agenda-item > button[data-act="workout-edit"]').forEach(el => { const b = el.querySelector('b'); if (b && !b.querySelector('.sport-ic')) b.insertAdjacentHTML('afterbegin', sportIcon(kindOf(el.dataset.id))); });
  document.querySelectorAll('.disc-row > b').forEach(b => { if (!b.querySelector('.sport-ic')) b.insertAdjacentHTML('afterbegin', sportIcon(b.textContent.trim())); });
}

/* ---------- 5b. Moving training sessions → plan sheet ---------- */
const isPlan = w => w && String(w.id).startsWith('gp-');
const snapPlan = () => Object.fromEntries((data.workouts || []).filter(isPlan).map(w => [w.id, { date: w.date, slot: w.slot, title: w.title, target: Number(w.target), kind: w.kind }]));
let planSnap = ls.get('2b-plansnap', null) || snapPlan();
function dayRow(d) {
  const ws = data.workouts.filter(w => isPlan(w) && w.date === d);
  const cell = sl => { const l = ws.filter(x => x.slot === sl); if (!l.length) return ['', '', ''];
    return l.length === 1 ? [l[0].sport || l[0].kind, l[0].title, Number(l[0].target) || 0] : [l.map(w => w.sport || w.kind).join(' + '), l.map(w => w.title.replace(/\s+\|\s+/g, ' / ')).join(' | '), l.map(w => Number(w.target) || 0).join('+')]; };
  const run = ws.find(w => w.kind === 'Run' && w.miles), first = ws.find(w => w.slot === 'AM') || ws[0];
  return { date: d, am: cell('AM'), pm: cell('PM'), bail: (first && first.bail) || (ws.find(w => w.bail) || {}).bail || '', mi: run ? run.miles : '' };
}
function planChanges() {
  const cur = snapPlan(), dates = new Set(), changed = [];
  Object.keys(planSnap || {}).forEach(id => {
    const a = planSnap[id], b = cur[id];
    if (!b) { dates.add(a.date); return; }
    if (a.date !== b.date || a.slot !== b.slot || a.title !== b.title || a.target !== b.target || a.kind !== b.kind) { dates.add(a.date); dates.add(b.date); if (a.date !== b.date || a.slot !== b.slot) changed.push([id, a]); }
  });
  Object.keys(cur).forEach(id => { if (!planSnap[id]) dates.add(cur[id].date); });
  if (!dates.size) return;
  data.workouts.filter(w => isPlan(w) && dates.has(w.date)).forEach(w => { const a = planSnap[w.id]; if (a && (a.date !== w.date || a.slot !== w.slot)) { w.actual = null; delete w.garmin; } });
  cfg.planQ = cfg.planQ || {};
  dates.forEach(d => { cfg.planQ[d] = dayRow(d); });
  planSnap = snapPlan(); ls.set('2b-plansnap', planSnap); saveCfg();
  setTimeout(pushPlan, 300);
}
let pushing = false;
async function pushPlan() {
  const q = cfg.planQ || {}, days = Object.values(q); if (!days.length || !cfg.url || pushing) return;
  pushing = true;
  try {
    const r = await api({ action: 'planMove', days });
    days.forEach(d => { if (cfg.planQ[d.date] === d) delete cfg.planQ[d.date]; });
    cfg.planAt = 0; saveCfg();
    const busy = !$('#toast').hidden && $('#toast button'); if (!busy) notify((r.saved || []).length ? 'Training plan updated in Google Sheets.' : 'Those days aren’t in the plan sheet.');
    sync();
  } catch (e) {
    notify(/unknown|action/i.test(e.message) ? 'Saved here. To update the sheet, paste the latest Code.gs and deploy a New version.' : 'Saved here; will update the sheet on the next sync.');
  } finally { pushing = false; }
}
function moveSession(id, date, slot) {
  const w = data.workouts.find(x => x.id === id); if (!w || (w.date === date && w.slot === slot)) return;
  const from = { date: w.date, slot: w.slot };
  const there = data.workouts.filter(x => x !== w && x.date === date && x.slot === slot);
  w.date = date; w.slot = slot;
  save(); render();
  const msg = 'Moved to ' + fmtDay(date) + ' ' + slot + '.';
  if (!there.length) { notify(msg); return; }
  actionToast(msg + ' Added alongside ' + there.map(x => x.title.split(/[:(,]/)[0].trim()).join(', ') + '.', 'Swap instead', () => {
    const names = there.map(x => x.title), mine = w.title;
    const now = data.workouts.filter(x => x.date === date && x.slot === slot && names.includes(x.title) && x.title !== mine);
    if (!now.length) { notify('Couldn’t find those sessions to swap.'); return; }
    now.forEach(x => { x.date = from.date; x.slot = from.slot; }); save(); render(); notify('Swapped.');
  });
}
function swapDay(d) {
  const ws = data.workouts.filter(w => w.date === d); if (!ws.length) return;
  ws.forEach(w => { w.slot = w.slot === 'AM' ? 'PM' : 'AM'; });
  save(); render(); notify('Swapped AM and PM on ' + fmtDay(d) + '.');
}
// Drag: mouse = native drag and drop; touch = press and hold, then drag
let drag = null;
function slotAt(x, y) { const el = document.elementFromPoint(x, y); return el && el.closest('.slot[data-date]'); }
function startDrag(sess, x, y) {
  const r = sess.getBoundingClientRect(), g = sess.cloneNode(true);
  g.className += ' drag-ghost'; g.style.width = r.width + 'px'; document.body.appendChild(g);
  drag = { id: sess.dataset.wid, g, dx: x - r.left, dy: y - r.top, src: sess }; sess.classList.add('dragging'); moveDrag(x, y);
  if (navigator.vibrate) navigator.vibrate(15);
}
function moveDrag(x, y) {
  if (!drag) return; drag.g.style.transform = `translate(${x - drag.dx}px,${y - drag.dy}px)`;
  document.querySelectorAll('.slot.drop-on').forEach(s => s.classList.remove('drop-on')); const s = slotAt(x, y); if (s) s.classList.add('drop-on');
  if (y < 70) scrollBy(0, -12); else if (y > innerHeight - 110) scrollBy(0, 12);
}
function endDrag(x, y) {
  if (!drag) return; const d = drag; drag = null; d.g.remove(); d.src.classList.remove('dragging');
  document.querySelectorAll('.slot.drop-on').forEach(s => s.classList.remove('drop-on'));
  const s = x == null ? null : slotAt(x, y); if (s) moveSession(d.id, s.dataset.date, s.dataset.slot);
}
let press = null;
document.addEventListener('pointerdown', e => {
  const sess = e.target.closest('.session[data-wid]'); if (!sess || e.target.closest('button') && e.pointerType === 'mouse') return;
  if (e.pointerType === 'mouse') return;   // mouse uses native drag
  press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { startDrag(sess, press.x, press.y); }, 350) };
});
document.addEventListener('pointermove', e => { if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null; } if (press) { press.x = e.clientX; press.y = e.clientY; } if (drag) moveDrag(e.clientX, e.clientY); });
document.addEventListener('pointerup', e => { if (press) { clearTimeout(press.t); press = null; } if (drag) { e.preventDefault(); endDrag(e.clientX, e.clientY); } });
document.addEventListener('pointercancel', () => { if (press) { clearTimeout(press.t); press = null; } if (drag) endDrag(null); });
document.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('click', e => { if (e.target.closest('.session.dragging')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
document.addEventListener('contextmenu', e => { if (e.target.closest('.session[data-wid]')) e.preventDefault(); });
document.addEventListener('dragstart', e => { const sess = e.target.closest && e.target.closest('.session[data-wid]'); if (!sess) return; e.dataTransfer.setData('text/x-wid', sess.dataset.wid); e.dataTransfer.effectAllowed = 'move'; sess.classList.add('dragging'); });
document.addEventListener('dragend', e => { document.querySelectorAll('.session.dragging,.slot.drop-on').forEach(x => x.classList.remove('dragging', 'drop-on')); });
document.addEventListener('dragover', e => { const s = e.target.closest && e.target.closest('.slot[data-date]'); if (s && [...e.dataTransfer.types].includes('text/x-wid')) { e.preventDefault(); document.querySelectorAll('.slot.drop-on').forEach(x => x !== s && x.classList.remove('drop-on')); s.classList.add('drop-on'); } });
document.addEventListener('drop', e => { const s = e.target.closest && e.target.closest('.slot[data-date]'); const id = e.dataTransfer.getData('text/x-wid'); if (!s || !id) return; e.preventDefault(); e.stopImmediatePropagation(); s.classList.remove('drop-on'); moveSession(id, s.dataset.date, s.dataset.slot); }, true);

// Habit efficiency: the 7 full days before today (today doesn't count until it's over)
habitScore = function () {
  const ds = Array.from({ length: 7 }, (_, i) => add(today, -(i + 1)));
  return data.habits.length ? Math.round(data.habits.reduce((n, h) => n + ds.filter(d => (h.days || []).includes(d)).length, 0) / (data.habits.length * 7) * 100) : 0;
};

/* ---------- 6. Quick capture: commands + voice ---------- */
const WD = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const DATEISH = /^(today|tonight|tomorrow|tmrw|next week|in \d+ days?|(next |this )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?(,? \d{4})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{2}-\d{2})$/i;
function parseDay(phrase) {
  let p = String(phrase || '').toLowerCase().trim().replace(/^(on|for|by|due)\s+/, '').replace(/[.!]$/, '').trim();
  if (!DATEISH.test(p)) return '';
  if (p === 'today' || p === 'tonight') return today;
  if (p === 'tomorrow' || p === 'tmrw') return plusDays(today, 1);
  if (p === 'next week') return plusDays(today, 7);
  let m = p.match(/^in (\d+) days?$/); if (m) return plusDays(today, Number(m[1]));
  m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return p;
  m = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) { let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : new Date().getFullYear(); const d = new Date(y, Number(m[1]) - 1, Number(m[2])); if (!m[3] && localDay(d) < plusDays(today, -60)) d.setFullYear(y + 1); return localDay(d); }
  m = p.match(/^(next |this )?([a-z]+)$/);
  if (m) { const wd = WD[m[2].slice(0, 4)] ?? WD[m[2].slice(0, 3)]; if (wd == null) return ''; const now = date(today); let diff = (wd - now.getDay() + 7) % 7; if (diff === 0 && m[1] !== 'this ') diff = 7; if (m[1] === 'next ' && diff < 7) diff += 7; return plusDays(today, diff); }
  m = p.replace(/(\d)(st|nd|rd|th)\b/, '$1').replace(/,/g, '').replace(/\bsept\b/, 'sep').match(/^([a-z]+)\.? (\d{1,2})(?: (\d{4}))?$/);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3)); if (mo < 0) return ''; let y = m[3] ? Number(m[3]) : new Date().getFullYear(); const d = new Date(y, mo, Number(m[2])); if (!m[3] && localDay(d) < plusDays(today, -60)) d.setFullYear(y + 1); return localDay(d); }
  return '';
}
function splitDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^\[([^\]]+)\][\s,:-]*(.*)$/s);
  if (m) { const d = parseDay(m[1]); return { date: d, text: m[2].trim() || m[1] }; }
  const c = s.indexOf(',');
  if (c > 0) { const d = parseDay(s.slice(0, c)); if (d) return { date: d, text: s.slice(c + 1).trim() }; }
  const words = s.split(/\s+/);
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) { const d = parseDay(words.slice(0, k).join(' ')); if (d) return { date: d, text: words.slice(k).join(' ').replace(/^[,:-]\s*/, '') }; }
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) { const tail = words.slice(-k).join(' '); if (!/^(on|by|for|due|this|next|today|tonight|tomorrow|tmrw|sun|mon|tue|wed|thu|fri|sat)/i.test(tail)) continue; const d = parseDay(tail); if (d) return { date: d, text: words.slice(0, -k).join(' ').replace(/[,\s]+$/, '') }; }
  return { date: '', text: s };
}
function takeTime(text) {
  const m = text.match(/\s*\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
  if (!m) return { text, time: '' };
  let h = Number(m[1]); const mi = m[2] || '00', ap = (m[3] || '').toLowerCase()[0];
  if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0; if (!ap && h < 7) h += 12;
  if (h > 23) return { text, time: '' };
  return { text: text.replace(m[0], '').trim(), time: String(h).padStart(2, '0') + ':' + mi };
}
const foldersOf = tab => [...new Set(data.notes.filter(n => n.tab === tab).map(n => n.folder))];
function findFolder(tab, name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return '';
  const fs = foldersOf(tab);
  return fs.find(f => f.toLowerCase() === n) || fs.find(f => f.toLowerCase().startsWith(n)) || fs.find(f => n.startsWith(f.toLowerCase())) || '';
}
function splitFolder(s, tab) {
  s = String(s || '').trim();
  let m = s.match(/^\[([^\]]+)\][\s,:-]*(.*)$/s) || s.match(/^(?:in\s+)?folder\s+([^,:]+)[,:]\s*(.*)$/is);
  if (m) return { folder: findFolder(tab, m[1]) || cap(m[1].trim().slice(0, 60)), text: m[2].trim() };
  const c = s.search(/[,:]/);
  if (c > 0 && c < 60) { const f = findFolder(tab, s.slice(0, c)); if (f) return { folder: f, text: s.slice(c + 1).trim() }; }
  return { folder: 'General', text: s };
}
function normalizeSpoken(t) {
  return String(t || '').trim()
    .replace(/\s*\b(comma)\b\s*/gi, ', ').replace(/\s*\b(colon)\b\s*/gi, ': ')
    .replace(/\s*\b(period|full stop)\b\s*/gi, '. ').replace(/\s*\bnew line\b\s*/gi, '\n')
    .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
}
const fmtDay = d => d ? fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
function actionToast(msg, label, fn) {
  const t = $('#toast'); t.innerHTML = esc(msg) + ' <button type="button">' + esc(label) + '</button>'; t.hidden = false;
  t.querySelector('button').onclick = () => { t.hidden = true; fn(); };
  clearTimeout(window.__2bToast); clearTimeout(toastTimer); window.__2bToast = setTimeout(() => { t.hidden = true; }, 8000);
}
function undoToast(msg, undo) {
  const t = $('#toast'); t.innerHTML = esc(msg) + ' <button type="button" data-2b="undo">Undo</button>'; t.hidden = false;
  t.querySelector('button').onclick = () => { undo(); t.hidden = true; };
  clearTimeout(window.__2bToast); window.__2bToast = setTimeout(() => { t.hidden = true; }, 6000);
}
function runCommand(raw, opt = {}) {
  const t = normalizeSpoken(raw); if (!t) return null;
  let m = t.match(/^(work|personal|spanish)\s+notes?\b[\s,:.-]*(.*)$/is) || t.match(/^(note)\b[\s,:.-]*(.*)$/is);
  if (m) {
    const tab = TAB(m[1] === 'note' ? 'personal' : m[1]);
    const { folder, text } = splitFolder(m[2], tab);
    if (!text) { notify('Say what the note should say after the folder.'); return null; }
    const first = text.split(/(?<=[.!?])\s|\n/)[0];
    const title = cap((first.length > 70 ? first.slice(0, 67).trim() + '…' : first).replace(/[.]$/, ''));
    const now = new Date().toISOString();
    const n = { id: uid(), title, tab, folder, body: '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>', entered: now, updated: now, lastOpened: now, source: opt.from ? 'capture-' + opt.from : 'capture' };
    data.notes.unshift(n); save(); if (!$('#modal-root').children.length) render();
    undoToast(`${tab} note saved in ${folder}${opt.from ? ' (from ' + opt.from + ')' : ''}.`, () => { data.notes = data.notes.filter(x => x !== n); save(); render(); });
    return n;
  }
  m = t.match(/^(?:spanish|espa[nñ]ol)(?:\s+phrase)?\b[\s,:.-]*(.*)$/is);
  if (m) { const sp = splitPhrase(m[1]); return addPhrase(sp.es, sp.en, '', opt.from); }
  m = t.match(/^(work\s+)?(?:to[\s-]?dos?|todo|task|reminder)\b[\s,:.-]*(.*)$/is);
  const body = m ? m[2] : t;
  let { date: d, text } = splitDate(body);
  const tm = takeTime(text); text = tm.text.replace(/^[,:\-\s]+|[,\s]+$/g, '');
  if (!text) { notify('Say what the to-do is after the date.'); return null; }
  const category = (m && m[1]) || /^work\b/i.test(t) ? 'Work' : 'Personal';
  const task = { id: uid(), title: cap(text), category, date: d || today, time: tm.time, done: false, repeat: 'none', notes: opt.from ? 'From ' + opt.from : '' };
  data.tasks.unshift(task); save(); if (!$('#modal-root').children.length) render();
  undoToast(`To-do added for ${d ? fmtDay(d) : 'today'}${tm.time ? ' at ' + tm.time : ''}${opt.from ? ' (from ' + opt.from + ')' : ''}.`, () => { data.tasks = data.tasks.filter(x => x !== task); save(); render(); });
  return task;
}

let rec = null, listening = false, base = '';
function micButton() { return document.querySelector('[data-2b="mic"]'); }
function setMic(on, msg) {
  listening = on; const b = micButton(); const st = document.getElementById('cap-status');
  if (b) { b.classList.toggle('listening', on); b.innerHTML = (on ? ICONS.stop : ICONS.mic) + (on ? 'Stop' : 'Speak'); }
  if (st && msg != null) st.textContent = msg;
}
function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } setMic(false); }
function startMic() {
  const ta = document.getElementById('cap-text');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { ta.focus(); setMic(false, 'Use the microphone key on your keyboard to dictate.'); return; }
  base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = !isIOS; rec.maxAlternatives = 1;
  rec.onstart = () => setMic(true, 'Listening… try “To do Friday, call the dentist”.');
  rec.onresult = e => { let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript; ta.value = base + normalizeSpoken(txt); };
  rec.onerror = e => {
    const msg = e.error === 'not-allowed' ? 'Microphone is blocked. Allow it in Settings › Safari › Microphone (or the site settings), or use the keyboard mic.'
      : e.error === 'service-not-allowed' ? 'Voice isn’t available here. Tap in the box and use the keyboard’s mic key instead.'
      : e.error === 'no-speech' ? 'Didn’t catch that. Tap Speak and try again.' : 'Voice stopped: ' + e.error;
    setMic(false, msg); if (e.error === 'service-not-allowed') ta.focus();
  };
  rec.onend = () => { setMic(false, ta.value.trim() ? 'Check it, then tap Add.' : null); };
  try { rec.start(); } catch (e) { setMic(false, 'Could not start the mic. Use the keyboard mic.'); ta.focus(); }
}
function captureSheet(autoMic) {
  modal('Quick capture', `<div class="cap">
    <textarea id="cap-text" rows="4" placeholder="To do Friday, call the dentist&#10;Work note Vendors, pricing came in 8% higher" autocapitalize="sentences" enterkeyhint="done"></textarea>
    <div class="cap-row"><button type="button" class="cap-mic" data-2b="mic">${ICONS.mic}Speak</button><button type="button" class="cap-go" data-2b="cap-go">Add</button></div>
    <p class="cap-status" id="cap-status" role="status">Start with <b>To do</b> (and a day) or <b>Work note</b> / <b>Personal note</b> (and a folder). Anything else becomes a to-do for today.</p>
    <ul class="cap-ex"><li><b>To do tomorrow, renew passport</b></li><li><b>To do [Nov 14] book flights at 7pm</b></li><li><b>Work to do Friday, send the deck</b></li><li><b>Work note Sprint planning, QA owner is Dana</b></li><li><b>Personal note</b> gift idea: cooking class → General</li><li><b>Spanish le llegas means do you get it</b></li></ul>
    <div class="cap-more"><button type="button" class="secondary" data-2b="cap-forms">More: event, workout, note, habit…</button></div></div>`, { kind: '2b-capture', form: false });
  const ta = document.getElementById('cap-text');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capGo(); } });
  if (autoMic) startMic(); else setTimeout(() => ta.focus(), 60);
}
function capGo() {
  const ta = document.getElementById('cap-text'); if (!ta) return;
  stopMic();
  const lines = ta.value.split(/\n(?=\s*(?:work\s+)?(?:to[\s-]?do|todo|work note|personal note|spanish|note)\b)/i).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { ta.focus(); return; }
  forceClose();
  lines.forEach(l => runCommand(l));
}
// The mockup's + button opens the form picker; make voice/command capture the first choice.
const _capture = capture;
capture = function () { captureSheet(false); };

/* ---------- 7. Granola import + summary ---------- */
function mdToHTML(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n'); let html = '', list = false;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/\[(.+?)\]\((.+?)\)/g, '$1');
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    const b = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*)$/);
    if (b) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + inline(b[1]) + '</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += (h[1].length <= 2 ? '<h2>' : '<h3>') + inline(h[2]) + (h[1].length <= 2 ? '</h2>' : '</h3>'); continue; }
    if (l.trim()) html += '<p>' + inline(l) + '</p>';
  }
  if (list) html += '</ul>';
  return html;
}
function meetingDate(md, file) {
  const fm = md.match(/^---[\s\S]*?\bdate:\s*["']?([^\n"']+)/i) || md.match(/^\s*(?:\*\*)?date(?:\*\*)?\s*[:\-]\s*(.+)$/im);
  const tryD = s => { if (!s) return ''; const iso = String(s).match(/\d{4}-\d{2}-\d{2}/); if (iso) return iso[0]; const d = new Date(String(s).replace(/(\d)(st|nd|rd|th)/, '$1').replace(/\bat\b.*$/, '')); return isNaN(d) ? '' : localDay(d); };
  let d = tryD(fm && fm[1]);
  if (!d) { const top = md.split('\n').slice(0, 6).join(' '); const m = top.match(/\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+[a-z]+\.?\s+\d{1,2}(?:,?\s+\d{4})?|\b[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\b|\d{4}-\d{2}-\d{2}/i); d = tryD(m && m[0]); }
  if (!d && file && file.name) { const m = file.name.match(/\d{4}-\d{2}-\d{2}/); if (m) d = m[0]; }
  if (!d && file && file.lastModified) d = localDay(new Date(file.lastModified));
  return d || today;
}
function localSummary(n, md) {
  const text = md || plain((n.body || '').replace(/<\/(p|li|h2|h3|div)>/g, '\n').replace(/<br\s*\/?>/g, '\n'));
  const lines = text.replace(/\r/g, '').split('\n');
  const topics = [], todos = []; let section = '';
  const isAction = s => /action|next step|to-?do|follow[- ]?up|tasks?\b|owners?/i.test(s);
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue;
    const h = l.match(/^#{1,4}\s+(.*)$/) || l.match(/^\*\*(.+?)\*\*:?$/);
    if (h) { section = h[1].trim(); if (!isAction(section) && !/^(summary|notes|attendees|participants|transcript)$/i.test(section) && section !== n.title) topics.push(section); continue; }
    const b = l.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
    const box = /^\[\s?\]\s*/.test(b);
    const item = b.replace(/^\[[ xX]?\]\s*/, '').trim();
    const explicit = /^(todo|to do|action item|action|ai)\s*[:\-]/i.test(item);
    const owned = /^(i|we|i'll|we'll|[A-Z][a-z]+)\b.{0,40}\b(will|to follow up|needs? to|owns?)\b/.test(item);
    if (item && item.length < 200 && (box || explicit || isAction(section) || (owned && /^\s*(?:[-*•]|\d+[.)])/.test(l))))
      todos.push(item.replace(/^(todo|to do|action item|action|ai)\s*[:\-]\s*/i, ''));
  }
  if (!topics.length) lines.filter(l => /^\s*[-*•]\s+/.test(l)).slice(0, 5).forEach(l => topics.push(l.replace(/^\s*[-*•]\s+/, '').slice(0, 90)));
  return { date: n.meetingDate || today, topics: [...new Set(topics)].slice(0, 8), todos: [...new Set(todos)].slice(0, 12) };
}
async function summarize(n) {
  notify('Summarizing…');
  const f = (n.files || []).find(x => /\.(md|txt|markdown)$/i.test(x.name) && !x.summary);
  const blob = f ? await FS.get(f.id) : null;
  const md = blob ? await blob.text() : '';
  let s = null;
  if (cfg.url) { try { const r = await api({ action: 'summarize', title: n.title, date: n.meetingDate || '', text: (md || plain(n.body || '')).slice(0, 60000) }); s = r.summary; s.by = 'Claude'; } catch (e) { s = null; } }
  if (!s) s = localSummary(n, md);
  s.date = s.date || n.meetingDate || today; s.at = new Date().toISOString();
  n.summary = s;
  const out = `# Summary: ${n.title}\n\nDate: ${s.date}\n\n## Main topics\n${s.topics.map(t => '- ' + t).join('\n') || '- (none found)'}\n\n## To-dos\n${s.todos.map(t => '- [ ] ' + t).join('\n') || '- (none found)'}\n`;
  const fid = 'a' + Math.random().toString(36).slice(2, 10), name = ('Summary - ' + n.title).replace(/[\\/:*?"<>|]/g, '').slice(0, 90) + '.md';
  n.files = (n.files || []).filter(x => !x.summary);
  await FS.put(fid, new Blob([out], { type: 'text/markdown' }));
  n.files.push({ id: fid, name, size: out.length, type: 'text/markdown', added: today, drive: 'pending', summary: true });
  n.updated = new Date().toISOString(); save(); noteRead(n.id);
}
function summaryBlock(n) {
  const s = n.summary; if (!s) return '';
  return `<section class="g-sum"><p class="eyebrow">Summary · ${esc(fmtDay(s.date))}${s.by ? ' · ' + esc(s.by) : ''}</p>
    <h3>Main topics</h3><ul>${s.topics.map(t => `<li>${esc(t)}</li>`).join('') || '<li>None found</li>'}</ul>
    <h3>To-dos</h3><ul class="g-todos">${s.todos.map((t, i) => `<li><span>${esc(t)}</span><button type="button" data-2b="g-add" data-id="${n.id}" data-i="${i}">Add</button></li>`).join('') || '<li>None found</li>'}</ul>
    ${s.todos.length ? `<button type="button" class="secondary" style="margin-top:10px" data-2b="g-addall" data-id="${n.id}">Add all ${s.todos.length} to my to-dos</button>` : ''}</section>`;
}
const _noteRead = noteRead;
noteRead = function (id) {
  const pn = data.notes.find(x => x.id === id); if (isPhrase(pn)) { normPhrase(pn); return phraseDetail(pn, false); }
  _noteRead(id);
  const n = data.notes.find(x => x.id === id), root = document.querySelector('#modal-root .sheet'); if (!root || !n) return;
  const reader = root.querySelector('.reader'); if (!reader) return;
  const files = (n.files || []).filter(f => f.url).map(f => `<a class="folder-chip" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)} ↗</a>`).join(' ');
  const meta = n.source === 'granola' ? `<p class="g-meta">Imported from Granola · meeting ${esc(fmtDay(n.meetingDate))}${files ? ' · ' + files : ''}</p>` : files ? `<p class="g-meta">${files}</p>` : '';
  const btn = n.source === 'granola' ? `<button type="button" class="primary g-btn" data-2b="g-sum" data-id="${n.id}">${n.summary ? 'Redo summary' : 'Summary'}</button>` : '';
  reader.insertAdjacentHTML('beforebegin', meta + summaryBlock(n) + btn);
};
function granolaSheet() {
  const tab = noteTab === 'Spanish' ? 'Work' : noteTab;
  const opts = t => ['General', ...foldersOf(t).filter(f => f !== 'General')].map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  modal('Import Granola notes', `<p class="muted" style="font-size:12px;line-height:1.6">In Granola, open a note › <b>Copy</b> (as Markdown) and paste below, or export notes as .md/.txt files and pick them. Each one becomes a note; the original file is saved to Google Drive.</p>
    <label for="g-files">Files</label><input id="g-files" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple>
    <label for="g-paste">Or paste a note</label><textarea id="g-paste" rows="6" placeholder="# Weekly sync with Dana&#10;Date: Nov 2, 2026&#10;### Decisions&#10;- …"></textarea>
    <div class="row2"><div><label for="g-tab">Notebook</label><select id="g-tab"><option ${tab === 'Work' ? 'selected' : ''}>Work</option><option ${tab === 'Personal' ? 'selected' : ''}>Personal</option></select></div>
    <div><label for="g-folder">Folder</label><input id="g-folder" list="g-folders" value="General" maxlength="60"><datalist id="g-folders">${opts(tab)}</datalist></div></div>
    <div class="form-actions"><button type="button" class="secondary" data-act="close">Cancel</button><button type="button" class="primary" data-2b="g-import">Import</button></div>`, { kind: '2b-granola', form: false });
  document.getElementById('g-tab').addEventListener('change', e => { document.getElementById('g-folders').innerHTML = opts(e.target.value); });
}
async function granolaImport() {
  const files = [...(document.getElementById('g-files').files || [])];
  const paste = document.getElementById('g-paste').value.trim();
  const tab = document.getElementById('g-tab').value, folder = document.getElementById('g-folder').value.trim() || 'General';
  const items = [];
  for (const f of files) items.push({ md: await f.text(), file: f });
  if (paste) items.push({ md: paste, file: null });
  if (!items.length) { notify('Pick a file or paste a note first.'); return; }
  const made = [];
  for (const it of items) {
    const h = it.md.match(/^#\s+(.+)$/m) || it.md.match(/^title:\s*(.+)$/im);
    const title = (h ? h[1] : it.file ? it.file.name.replace(/\.[^.]+$/, '') : it.md.split('\n')[0]).replace(/[#*]/g, '').trim().slice(0, 160) || 'Granola note';
    const d = meetingDate(it.md, it.file);
    const fid = 'a' + Math.random().toString(36).slice(2, 10);
    const fname = it.file ? it.file.name : (d + ' ' + title).replace(/[\\/:*?"<>|]/g, '').slice(0, 90) + '.md';
    await FS.put(fid, it.file || new Blob([it.md], { type: 'text/markdown' }));
    const now = new Date().toISOString();
    const n = { id: uid(), tab, folder, title, body: clean(mdToHTML(it.md.replace(/^---[\s\S]*?---\s*/, ''))), entered: now, updated: now, lastOpened: now, meetingDate: d, source: 'granola', files: [{ id: fid, name: fname, size: it.md.length, type: 'text/markdown', added: today, drive: 'pending' }] };
    data.notes.unshift(n); made.push(n);
  }
  noteTab = tab; noteFolder = folder;
  save(); forceClose(); go('notes');
  notify(`Imported ${made.length} Granola note${made.length > 1 ? 's' : ''}. Open one and tap Summary.`);
  uploadFiles();
}

/* ---------- 7b. Spanish: quick phrase entry + Quiz me (phrases are notes in Spanish › Phrases) ---------- */
const isPhrase = n => n && n.tab === 'Spanish' && (n.source === 'phrase' || n.folder === 'Phrases');
function phraseBody(n) { return '<p><b>' + esc(n.es || '') + '</b></p>' + (n.en ? '<p>' + esc(n.en) + '</p>' : '') + (n.note ? '<p>' + esc(n.note) + '</p>' : ''); }
// Older phrase notes only have the body: recover es/en and add review fields.
function normPhrase(n) {
  if (!isPhrase(n)) return false; let ch = false;
  if (n.es == null) { const t = document.createElement('div'); t.innerHTML = n.body || ''; const ps = [...t.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean); n.es = ps[0] || n.title || ''; n.en = ps[1] || ''; n.note = ps.slice(2).join(' '); ch = true; }
  if (!Array.isArray(n.passes)) { n.passes = []; ch = true; }
  if (!Array.isArray(n.reviews)) { n.reviews = []; ch = true; }
  if (n.source !== 'phrase') { n.source = 'phrase'; ch = true; }
  return ch;
}
const phrases = () => data.notes.filter(isPhrase).map(n => (normPhrase(n), n));
function addPhrase(es, en, note, from) {
  es = String(es || '').trim(); en = String(en || '').trim();
  if (!es) { notify('Type or say the Spanish phrase first.'); return null; }
  const dup = phrases().find(p => p.es.toLowerCase() === es.toLowerCase());
  if (dup) { if (en && !dup.en) { dup.en = en; dup.body = phraseBody(dup); dup.updated = new Date().toISOString(); save(); render(); notify('Meaning added to “' + dup.es + '”.'); } else notify('“' + dup.es + '” is already in your phrases.'); return dup; }
  const now = new Date().toISOString();
  const n = { id: uid(), tab: 'Spanish', folder: 'Phrases', title: es.slice(0, 160), es, en, note: note || '', passes: [], reviews: [], entered: now, updated: now, lastOpened: now, source: 'phrase' };
  n.body = phraseBody(n); data.notes.unshift(n); save(); if (!$('#modal-root').children.length) render();
  undoToast(`Phrase added${from ? ' (from ' + from + ')' : ''}${en ? '' : ': add the English meaning so it can be quizzed'}.`, () => { data.notes = data.notes.filter(x => x !== n); save(); render(); });
  return n;
}
// "Spanish le llegas means do you get it" · "Spanish phrase le llegas = do you get it" · "Spanish, le llegas, do you get it"
function splitPhrase(s) {
  s = String(s || '').trim();
  let m = s.split(/\s+(?:means|meaning|=|->|→|–|—|\|)\s+/i); if (m.length >= 2) return { es: m[0].replace(/[,:]\s*$/, ''), en: m.slice(1).join(' ') };
  const c = s.lastIndexOf(','); if (c > 0) return { es: s.slice(0, c).trim(), en: s.slice(c + 1).trim() };
  return { es: s, en: '' };
}
const boxes = c => `<span class="review-boxes" aria-label="${c} of 5 correct review days">${Array.from({ length: 5 }, (_, i) => `<i class="${i < c ? 'on' : ''}">${i < c ? '✓' : ''}</i>`).join('')}</span>`;
let phraseFilter = 'learning', spMic = null;
function spanishPanel() {
  const all = phrases(), active = all.filter(p => p.passes.length < 5), mastered = all.filter(p => p.passes.length >= 5);
  const list = (phraseFilter === 'learning' ? active : mastered).slice().sort((a, b) => String(b.entered).localeCompare(String(a.entered)));
  const quizN = Math.min(10, active.filter(p => p.en).length);
  const others = folderTiles('Spanish').replace(/<button class="note-card folder-tile"[^>]*data-folder="Phrases"[\s\S]*?<\/button>/, '');
  return `<form class="sp-add" id="sp-add" autocomplete="off"><div class="sp-row"><input id="sp-es" lang="es" placeholder="Spanish phrase" maxlength="200" aria-label="Spanish phrase" autocapitalize="off"><button type="button" class="icon-btn sp-mic" data-2b="sp-mic" aria-label="Say it in Spanish">${ICONS.mic}</button></div>
      <div class="sp-row"><input id="sp-en" placeholder="English meaning" maxlength="200" aria-label="English meaning"><button class="primary" type="submit">Add</button></div><p class="sp-hint" id="sp-status">Mic listens in Spanish (DR). Or use quick capture: <b>Spanish le llegas means do you get it</b></p></form>
    <button class="quiz-banner" data-2b="quiz-start" ${quizN ? '' : 'disabled'}><div><strong>Quiz me</strong><small>${quizN ? quizN + ' phrases · missed answers come back' : active.length ? 'Add English meanings to quiz these' : 'Add a phrase to start'}</small></div><span>→</span></button>
    <div class="filters sp-filters"><button data-2b="sp-filter" data-v="learning" class="${phraseFilter === 'learning' ? 'on' : ''}">Learning · ${active.length}</button><button data-2b="sp-filter" data-v="mastered" class="${phraseFilter === 'mastered' ? 'on' : ''}">Mastered · ${mastered.length}</button></div>
    <div class="list sp-list">${list.map(p => `<button class="phrase" data-2b="phrase" data-id="${p.id}"><b lang="es">${esc(p.es)}</b><small>${esc(p.en || 'Add the English meaning')}</small><span class="phrase-foot">${boxes(p.passes.length)}<small>${p.reviews.length} review${p.reviews.length === 1 ? '' : 's'}</small></span></button>`).join('') || `<div class="empty">${phraseFilter === 'learning' ? 'No phrases yet. Add one above.' : 'Nothing mastered yet. Five correct review days (one per day) masters a phrase.'}</div>`}</div>
    ${others ? `<div class="section-label">Other Spanish notes</div><div class="notes-grid folder-grid">${others}</div>` : ''}`;
}
function spMicToggle() {
  const inp = document.getElementById('sp-es'), st = document.getElementById('sp-status'), btn = document.querySelector('[data-2b="sp-mic"]');
  if (spMic) { try { spMic.stop(); } catch (e) {} spMic = null; btn && btn.classList.remove('listening'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { inp.focus(); st.textContent = 'Use the keyboard mic (switch the keyboard to Español).'; return; }
  const r = spMic = new SR(); r.lang = 'es-DO'; r.interimResults = true; r.continuous = false;
  r.onstart = () => { btn.classList.add('listening'); st.textContent = 'Escuchando… say the phrase in Spanish.'; };
  r.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; inp.value = t.trim(); };
  r.onerror = e => { st.textContent = e.error === 'language-not-supported' ? 'Spanish voice isn’t available here; use the keyboard mic in Español.' : e.error === 'not-allowed' ? 'Microphone is blocked for this site.' : 'Didn’t catch that. Tap the mic and try again.'; };
  r.onend = () => { spMic = null; btn && btn.classList.remove('listening'); if (inp.value) { st.textContent = 'Now add the English meaning, then Add.'; document.getElementById('sp-en').focus(); } };
  try { r.start(); } catch (e) { st.textContent = 'Could not start the mic.'; }
}
function recordReview(p, correct) {
  p.reviews.push({ day: today, correct }); if (correct && !p.passes.includes(today) && p.passes.length < 5) p.passes.push(today);
  p.updated = new Date().toISOString(); save();
}
function phraseDetail(p, revealed) {
  modal('Phrase review', `<p class="eyebrow">${p.passes.length >= 5 ? 'Mastered' : 'Learning'} · ${p.reviews.length} total reviews</p><p class="sp-big" lang="es">${esc(p.es)}</p>
    ${revealed || !p.en ? `<p class="sp-mean">${esc(p.en || 'No English meaning yet')}</p>${p.note ? `<p class="muted" style="font-size:12px">${esc(p.note)}</p>` : ''}` : `<button class="secondary" style="width:100%" data-2b="phrase-reveal" data-id="${p.id}">Reveal meaning</button>`}
    ${boxes(p.passes.length)}<p class="muted" style="font-size:11px;margin-top:8px">${p.passes.length}/5 correct review days. One box per day.</p>
    ${revealed ? `<div class="form-actions" style="justify-content:stretch"><button class="secondary" style="flex:1" data-2b="phrase-review" data-id="${p.id}" data-ok="0">Keep practicing</button><button class="primary" style="flex:1" data-2b="phrase-review" data-id="${p.id}" data-ok="1">I remembered it</button></div>` : ''}
    <div class="section-label">Review history</div><ul class="sp-hist">${p.reviews.length ? p.reviews.slice().reverse().slice(0, 15).map(r => `<li>${fmt(r.day, { month: 'short', day: 'numeric', year: 'numeric' })} · ${r.correct ? 'Remembered' : 'Practicing'}</li>`).join('') : '<li>No reviews yet.</li>'}</ul>
    <div class="form-actions"><button class="danger" data-2b="phrase-del" data-id="${p.id}">Delete</button><button class="secondary" data-2b="phrase-edit" data-id="${p.id}">Edit phrase</button></div>`, { kind: '2b-phrase', id: p.id, form: false });
}
function phraseEditor(p) {
  modal('Edit phrase', `<label for="pe-es">Spanish</label><input id="pe-es" lang="es" value="${esc(p.es)}" maxlength="200"><label for="pe-en">English meaning</label><input id="pe-en" value="${esc(p.en || '')}" maxlength="200"><label for="pe-note">Usage note · optional</label><textarea id="pe-note" rows="2">${esc(p.note || '')}</textarea>
    <div class="form-actions"><button class="secondary" data-act="close">Cancel</button><button class="primary" data-2b="phrase-save" data-id="${p.id}">Save</button></div>`, { kind: '2b-phrase-edit', id: p.id, form: false });
}
const shuffle = l => l.map(x => ({ x, r: Math.random() })).sort((a, b) => a.r - b.r).map(x => x.x);
let quiz = null;
function startQuiz() {
  const pool = phrases().filter(p => p.passes.length < 5 && p.en).sort((a, b) => (a.passes.includes(today) - b.passes.includes(today)) || a.passes.length - b.passes.length).slice(0, 10);
  if (!pool.length) { notify('No phrases to quiz. Add a phrase with its English meaning.'); return; }
  quiz = { queue: pool.map(p => p.id), total: pool.length, correct: 0, missed: 0, answered: false, picked: null, options: [], dir: 'es' };
  quizQuestion();
}
function quizQuestion() {
  const q = quiz; if (!q) return;
  if (!q.queue.length) {
    const h = data.habits.find(x => /spanish/i.test(x.title)); if (h && !h.days.includes(today)) h.days.push(today);
    save(); quiz = null;
    modal('Practice complete', `<div class="stats"><div><b>${q.total}</b><small>Phrases practiced</small></div><div><b>${q.missed}</b><small>Missed answers revisited</small></div></div><p class="muted" style="font-size:12px;line-height:1.6">Correct answers add one review box per day. ${h ? 'Spanish is ticked for today.' : ''}</p><div class="form-actions"><button class="primary" data-2b="quiz-done">Back to Spanish</button></div>`, { kind: '2b-quiz', form: false });
    return;
  }
  const p = data.notes.find(x => x.id === q.queue[0]); if (!p) { q.queue.shift(); return quizQuestion(); }
  q.answered = false; q.picked = null;
  const wrong = shuffle([...new Set(phrases().filter(x => x.id !== p.id && x.en && x.en !== p.en).map(x => x.en))]).slice(0, 3);
  for (const x of ['Take care', 'Good morning', 'Be careful', 'Of course', 'What’s up?']) { if (wrong.length >= 3) break; if (x !== p.en && !wrong.includes(x)) wrong.push(x); }
  q.options = shuffle([p.en, ...wrong]); renderQuiz(p);
}
function renderQuiz(p) {
  const q = quiz, ok = q.answered && q.options[q.picked] === p.en;
  modal('Quiz me', `<p class="eyebrow">${q.correct} of ${q.total} learned · ${q.queue.length} in queue</p><div class="sp-prog"><i style="width:${q.correct / q.total * 100}%"></i></div>
    <p class="sp-big" lang="es">${esc(p.es)}</p><p class="muted" style="font-size:12px">Choose the English meaning.</p>
    <div class="quiz-options">${q.options.map((o, i) => `<button class="quiz-option ${q.answered ? (o === p.en ? 'right' : i === q.picked ? 'wrong' : '') : ''}" data-2b="quiz-answer" data-i="${i}" ${q.answered ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    ${q.answered ? `<p class="quiz-feedback">${ok ? `<b>Correct.</b> ${p.passes.length}/5 correct review days.${p.passes.length === 5 ? ' Mastered.' : ''}` : `<b>Keep practicing.</b> ${esc(p.en)}. It comes back later in this quiz.`}</p><div class="form-actions"><button class="primary" data-2b="quiz-next">${q.queue.length === 1 && ok ? 'Finish' : 'Next phrase'}</button></div>` : ''}`, { kind: '2b-quiz', form: false });
}

/* ---------- 8. Sync settings ---------- */
function syncSheet() {
  modal('Google sync', `<p class="muted" style="font-size:12px;line-height:1.6">Connects this device to your 2nd Brain Google Sheet: to-dos, notes, habits, workouts and events sync across devices; Google Calendar and the Little Elm training plan (with Garmin results) come in; note files go to the 2nd Brain Drive folder.</p>
    <label for="s-url">Apps Script web app URL</label><input id="s-url" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
    <label for="s-key">Key</label><input id="s-key" value="${esc(cfg.token || '')}" placeholder="From the setup() log" autocomplete="off">
    <label for="s-names">Names that mean “with people” on your calendar</label><input id="s-names" value="${esc(cfg.names || '')}" placeholder="e.g. Steph, Kofi, Dana">
    <p class="cap-status">App build: <b>${esc(document.querySelector('meta[name="2b-build"]')?.content || 'dev')}</b></p><p class="cap-status" id="s-status">${esc(cfg.status || 'Not connected yet.')}${cfg.planError ? '<br>Plan: ' + esc(cfg.planError) : ''}${cfg.url ? '<br>Garmin activities: ' + (cfg.garminAt ? 'last synced ' + esc(new Date(cfg.garminAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : 'not synced yet') + (cfg.strava && cfg.strava.error ? '<br><b>Strava:</b> ' + esc(cfg.strava.error) : cfg.strava && !cfg.strava.keys ? '<br><b>Strava:</b> add STRAVA_ID and STRAVA_SECRET in Script Properties' : '') : ''}</p>
    <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">${cfg.url ? '<button type="button" class="danger" data-2b="s-off">Disconnect</button><button type="button" class="secondary" data-2b="s-plan">Reload training plan</button><button type="button" class="secondary" data-2b="s-strava">Sync Garmin now</button>' : ''}<button type="button" class="primary" data-2b="s-save">${cfg.url ? 'Save and sync now' : 'Connect'}</button></div>`, { kind: '2b-sync', form: false });
}
function paintStatus() {
  const el = document.getElementById('s-status'); if (el) el.textContent = cfg.status || '';
  document.querySelectorAll('.sync-dot').forEach(dot => { dot.dataset.state = /^Synced/.test(cfg.status || '') ? 'ok' : /^Syncing/.test(cfg.status || '') ? 'busy' : cfg.url ? 'err' : 'off'; dot.title = cfg.status || 'Google sync: not connected'; });
}

/* ---------- 9. Decorate the rendered page ---------- */
const _render = render;
/* ---------- 8b. Notes: folder cards that open into a list, notes that expand in place ---------- */
const openFolders = new Set(ls.get('2b-openf', [])), openNotes = new Set();
const FOLDER_SVG = '<svg class="fold-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
const fKey = (t, f) => t + '|' + f;
const ago = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
function folderCards(tab) {
  const groups = [...new Set(data.notes.filter(n => n.tab === tab && !isPhrase(n)).map(n => n.folder))];
  groups.sort((a, b) => (openFolders.has(fKey(tab, b)) - openFolders.has(fKey(tab, a))) || String(folderLastOpened(tab, b)).localeCompare(String(folderLastOpened(tab, a))) || a.localeCompare(b));
  return groups.map(f => {
    const ns = data.notes.filter(n => n.tab === tab && n.folder === f && !isPhrase(n)).sort((a, b) => String(b.updated || b.entered).localeCompare(String(a.updated || a.entered)));
    const open = openFolders.has(fKey(tab, f));
    return `<article class="fcard${open ? ' open' : ''}"><button class="fcard-h" data-2b="folder-toggle" data-tab="${esc(tab)}" data-folder="${esc(f)}" aria-expanded="${open}">${FOLDER_SVG}<span class="fcard-t"><b>${esc(f)}</b><small>${ns.length} note${ns.length === 1 ? '' : 's'} · ${esc(openedLabel(folderLastOpened(tab, f)))}</small></span><span class="fcard-chev">⌄</span></button>
      ${open ? `<div class="fcard-list">${ns.map(n => { const ex = openNotes.has(n.id); return `<div class="nrow${ex ? ' ex' : ''}"><button class="nrow-h" data-2b="note-toggle" data-id="${n.id}" aria-expanded="${ex}"><span class="nrow-dot"></span><span class="nrow-t"><b>${esc(n.title)}</b><small>${esc(ago(n.updated || n.entered))}${n.source === 'granola' ? ' · Granola' : ''}${n.summary ? ' · summarized' : ''}${(n.files || []).length ? ' · ' + n.files.length + ' file' + (n.files.length > 1 ? 's' : '') : ''}</small></span><span class="fcard-chev">⌄</span></button>
        ${ex ? `<div class="nrow-body"><div class="reader">${clean(n.body || '') || '<p class="muted">Empty note.</p>'}</div><div class="nrow-act">${n.source === 'granola' ? `<button class="secondary" data-act="note-read" data-id="${n.id}">${n.summary ? 'Summary' : 'Summarize'}</button>` : ''}<button class="secondary" data-act="note-read" data-id="${n.id}">Open full</button><button class="primary" data-act="note-edit" data-id="${n.id}">Edit</button></div></div>` : ''}</div>`; }).join('') || '<p class="muted" style="padding:10px 4px;font-size:12px">No notes yet.</p>'}
        <button class="fcard-new" data-2b="note-in-folder" data-tab="${esc(tab)}" data-folder="${esc(f)}">+ New note in ${esc(f)}</button></div>` : ''}</article>`;
  }).join('');
}
function decorateNotes() {
  if (page !== 'notes' || noteFolder !== 'all') return;
  const grid = document.querySelector('#page-content .notes-grid.folder-grid'); if (!grid) return;
  const html = folderCards(noteTab);
  grid.outerHTML = `<div class="fcards">${html}</div>`;
  if (html) document.querySelectorAll('#page-content > .empty').forEach(e => e.remove());
}

const _modal = modal;
modal = function (title, body, opts = {}) {
  _modal(title, body, opts);
  if (opts.form === false) return;
  const t = document.querySelector('#modal-root .sheet-title'), close = t && t.querySelector('[data-act="close"]');
  if (close && !t.querySelector('.top-save')) close.insertAdjacentHTML('beforebegin', `<button class="primary top-save" type="submit" form="editor">${opts.id ? 'Save' : '+ Add'}</button>`);
};
render = function () {
  // a single-folder view always shows as the folder list with that folder open
  if (page === 'notes' && noteFolder !== 'all' && !(noteTab === 'Spanish' && noteFolder === 'Phrases')) { openFolders.add(fKey(noteTab, noteFolder)); ls.set('2b-openf', [...openFolders]); noteFolder = 'all'; }
  _render();
  document.body.dataset.page = page;
  try { sessionStorage.setItem('2b-view', JSON.stringify({ page, noteTab, week, month, selectedDate, taskFilter, y: page === lastPage ? scrollY : 0 })); } catch (e) {}
  lastPage = page;
  const qf = document.getElementById('quick-task');
  if (qf && !qf.querySelector('.qf-add')) qf.insertAdjacentHTML('beforeend', '<button class="primary qf-add" type="submit" aria-label="Add to-do">+ Add</button>');
  const acts = document.querySelector('.header-actions');
  if (acts && !acts.querySelector('.sync-dot')) acts.insertAdjacentHTML('afterbegin', `<button class="icon-btn mic-btn" data-2b="capture-mic" aria-label="Voice capture">${ICONS.mic}</button><button class="icon-btn sync-dot" data-2b="sync-settings" aria-label="Google sync settings"><i></i></button>`);
  paintStatus();
  // calendar: red = with people, yellow = appointment
  document.querySelectorAll('.agenda-item > button[data-act="event-edit"]').forEach(b => {
    const e = data.events.find(x => x.id === b.dataset.id); if (!e || !e.gcal) return;
    b.parentElement.classList.add('k-' + (e.kind || 'event'));
    const s = b.querySelector('small'); if (s) s.textContent = (e.kind === 'people' ? 'With ' + (e.people || []).join(', ') : e.kind === 'appt' ? 'Appointment' : e.cal) + (e.end ? ' · until ' + e.end : '');
  });
  if (page === 'calendar' && !document.querySelector('.cal-legend')) document.querySelector('.calendar-panel')?.insertAdjacentHTML('beforeend', '<p class="cal-legend"><i class="k-people"></i> with people <i class="k-appt"></i> appointment <i></i> other</p>');
  // notes: Granola import next to +
  const nc = document.querySelector('.notes-controls');
  if (nc && !nc.querySelector('[data-2b="granola"]')) nc.insertAdjacentHTML('beforeend', `<button class="icon-btn" data-2b="granola" aria-label="Import Granola notes" title="Import Granola notes">${ICONS.book}</button>`);
  if (page === 'notes' && noteTab === 'Spanish' && (noteFolder === 'all' || noteFolder === 'Phrases')) {
    const ctl = document.querySelector('.notes-controls');
    if (ctl) { while (ctl.nextSibling) ctl.nextSibling.remove(); ctl.insertAdjacentHTML('afterend', '<div class="sp-panel">' + spanishPanel() + '</div>'); }
  }
  decorateNotes();
  // workouts: where the plan comes from
  const wc = document.querySelector('.week-control');
  if (page === 'workouts' && wc && cfg.url) wc.insertAdjacentHTML('afterend', `<p class="plan-src">Plan: Little Elm sheet${cfg.planError ? ' · not loaded: ' + esc(cfg.planError) : ''} · Garmin: ${cfg.garminAt ? 'synced ' + esc(new Date(cfg.garminAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : cfg.strava && cfg.strava.error ? esc(cfg.strava.error) : 'not connected'}</p>`);
  if (page === 'workouts') document.querySelectorAll('.workout-day').forEach(sec => {
    const add = sec.querySelector('.slot-add'); const d = add && add.dataset.date; if (!d) return;
    sec.querySelectorAll('.slot').forEach(sl => { const a = sl.querySelector('.slot-add'); if (a) { sl.dataset.date = a.dataset.date; sl.dataset.slot = a.dataset.slot; } });
    const h = sec.querySelector('h3'); if (h && data.workouts.some(w => w.date === d)) h.insertAdjacentHTML('beforeend', `<button class="swap-btn" data-2b="swap-day" data-date="${d}" aria-label="Swap AM and PM">⇅ Swap</button>`);
  });
  document.querySelectorAll('.session').forEach(el => { const eb = el.querySelector('[data-act="workout-edit"]'); if (eb) { el.dataset.wid = eb.dataset.id; el.draggable = true; } });
  if (page === 'workouts' && !document.querySelector('.disc')) {
    const days = Array.from({ length: 7 }, (_, i) => add(week, i)), ws = data.workouts.filter(w => days.includes(w.date));
    const rows = ['Swim', 'Bike', 'Run', 'Strength', 'Yoga'].map(k => {
      const l = ws.filter(w => w.kind === k); if (!l.length) return '';
      const pm = l.reduce((s, w) => s + (Number(w.target) || 0), 0), am = l.reduce((s, w) => s + (Number(w.actual) || 0), 0);
      const pmi = l.reduce((s, w) => s + (Number(w.miles) || 0), 0), ami = l.reduce((s, w) => s + (Number(w.garmin && w.garmin.mi) || Number(w.actualMiles) || 0), 0);
      const hm = m => m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') : m + 'm';
      const pct = pm ? Math.min(100, Math.round(am / pm * 100)) : 0;
      const r1 = x => Math.round(x * 10) / 10;
      return `<div class="disc-row"><b>${k}</b><span><span class="v-act">${hm(am)}</span> <span class="v-sep">/</span> <span class="v-pln">${hm(pm)}</span></span><span class="disc-mi">${k === 'Run' ? `<span class="v-act">${r1(ami)}</span> <span class="v-sep">/</span> <span class="v-pln">${r1(pmi)} mi</span>` : ''}</span><i class="disc-bar"><i style="width:${pct}%"></i></i></div>`;
    }).join('');
    const st = document.querySelector('#page-content .stats');
    if (st && rows) st.insertAdjacentHTML('afterend', `<section class="disc" aria-label="Planned vs actual by discipline"><div class="disc-h"><span>This week by discipline</span><span>actual / planned</span></div>${rows}</section>`);
  }
  if (page === 'workouts' && Object.keys(cfg.planQ || {}).length) document.querySelector('.week-control')?.insertAdjacentHTML('afterend', `<p class="plan-src">${Object.keys(cfg.planQ).length} day(s) waiting to save to the plan sheet</p>`);
  if (page === 'workouts') {
    const st = document.querySelectorAll('#page-content .stats > div');
    if (st[0]) st[0].querySelector('b')?.classList.add('v-pln'); if (st[1]) st[1].querySelector('b')?.classList.add('v-act');
    const ph = document.querySelector('#page-content .page-head'), wc = document.querySelector('#page-content .week-control');
    if (ph && wc && !wc.querySelector('.wk-add')) wc.querySelector('strong')?.insertAdjacentHTML('afterend', '<button class="wk-add" data-act="workout-new" aria-label="Plan a session">+</button>');
  }
  document.querySelectorAll('.session-preview button[data-act="workout-log"]').forEach(el => {
    const w = data.workouts.find(x => x.id === el.dataset.id), sp = el.querySelector('span'); if (!w || !sp) return;
    sp.innerHTML = `<span class="v-pln">${w.target} min</span> · ${w.actual == null ? 'Log session' : `<span class="v-act">${w.actual} min done</span>`}`;
  });
  if (page === 'habits') { const sm = document.querySelector('#page-content .stats > div small'); if (sm) sm.textContent = 'Last 7 full days (today not counted)'; }
  document.querySelectorAll('.scoreline span[title^="Trailing"]').forEach(x => x.title = 'Habit efficiency: last 7 full days, not counting today');
  decorateSportIcons();
  document.querySelectorAll('.session').forEach(el => {
    const b = el.querySelector('[data-act="workout-edit"]'); const w = b && data.workouts.find(x => x.id === b.dataset.id);
    const sm = el.querySelector('small');
    if (w && sm) {
      const pct = w.actual != null && w.target ? Math.round(Math.min(w.actual / w.target, 1) * 100) : null;
      const act = w.actual != null ? [w.actual + ' min', w.garmin && w.garmin.mi ? w.garmin.mi + ' mi' : '', w.garmin && w.garmin.hr ? w.garmin.hr + ' bpm' : '', pct != null ? pct + '%' : ''].filter(Boolean).join(' · ') : '';
      sm.innerHTML = `${esc(w.kind)} · <span class="v-pln">${w.target} min${w.miles ? ' · ' + w.miles + ' mi' : ''}</span>${act ? `<br><span class="v-act">${w.garmin ? '✓ ' : ''}${esc(act)}</span>` : ''}`;
    }
    if (w && w.garmin) el.classList.add('from-garmin');
  });
};

addEventListener('click', async e => {
  const b = e.target.closest('[data-2b]'); if (!b) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const a = b.dataset['2b'], n = b.dataset.id && data.notes.find(x => x.id === b.dataset.id);
  switch (a) {
    case 'capture': forceClose(); captureSheet(false); break;
    case 'capture-mic': forceClose(); captureSheet(true); break;
    case 'cap-forms': forceClose(); _capture(); break;
    case 'mic': listening ? stopMic() : startMic(); break;
    case 'cap-go': capGo(); break;
    case 'undo': break;
    case 'granola': forceClose(); granolaSheet(); break;
    case 'g-import': b.disabled = true; try { await granolaImport(); } finally { b.disabled = false; } break;
    case 'g-sum': if (n) { b.disabled = true; await summarize(n); } break;
    case 'g-add': case 'g-addall': {
      if (!n || !n.summary) return;
      const list = a === 'g-add' ? [n.summary.todos[Number(b.dataset.i)]] : n.summary.todos;
      list.forEach(t => { const { date: d, text } = splitDate(t); data.tasks.unshift({ id: uid(), title: text, category: n.tab === 'Work' ? 'Work' : 'Personal', date: d, time: '', done: false, repeat: 'none', notes: 'From: ' + n.title }); });
      save(); notify(`${list.length} to-do${list.length > 1 ? 's' : ''} added.`);
      b.textContent = 'Added'; b.disabled = true;
      break;
    }
    case 'swap-day': swapDay(b.dataset.date); break;
    case 'folder-toggle': { const k = fKey(b.dataset.tab, b.dataset.folder); if (openFolders.has(k)) openFolders.delete(k); else { openFolders.add(k); const st = new Date().toISOString(); data.notes.filter(n => n.tab === b.dataset.tab && n.folder === b.dataset.folder).forEach(n => n.lastOpened = st); _save(); } ls.set('2b-openf', [...openFolders]); render(); break; }
    case 'note-toggle': { const id = b.dataset.id; if (openNotes.has(id)) openNotes.delete(id); else { openNotes.add(id); const n = data.notes.find(x => x.id === id); if (n) { n.lastOpened = new Date().toISOString(); _save(); } } render(); break; }
    case 'note-in-folder': { const keep = noteFolder; noteTab = b.dataset.tab; noteFolder = b.dataset.folder; noteEditor(); noteFolder = keep; break; }
    case 'sp-mic': spMicToggle(); break;
    case 'sp-filter': phraseFilter = b.dataset.v; render(); break;
    case 'phrase': { const p = data.notes.find(x => x.id === b.dataset.id); if (p) { normPhrase(p); p.lastOpened = new Date().toISOString(); phraseDetail(p, false); } break; }
    case 'phrase-reveal': { const p = data.notes.find(x => x.id === b.dataset.id); if (p) phraseDetail(p, true); break; }
    case 'phrase-review': { const p = data.notes.find(x => x.id === b.dataset.id); if (p) { recordReview(p, b.dataset.ok === '1'); forceClose(); render(); notify(b.dataset.ok === '1' ? 'Review saved. One box per day.' : 'Review saved. Keep practicing.'); } break; }
    case 'phrase-edit': { const p = data.notes.find(x => x.id === b.dataset.id); if (p) phraseEditor(p); break; }
    case 'phrase-save': { const p = data.notes.find(x => x.id === b.dataset.id); if (!p) break; const es = document.getElementById('pe-es').value.trim(); if (!es) { notify('Enter the Spanish phrase.'); break; } p.es = es; p.en = document.getElementById('pe-en').value.trim(); p.note = document.getElementById('pe-note').value.trim(); p.title = es.slice(0, 160); p.body = phraseBody(p); p.updated = new Date().toISOString(); save(); forceClose(); render(); notify('Phrase saved.'); break; }
    case 'phrase-del': { if (!confirm('Delete this phrase?')) break; data.notes = data.notes.filter(x => x.id !== b.dataset.id); save(); forceClose(); render(); notify('Deleted.'); break; }
    case 'quiz-start': forceClose(); startQuiz(); break;
    case 'quiz-answer': { const q = quiz; if (!q || q.answered) break; const p = data.notes.find(x => x.id === q.queue[0]); q.answered = true; q.picked = Number(b.dataset.i); const ok = q.options[q.picked] === p.en; recordReview(p, ok); if (ok) q.correct++; else q.missed++; renderQuiz(p); break; }
    case 'quiz-next': { const q = quiz; if (!q) break; const cur = q.queue.shift(), p = data.notes.find(x => x.id === cur); if (p && q.options[q.picked] !== p.en) q.queue.push(cur); quizQuestion(); break; }
    case 'quiz-done': forceClose(); noteTab = 'Spanish'; noteFolder = 'all'; go('notes'); break;
    case 'sync-settings': forceClose(); syncSheet(); break;
    case 's-save': {
      const url = (document.getElementById('s-url').value.match(/https:\/\/script\.google(?:usercontent)?\.com\/[^\s`'"<>]+?\/exec/) || [document.getElementById('s-url').value.trim()])[0], key = document.getElementById('s-key').value.replace(/[^A-Za-z0-9_-]/g, '');
      cfg.names = document.getElementById('s-names').value.trim(); learnNames();
      if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { notify('That should be the script.google.com …/exec link.'); return; }
      if (url && !key) { notify('Paste your key too: the long code after “Your 2nd Brain key:” in the Apps Script Execution log.'); document.getElementById('s-key').focus(); return; }
      if (url && !/\/exec(\?|$)/.test(url)) { notify('Use the Web app URL that ends in /exec (not /dev).'); return; }
      if (url !== cfg.url || key !== cfg.token) { cfg.since = 0; cfg.planAt = 0; hashes = null; markChanges(); Object.assign(dirty, Object.fromEntries(COLLS.flatMap(c => (data[c] || []).filter(x => syncable(c, x)).map(x => [c + '|' + x.id, { u: Date.now() }])))); }
      cfg.url = url; cfg.token = key; saveCfg(); forceClose();
      if (!url) { notify('Saved.'); break; }
      try { await api({ action: 'ping' }); notify('Connected. Syncing…'); sync(true); } catch (err) { cfg.status = 'Could not connect: ' + err.message; saveCfg(); paintStatus(); notify(cfg.status); }
      break;
    }
    case 's-plan': cfg.planAt = 0; saveCfg(); forceClose(); sync(true); break;
    case 's-strava': {
      b.disabled = true; b.textContent = 'Syncing Garmin…';
      try { const r = await api({ action: 'strava' }); cfg.strava = r.strava; cfg.planAt = 0; saveCfg(); forceClose(); notify(r.strava && r.strava.error ? 'Strava: ' + r.strava.error : `Garmin: ${r.added} new activit${r.added === 1 ? 'y' : 'ies'}.`); sync(); }
      catch (err) { notify(/unknown|action/i.test(err.message) ? 'Paste the latest Code.gs and deploy a New version first.' : 'Garmin sync: ' + err.message); b.disabled = false; b.textContent = 'Sync Garmin now'; }
      break;
    }
    case 's-off': cfg = { names: cfg.names }; saveCfg(); forceClose(); paintStatus(); notify('This device is no longer syncing. Your data stays here.'); break;
  }
}, true);
document.addEventListener('submit', e => {
  if (e.target.id !== 'sp-add') return; e.preventDefault(); e.stopImmediatePropagation();
  const es = document.getElementById('sp-es').value, en = document.getElementById('sp-en').value;
  if (addPhrase(es, en)) { render(); setTimeout(() => document.getElementById('sp-es')?.focus(), 30); }
}, true);
// Desktop: Ctrl/Cmd + J opens quick capture
addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); forceClose(); captureSheet(false); } });
// Home-screen shortcut: ?capture=1 opens capture with the mic; ?add=text runs a command directly
const q = new URLSearchParams(location.search);
if (q.get('add')) { runCommand(q.get('add'), { from: 'link' }); history.replaceState(null, '', location.pathname); }
else if (q.get('capture')) { setTimeout(() => captureSheet(true), 300); history.replaceState(null, '', location.pathname); }

/* ---------- Keep the bottom tray on the real bottom edge ----------
   Some in-app browsers (Google app, Gmail…) hide their toolbar without moving fixed elements. */
function pinBottom() {
  const vv = window.visualViewport; if (!vv) return;
  const off = Math.round(vv.offsetTop + vv.height - innerHeight);
  document.documentElement.style.setProperty('--vv-shift', (Math.abs(off) < 400 ? off : 0) + 'px');
}
if (window.visualViewport) { visualViewport.addEventListener('resize', pinBottom); visualViewport.addEventListener('scroll', pinBottom); }
addEventListener('scroll', pinBottom, { passive: true }); addEventListener('resize', pinBottom); pinBottom();

/* ---------- Pull down to sync everything ---------- */
let refreshing = false;
async function fullRefresh(manual) {
  if (refreshing) return; refreshing = true; ptrState('busy');
  try {
    checkUpdate();
    if (!cfg.url) { if (manual) notify('Connect Google sync first (the dot in the header).'); return; }
    let garmin = '';
    try { const r = await api({ action: 'strava' }); cfg.strava = r.strava; garmin = r.strava && r.strava.error ? 'Strava: ' + r.strava.error : r.added ? r.added + ' new Garmin activit' + (r.added === 1 ? 'y' : 'ies') : ''; } catch (e) { garmin = ''; }
    cfg.planAt = 0; saveCfg();
    await sync(false);
    if (manual) notify(/^Synced/.test(cfg.status || '') ? 'Synced: workouts, plan, calendar, notes.' + (garmin ? ' ' + garmin + '.' : '') : cfg.status);
  } finally { refreshing = false; ptrState(''); }
}
document.body.insertAdjacentHTML('beforeend', '<div class="ptr" id="ptr" aria-hidden="true"><span class="ptr-spin"></span><span class="ptr-t">Pull to sync</span></div>');
function ptrState(st, pull) {
  const el = document.getElementById('ptr'); if (!el) return;
  el.dataset.state = st; const t = el.querySelector('.ptr-t');
  if (st === 'busy') { el.style.transform = 'translate(-50%,12px)'; t.textContent = 'Syncing…'; }
  else if (st === 'pull') { el.style.transform = `translate(-50%,${Math.min(pull, 90) - 50}px)`; t.textContent = pull > 70 ? 'Release to sync' : 'Pull to sync'; el.classList.toggle('ready', pull > 70); }
  else { el.style.transform = ''; el.classList.remove('ready'); }
}
let ptr = null;
addEventListener('touchstart', e => { if (scrollY > 2 || $('#modal-root').children.length || drag || press || e.touches.length !== 1) { ptr = null; return; } ptr = { y: e.touches[0].clientY, d: 0 }; }, { passive: true });
addEventListener('touchmove', e => { if (!ptr || refreshing) return; ptr.d = e.touches[0].clientY - ptr.y; if (scrollY > 2 || drag) { ptr = null; ptrState(''); return; } if (ptr.d > 10) ptrState('pull', ptr.d * 0.6); }, { passive: true });
addEventListener('touchend', () => { if (!ptr) return; const go = ptr.d * 0.6 > 70; ptr = null; if (go) fullRefresh(true); else ptrState(''); });
// A browser reload (Safari's own pull-to-refresh) also runs the full sync
const navType = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] || {}).type;

if (firstRun) _save();
markChanges();
// Pull-to-refresh / reload keeps you on the page you were on (for this session)
let lastPage = page;
try {
  const v = JSON.parse(sessionStorage.getItem('2b-view') || 'null');
  if (v && ['home', 'todo', 'notes', 'workouts', 'habits', 'calendar'].includes(v.page)) {
    page = v.page; lastPage = page;
    if (v.noteTab) noteTab = v.noteTab; if (v.week) week = v.week; if (v.month) month = v.month; if (v.selectedDate) selectedDate = v.selectedDate; if (v.taskFilter) taskFilter = v.taskFilter;
    if (v.y) setTimeout(() => scrollTo(0, v.y), 50);
  }
} catch (e) {}
addEventListener('pagehide', () => { try { const v = JSON.parse(sessionStorage.getItem('2b-view') || '{}'); v.y = scrollY; sessionStorage.setItem('2b-view', JSON.stringify(v)); } catch (e) {} });
render();
if (cfg.url) { if (navType === 'reload') fullRefresh(true); else sync(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__2b = { addPhrase, startQuiz, phrases, runCommand, splitDate, parseDay, eventKind, localSummary, sync, loadPlan, cfg: () => cfg };
})();
