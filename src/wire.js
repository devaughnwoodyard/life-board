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
save = function () { const ok = _save(); markChanges(); schedule(); return ok; };
let timer = null, syncing = false, again = false;
function schedule(ms = 2500) { if (!cfg.url) return; clearTimeout(timer); timer = setTimeout(() => sync(), ms); }

// Fallback transport: a <script> tag (works where cross-site fetch is blocked)
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = '__2bcb' + Math.random().toString(36).slice(2), sc = document.createElement('script');
    const done = () => { delete window[cb]; sc.remove(); clearTimeout(t); };
    const t = setTimeout(() => { done(); rej(new Error('No reply from Google (blocked or old script version)')); }, 25000);
    window[cb] = j => { done(); res(j); };
    sc.onerror = () => { done(); rej(new Error('The script replied in the old format. Paste the latest Code.gs, deploy a New version, and make sure the URL here is that deployment\'s /exec link')); };
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
  return { id: 'ph-' + d.id, tab: 'Spanish', folder: 'Phrases', title: String(d.es || d.en).slice(0, 160), body, entered: at, updated: at, source: 'phrase' };
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
      const [sport, session, mins] = s || [];
      const kind = KIND(sport || ''); if (!kind || !session) return;
      const ai = acts.findIndex(a => a.kind === kind && !a.used); const act = ai >= 0 ? acts[ai] : null; if (act) act.used = true;
      const id = 'gp-' + p.date + '-' + slot.toLowerCase(), old = prev[id] || {};
      const target = Number(mins) || 30, mi = kind === 'Run' && Number(p.mi) ? Number(p.mi) : 0;
      out.push({
        id, title: String(session).trim().slice(0, 160), date: p.date, slot, kind, target, effort: EFFORT(session, kind),
        actual: act ? Number(act.min) || target : (old.actual != null ? old.actual : null), actualEffort: act ? old.actualEffort || null : old.actualEffort || null,
        notes: old.notes || (p.bail ? 'Bail rule: ' + p.bail : ''), plan: true, miles: mi || undefined, garmin: act ? { name: act.name || '', mi: act.mi || null, hr: act.hr || null } : undefined
      });
    });
  });
  if (!out.length) return false;
  data.workouts = (data.workouts || []).filter(w => !String(w.id).startsWith('gp-')).concat(out);
  cfg.planAt = Date.now(); cfg.garminAt = r.synced || ''; delete cfg.planError; saveCfg();
  return true;
}

// Efficiency counts planned sessions that came and went without a Garmin activity as 0%.
workoutScore = function () {
  const rows = data.workouts.filter(w => w.actual !== null || (w.plan && w.date < today));
  return rows.length ? Math.round(rows.reduce((s, w) => s + Math.min((w.actual || 0) / w.target, 1) * 100, 0) / rows.length) : 0;
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
    <ul class="cap-ex"><li><b>To do tomorrow, renew passport</b></li><li><b>To do [Nov 14] book flights at 7pm</b></li><li><b>Work to do Friday, send the deck</b></li><li><b>Work note Sprint planning, QA owner is Dana</b></li><li><b>Personal note</b> gift idea: cooking class → General</li></ul>
    <div class="cap-more"><button type="button" class="secondary" data-2b="cap-forms">More: event, workout, note, habit…</button></div></div>`, { kind: '2b-capture', form: false });
  const ta = document.getElementById('cap-text');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capGo(); } });
  if (autoMic) startMic(); else setTimeout(() => ta.focus(), 60);
}
function capGo() {
  const ta = document.getElementById('cap-text'); if (!ta) return;
  stopMic();
  const lines = ta.value.split(/\n(?=\s*(?:work\s+)?(?:to[\s-]?do|todo|work note|personal note|spanish note|note)\b)/i).map(s => s.trim()).filter(Boolean);
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

/* ---------- 8. Sync settings ---------- */
function syncSheet() {
  modal('Google sync', `<p class="muted" style="font-size:12px;line-height:1.6">Connects this device to your 2nd Brain Google Sheet: to-dos, notes, habits, workouts and events sync across devices; Google Calendar and the Little Elm training plan (with Garmin results) come in; note files go to the 2nd Brain Drive folder.</p>
    <label for="s-url">Apps Script web app URL</label><input id="s-url" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
    <label for="s-key">Key</label><input id="s-key" value="${esc(cfg.token || '')}" placeholder="From the setup() log" autocomplete="off">
    <label for="s-names">Names that mean “with people” on your calendar</label><input id="s-names" value="${esc(cfg.names || '')}" placeholder="e.g. Steph, Kofi, Dana">
    <p class="cap-status">App build: <b>${esc(document.querySelector('meta[name="2b-build"]')?.content || 'dev')}</b></p><p class="cap-status" id="s-status">${esc(cfg.status || 'Not connected yet.')}${cfg.planError ? '<br>Plan: ' + esc(cfg.planError) : ''}${cfg.url ? '<br>Garmin activities: ' + (cfg.garminAt ? 'last synced ' + esc(new Date(cfg.garminAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : 'not connected yet (run connectStrava in Apps Script)') : ''}</p>
    <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">${cfg.url ? '<button type="button" class="danger" data-2b="s-off">Disconnect</button><button type="button" class="secondary" data-2b="s-plan">Reload training plan</button>' : ''}<button type="button" class="primary" data-2b="s-save">${cfg.url ? 'Save and sync now' : 'Connect'}</button></div>`, { kind: '2b-sync', form: false });
}
function paintStatus() {
  const el = document.getElementById('s-status'); if (el) el.textContent = cfg.status || '';
  document.querySelectorAll('.sync-dot').forEach(dot => { dot.dataset.state = /^Synced/.test(cfg.status || '') ? 'ok' : /^Syncing/.test(cfg.status || '') ? 'busy' : cfg.url ? 'err' : 'off'; dot.title = cfg.status || 'Google sync: not connected'; });
}

/* ---------- 9. Decorate the rendered page ---------- */
const _render = render;
render = function () {
  _render();
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
  // workouts: where the plan comes from
  const wc = document.querySelector('.week-control');
  if (page === 'workouts' && wc && cfg.url) wc.insertAdjacentHTML('afterend', `<p class="plan-src">Plan: Little Elm sheet${cfg.planError ? ' · not loaded: ' + esc(cfg.planError) : ''} · Garmin: ${cfg.garminAt ? 'synced ' + esc(new Date(cfg.garminAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : 'not connected'}</p>`);
  document.querySelectorAll('.session').forEach(el => {
    const b = el.querySelector('[data-act="workout-edit"]'); const w = b && data.workouts.find(x => x.id === b.dataset.id);
    if (w && w.garmin) { el.classList.add('from-garmin'); el.querySelector('small')?.insertAdjacentHTML('beforeend', ` · ✓ ${w.garmin.mi ? w.garmin.mi + ' mi' : ''}${w.garmin.hr ? ' · ' + w.garmin.hr + ' bpm' : ''}`); }
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
    case 'sync-settings': forceClose(); syncSheet(); break;
    case 's-save': {
      const url = document.getElementById('s-url').value.trim(), key = document.getElementById('s-key').value.trim();
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
    case 's-off': cfg = { names: cfg.names }; saveCfg(); forceClose(); paintStatus(); notify('This device is no longer syncing. Your data stays here.'); break;
  }
}, true);
// Desktop: Ctrl/Cmd + J opens quick capture
addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); forceClose(); captureSheet(false); } });
// Home-screen shortcut: ?capture=1 opens capture with the mic; ?add=text runs a command directly
const q = new URLSearchParams(location.search);
if (q.get('add')) { runCommand(q.get('add'), { from: 'link' }); history.replaceState(null, '', location.pathname); }
else if (q.get('capture')) { setTimeout(() => captureSheet(true), 300); history.replaceState(null, '', location.pathname); }

if (firstRun) _save();
markChanges();
render();
if (cfg.url) sync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__2b = { runCommand, splitDate, parseDay, eventKind, localSummary, sync, loadPlan, cfg: () => cfg };
})();
