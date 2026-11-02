/* ===== 2nd Brain: real-app wiring =====
   Runs after the mockup script. Adds: Google sync (Apps Script), Google Calendar, training plan,
   Drive file upload/download, quick capture with voice + commands, Granola import + summaries. */
(() => {
'use strict';
const CFG_KEY = '2b-sync', HASH_KEY = '2b-hash', DIRTY_KEY = '2b-dirty', CAL_KEY = '2b-cal';
const COLLS = ['tasks', 'notes', 'folders', 'habits', 'phrases', 'workouts'];
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
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => localDay();
const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };

/* ---------- 1. Real app, not a preview ---------- */
// Start empty instead of with demo content (once per device).
if (data.__demo) {
  ['tasks', 'notes', 'habits', 'phrases', 'workouts'].forEach(c => { data[c] = []; });
  data.folders = [];
  try { LBF.del && LBF.del('a_sample1'); } catch (e) {}
  delete data.__demo;
}
function generalFolder(tab) {
  let f = data.folders.find(x => x.tab === tab && /^general$/i.test(x.name));
  if (!f) { f = { id: 'f' + Math.random().toString(36).slice(2, 9), tab, name: 'General', created: today() }; data.folders.push(f); }
  return f;
}
generalFolder('work'); generalFolder('personal');
// Layout follows the screen: desktop command center at 900px+, mobile below.
function fitView() {
  const want = canDesk() ? 'desktop' : 'phone';
  if (state.view !== want) { state.view = want; if (want === 'phone' && state.tab === 'dashboard') state.tab = 'todo'; paintViewbar(); return true; }
  return false;
}
fitView();
addEventListener('resize', () => { if (fitView()) render({ preserveScroll: true }); });

/* ---------- 2. Change tracking + sync ---------- */
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h.toString(36); };
const syncable = (c, x) => x && x.id != null && !(c === 'workouts' && String(x.id).startsWith('gp-'));
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
save = function () { _save(); markChanges(); schedule(); };
let timer = null, syncing = false, again = false;
function schedule(ms = 2500) { if (!cfg.url) return; clearTimeout(timer); timer = setTimeout(() => sync(), ms); }

// Fallback transport: a <script> tag (works where cross-site fetch is blocked)
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = '__2bcb' + Math.random().toString(36).slice(2), sc = document.createElement('script');
    const done = () => { delete window[cb]; sc.remove(); clearTimeout(t); };
    const t = setTimeout(() => { done(); rej(new Error('No reply from Google (blocked or old script version)')); }, 25000);
    window[cb] = j => { done(); res(j); };
    sc.onerror = () => { done(); rej(new Error('Google blocked the request. Check the deployment access is Anyone')); };
    sc.src = url + '&callback=' + cb; document.head.appendChild(sc);
  });
}
async function api(body) {
  if (!cfg.url) throw new Error('Paste the web app URL (ends in /exec)');
  if (!cfg.token) throw new Error('Paste your key from the setup() log');
  const payload = JSON.stringify(Object.assign({}, body, { token: cfg.token }));
  let r;
  // Small requests go as GET (most reliable with Apps Script redirects); big ones (files, large syncs) as POST.
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

// Rows written by the older Life Board app use a different shape: translate them on the way in.
function fromOldApp(c, d) {
  if (!d || typeof d !== 'object') return null;
  if (c === 'tasks') {
    if (d.src === 'gcal' || d.dropped) return null;
    if (d.minutes != null && 'effort' in d) return d;
    return { id: d.id, title: d.title || '(untitled)', date: d.date || '', time: d.time || '', minutes: d.dur || 15, effort: d.effort || 3, note: d.note || '', done: !!d.done || d.status === 'done' };
  }
  if (c === 'notes') {
    if (d.tab && d.folder) return d;
    const tab = d.tab || (d.realm === 'work' || /work/i.test(d.cat || '') ? 'work' : 'personal');
    return Object.assign({ reviews: [], pinned: false, files: [] }, d, { tab, folder: d.folder || generalFolder(tab).id, title: d.title || String(d.body || d.text || '').split('\n')[0].slice(0, 80) || 'Note', body: d.body != null ? d.body : esc(d.text || '').replace(/\n/g, '<br>'), updated: d.updated || today() });
  }
  if (c === 'habits') {
    if (Array.isArray(d.days)) return d;
    const log = d.log || d.done || d.checks || {};
    return { id: d.id, title: d.title || d.name || 'Habit', goal: d.goal || d.target || '', days: Array.isArray(log) ? log : Object.keys(log).filter(k => log[k]) };
  }
  return d;
}
async function sync(manual) {
  if (!cfg.url) { if (manual) syncSheet(); return; }
  if (syncing) { again = true; return; }
  syncing = true; cfg.status = 'Syncing…'; paintStatus();
  try {
    markChanges();
    const sent = {};
    const rows = Object.entries(dirty).map(([k, v]) => {
      const i = k.indexOf('|'), c = k.slice(0, i), idv = k.slice(i + 1);
      sent[k] = v.u;
      const item = (data[c] || []).find(x => String(x.id) === idv);
      return v.del || !item ? { c, id: idv, u: v.u, del: 1 } : { c, id: idv, u: v.u, d: item };
    });
    const res = await api({ action: 'sync', since: cfg.since || 0, rows, cal: 75 });
    Object.keys(sent).forEach(k => { if (dirty[k] && dirty[k].u === sent[k]) delete dirty[k]; });
    let changed = false;
    (res.rows || []).forEach(r => {
      if (!COLLS.includes(r.c) || dirty[r.c + '|' + r.id]) return;
      if (!r.del) { r.d = fromOldApp(r.c, r.d); if (!r.d) return; }
      const list = data[r.c] = data[r.c] || [];
      const at = list.findIndex(x => String(x.id) === String(r.id));
      if (r.del) { if (at >= 0) { list.splice(at, 1); changed = true; } }
      else if (at >= 0) { if (JSON.stringify(list[at]) !== JSON.stringify(r.d)) { list[at] = r.d; changed = true; } }
      else { list.push(r.d); changed = true; }
    });
    cfg.since = res.now;
    if (res.cal) { calCache = res.cal; ls.set(CAL_KEY, calCache); learnNames(); changed = true; }
    if (Date.now() - (cfg.planAt || 0) > 3 * 36e5) { try { if (await loadPlan()) changed = true; } catch (e) { cfg.planError = e.message; } }
    if (changed) { _save(); hashes = null; markChanges(); }
    (res.inbox || []).forEach(x => runCommand(x.text, { from: 'Siri' }));
    cfg.status = 'Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    cfg.lastOk = Date.now(); saveCfg();
    if (changed && !state.modal) render({ preserveScroll: true });
    if (manual) toast('Synced with Google.');
    uploadFiles();
  } catch (e) {
    cfg.status = 'Not synced: ' + e.message; saveCfg();
    if (manual) toast('Sync failed: ' + e.message);
  } finally {
    syncing = false; paintStatus();
    if (again) { again = false; schedule(500); }
  }
}
addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 5 * 60 * 1000);

/* ---------- 3. Drive files ---------- */
const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
let uploading = false;
async function uploadFiles() {
  if (uploading || !cfg.url) return; uploading = true;
  let changed = false;
  try {
    for (const n of data.notes || []) for (const f of n.files || []) {
      if (f.drive !== 'pending') continue;
      const blob = await LBF.get(f.id); if (!blob) continue;
      const fo = data.folders.find(x => x.id === n.folder);
      try {
        const r = await api({ action: 'file', name: f.name, mime: f.type || 'application/octet-stream', b64: await toB64(blob), work: n.tab === 'work', folder: fo ? fo.name : 'General' });
        Object.assign(f, { drive: 'saved', driveId: r.id, url: r.url }); changed = true;
      } catch (e) { cfg.status = 'File upload failed: ' + e.message; }
    }
  } finally { uploading = false; }
  if (changed) save();
}
const _lbDownload = lbDownload;
lbDownload = async function (n, fid) {
  const f = (n.files || []).find(x => x.id === fid);
  if (f && f.driveId && !(await LBF.get(fid))) {
    try {
      toast('Getting the file from Google Drive…');
      const r = await api({ action: 'getfile', id: f.driveId });
      const bin = atob(r.b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await LBF.put(fid, new Blob([arr], { type: r.mime || f.type }));
    } catch (e) { if (f.url) { open(f.url, '_blank'); return; } toast('Could not get the file: ' + e.message); return; }
  }
  return _lbDownload(n, fid);
};

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
events = function () {
  return calCache.map(e => {
    const k = eventKind(e);
    return { id: e.id, date: e.date, time: e.time || '', end: addMin(e.time, e.dur), title: e.title, people: k.people, appt: k.appt, location: e.loc || '', source: e.cal || 'Google Calendar', allDay: !e.time };
  }).sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
};

/* ---------- 5. Training plan from the Little Elm sheet ---------- */
const KIND = s => /run|race/i.test(s) ? 'run' : /bike|ride|spin/i.test(s) ? 'bike' : /swim/i.test(s) ? 'swim' : /yoga|mobility/i.test(s) ? 'yoga' : /upper|legs|plyo|strength/i.test(s) ? 'workout' : '';
const EFFORT = (s, kind) => /threshold|tempo|goal hm|vo2|sweet spot|race|hill/i.test(s) ? 8 : /long/i.test(s) ? 6 : kind === 'workout' ? 6 : kind === 'yoga' ? 2 : 4;
async function loadPlan() {
  const r = await api({ action: 'plan' });
  const out = [];
  (r.rows || []).forEach(p => {
    [['AM', p.am], ['PM', p.pm]].forEach(([slot, s]) => {
      const [sport, session, mins] = s || [];
      const kind = KIND(sport || ''); if (!kind || !session) return;
      const mi = kind === 'run' && Number(p.mi) ? Number(p.mi) : 0;
      const act = p.act && p.act.sport && KIND(p.act.sport) === kind ? p.act : null;
      const m = Number(mins) || 0;
      out.push({
        id: 'gp-' + p.date + '-' + slot.toLowerCase(), kind, title: String(session).split(/[:(]/)[0].trim().slice(0, 60) || sport, detail: session,
        date: p.date, time: slot, duration: m, distance: mi ? mi + ' mi' : m + ' min',
        planned: mi || m, unit: mi ? 'mi' : 'min', basis: mi ? 'distance' : 'minutes', effort: EFFORT(session, kind),
        actual: act ? (mi ? mi : Number(act.min) || m) : null, actualMinutes: act ? Number(act.min) || null : null, actualEffort: null,
        notes: p.bail || '', done: !!act, source: 'plan'
      });
    });
  });
  if (!out.length) return false;
  data.workouts = (data.workouts || []).filter(w => !String(w.id).startsWith('gp-')).concat(out);
  data.volSeed = true; cfg.planAt = Date.now(); delete cfg.planError; saveCfg();
  return true;
}

/* ---------- 6. Quick capture: commands + voice ---------- */
const WD = { sun: 'sunday', mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday' };
const DATEISH = /^(today|tonight|tomorrow|tmrw|next week|in \d+ days?|(next |this )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?(,? \d{4})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{2}-\d{2})$/i;
function parseDay(phrase) {
  let p = String(phrase || '').toLowerCase().trim().replace(/^(on|for|by|due|this)\s+/, '').replace(/[.!]$/, '').trim();
  if (!DATEISH.test(p)) return '';
  if (p === 'tonight') return today();
  if (p === 'tmrw') return plusDays(today(), 1);
  if (p === 'next week') return plusDays(today(), 7);
  let m = p.match(/^in (\d+) days?$/); if (m) return plusDays(today(), Number(m[1]));
  m = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) { let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : new Date().getFullYear(); const d = new Date(y, Number(m[1]) - 1, Number(m[2])); if (!m[3] && localDay(d) < plusDays(today(), -60)) d.setFullYear(y + 1); return localDay(d); }
  p = p.replace(/(\d)(st|nd|rd|th)\b/, '$1').replace(/,/g, '').replace(/\bsept\b/, 'sep');
  const w = p.replace(/^next\s+/, '').match(/^([a-z]+)$/);
  if (w && WD[w[1].slice(0, 4)] || (w && WD[w[1].slice(0, 3)])) p = p.replace(w[1], WD[w[1].slice(0, 4)] || WD[w[1].slice(0, 3)]);
  let d = parseDateQuery(p) || '';
  if (d && !/\d{4}/.test(p) && /[a-z]/.test(p) && !/day$/.test(p) && d < plusDays(today(), -60)) d = plusDays(d, 365);
  return d;
}
function splitDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^\[([^\]]+)\][\s,:-]*(.*)$/s);
  if (m) { const d = parseDay(m[1]); return { date: d, text: m[2].trim() || m[1] }; }
  const c = s.indexOf(',');
  if (c > 0) { const d = parseDay(s.slice(0, c)); if (d) return { date: d, text: s.slice(c + 1).trim() }; }
  const words = s.split(/\s+/);
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) { const d = parseDay(words.slice(0, k).join(' ')); if (d) return { date: d, text: words.slice(k).join(' ').replace(/^[,:-]\s*/, '') }; }
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) { const tail = words.slice(-k).join(' '); if (!/^(on|by|for|due|this|next|today|tonight|tomorrow)\b/i.test(tail) && !/^(today|tonight|tomorrow)/i.test(tail)) continue; const d = parseDay(tail); if (d) return { date: d, text: words.slice(0, -k).join(' ').replace(/[,\s]+$/, '') }; }
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
function findFolder(tab, name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  const fs = data.folders.filter(f => f.tab === tab);
  return fs.find(f => f.name.toLowerCase() === n) || fs.find(f => f.name.toLowerCase().startsWith(n)) || fs.find(f => n.startsWith(f.name.toLowerCase())) || null;
}
function splitFolder(s, tab) {
  s = String(s || '').trim();
  let m = s.match(/^\[([^\]]+)\][\s,:-]*(.*)$/s) || s.match(/^(?:in\s+)?folder\s+([^,:]+)[,:]\s*(.*)$/is);
  if (m) { let f = findFolder(tab, m[1]); if (!f) { f = { id: 'f' + Math.random().toString(36).slice(2, 9), tab, name: m[1].trim().slice(0, 60), created: today() }; data.folders.push(f); } return { folder: f, text: m[2].trim() }; }
  const c = s.search(/[,:]/);
  if (c > 0 && c < 60) { const f = findFolder(tab, s.slice(0, c)); if (f) return { folder: f, text: s.slice(c + 1).trim() }; }
  return { folder: generalFolder(tab), text: s };
}
function normalizeSpoken(t) {
  return String(t || '').trim()
    .replace(/\s*\b(comma)\b\s*/gi, ', ').replace(/\s*\b(colon)\b\s*/gi, ': ')
    .replace(/\s*\b(period|full stop)\b\s*/gi, '. ').replace(/\s*\bnew line\b\s*/gi, '\n')
    .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
}
const fmtDay = d => d ? new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';
function runCommand(raw, opt = {}) {
  const t = normalizeSpoken(raw); if (!t) return null;
  let m = t.match(/^(work|personal)\s+notes?\b[\s,:.-]*(.*)$/is) || t.match(/^(note)\b[\s,:.-]*(.*)$/is);
  if (m) {
    const tab = /^work/i.test(m[1]) ? 'work' : 'personal';
    const { folder, text } = splitFolder(m[2], tab);
    if (!text) { toast('Say what the note should say after the folder.'); return null; }
    const first = text.split(/(?<=[.!?])\s|\n/)[0];
    const title = (first.length > 70 ? first.slice(0, 67).trim() + '…' : first).replace(/[.]$/, '');
    const Title = title.charAt(0).toUpperCase() + title.slice(1);
    const n = { id: id(), tab, title: Title, body: esc(text).replace(/\n/g, '<br>'), folder: folder.id, entered: new Date().toISOString(), updated: today(), reviews: [], nextReview: today(), pinned: false, files: [], source: opt.from ? 'capture-' + opt.from : 'capture' };
    data.notes.push(n); save(); if (!state.modal) render({ preserveScroll: true });
    undoToast(`${tab === 'work' ? 'Work' : 'Personal'} note saved in ${folder.name}${opt.from ? ' (from ' + opt.from + ')' : ''}.`, () => { data.notes = data.notes.filter(x => x !== n); save(); render({ preserveScroll: true }); });
    return n;
  }
  m = t.match(/^(?:to[\s-]?dos?|todo|task|reminder)\b[\s,:.-]*(.*)$/is);
  const body = m ? m[1] : t;
  let { date, text } = splitDate(body);
  const tm = takeTime(text); text = tm.text.replace(/^[,:\-\s]+|[,\s]+$/g, '');
  if (!text) { toast('Say what the to-do is after the date.'); return null; }
  const task = { id: id(), title: text.charAt(0).toUpperCase() + text.slice(1), date, time: tm.time, minutes: 15, effort: 3, note: '', done: false };
  data.tasks.push(task); save(); if (!state.modal) render({ preserveScroll: true });
  undoToast(`To-do added${date ? ' for ' + fmtDay(date) : ' to Today'}${tm.time ? ' at ' + tm.time : ''}${opt.from ? ' (from ' + opt.from + ')' : ''}.`, () => { data.tasks = data.tasks.filter(x => x !== task); save(); render({ preserveScroll: true }); });
  return task;
}

let rec = null, listening = false, base = '';
function micButton() { return document.querySelector('[data-2b="mic"]'); }
function setMic(on, msg) {
  listening = on; const b = micButton(); const st = document.getElementById('cap-status');
  if (b) { b.classList.toggle('listening', on); b.innerHTML = icon(on ? 'stop' : 'mic') + (on ? 'Stop' : 'Speak'); }
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
// Notes dictation in the mockup uses continuous mode, which iOS Safari stops early; keep it single-shot there.
if (isIOS && window.webkitSpeechRecognition) {
  const Orig = window.webkitSpeechRecognition;
  window.webkitSpeechRecognition = class extends Orig { set continuous(v) { super.continuous = false; } get continuous() { return false; } };
  window.SpeechRecognition = window.webkitSpeechRecognition;
}

function captureSheet(autoMic) {
  sheet('Quick capture', `<div class="cap">
    <textarea id="cap-text" rows="4" placeholder="To do Friday, call the dentist&#10;Work note Vendors, pricing came in 8% higher" autocapitalize="sentences" enterkeyhint="done"></textarea>
    <div class="cap-row"><button type="button" class="cap-mic" data-2b="mic">${icon('mic')}Speak</button><button type="button" class="cap-go" data-2b="cap-go">Add</button></div>
    <p class="cap-status" id="cap-status" role="status">Start with <b>To do</b> (and a day) or <b>Work note</b> / <b>Personal note</b> (and a folder). Anything else becomes a to-do for Today.</p>
    <ul class="cap-ex"><li><b>To do tomorrow, renew passport</b></li><li><b>To do [Nov 14] book flights at 7pm</b></li><li><b>Work note Sprint planning, QA owner is Dana</b></li><li><b>Personal note</b> gift idea: cooking class → General</li></ul></div>`, { kind: '2b-capture' });
  const ta = document.getElementById('cap-text');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capGo(); } });
  if (autoMic) startMic(); else setTimeout(() => ta.focus(), 60);
}
function capGo() {
  const ta = document.getElementById('cap-text'); if (!ta) return;
  stopMic();
  const lines = ta.value.split(/\n(?=\s*(?:to[\s-]?do|todo|work note|personal note|note)\b)/i).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { ta.focus(); return; }
  closeModal();
  lines.forEach(l => runCommand(l));
}

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
  return d || today();
}
function localSummary(n, md) {
  const text = md || (() => { const b = document.createElement('div'); b.innerHTML = n.body || ''; return b.innerText; })();
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
    if (item && item.length < 200 && (box || explicit || (isAction(section) && b !== l || isAction(section)) || (owned && /^\s*(?:[-*•]|\d+[.)])/.test(l))))
      todos.push(item.replace(/^(todo|to do|action item|action|ai)\s*[:\-]\s*/i, ''));
  }
  if (!topics.length) lines.filter(l => /^\s*[-*•]\s+/.test(l)).slice(0, 5).forEach(l => topics.push(l.replace(/^\s*[-*•]\s+/, '').slice(0, 90)));
  return { date: n.meetingDate || today(), topics: [...new Set(topics)].slice(0, 8), todos: [...new Set(todos)].slice(0, 12) };
}
async function summarize(n) {
  toast('Summarizing…');
  const blob = await (async () => { const f = (n.files || []).find(x => /\.(md|txt|markdown)$/i.test(x.name)); return f ? LBF.get(f.id) : null; })();
  const md = blob ? await blob.text() : '';
  let s = null;
  if (cfg.url) { try { const r = await api({ action: 'summarize', title: n.title, date: n.meetingDate || '', text: (md || n.body || '').slice(0, 60000) }); s = r.summary; s.by = 'Claude'; } catch (e) { s = null; } }
  if (!s) s = localSummary(n, md);
  s.date = s.date || n.meetingDate || today(); s.at = new Date().toISOString();
  n.summary = s;
  const out = `# Summary: ${n.title}\n\nDate: ${s.date}\n\n## Main topics\n${s.topics.map(t => '- ' + t).join('\n') || '- (none found)'}\n\n## To-dos\n${s.todos.map(t => '- [ ] ' + t).join('\n') || '- (none found)'}\n`;
  const fid = 'a' + Math.random().toString(36).slice(2, 10), name = ('Summary - ' + n.title).replace(/[\\/:*?"<>|]/g, '').slice(0, 90) + '.md';
  n.files = (n.files || []).filter(f => !f.summary);
  await LBF.put(fid, new Blob([out], { type: 'text/markdown' }));
  n.files.push({ id: fid, name, size: out.length, type: 'text/markdown', added: today(), drive: 'pending', summary: true });
  n.updated = today(); save(); lbReader(n);
}
function summaryBlock(n) {
  const s = n.summary; if (!s) return '';
  return `<section class="g-sum"><p class="eyebrow">Summary · ${esc(fmtDay(s.date))}${s.by ? ' · ' + esc(s.by) : ''}</p>
    <h3>Main topics</h3><ul>${s.topics.map(t => `<li>${esc(t)}</li>`).join('') || '<li>None found</li>'}</ul>
    <h3>To-dos</h3><ul class="g-todos">${s.todos.map((t, i) => `<li><span>${esc(t)}</span><button type="button" data-2b="g-add" data-id="${n.id}" data-i="${i}">Add</button></li>`).join('') || '<li>None found</li>'}</ul>
    ${s.todos.length ? `<button type="button" class="wide-button" data-2b="g-addall" data-id="${n.id}">Add all ${s.todos.length} to my to-dos</button>` : ''}</section>`;
}
const _lbReader = lbReader;
lbReader = function (n) {
  _lbReader(n);
  const root = document.querySelector('#modal-root .sheet'); if (!root || !n) return;
  const edit = root.querySelector('[data-action="lbn-edit"]');
  const meta = n.source === 'granola' ? `<p class="g-meta">Imported from Granola · meeting ${esc(fmtDay(n.meetingDate))}</p>` : '';
  const btn = n.source === 'granola' ? `<button type="button" class="wide-button g-btn" data-2b="g-sum" data-id="${n.id}">${n.summary ? 'Redo summary' : 'Summary'}</button>` : '';
  const title = root.querySelector('.lbn-r-title'); if (title && meta) title.insertAdjacentHTML('afterend', meta);
  if (edit) edit.insertAdjacentHTML('beforebegin', summaryBlock(n) + btn);
};
function granolaSheet() {
  const tab = state.binder === 'personal' ? 'personal' : 'work';
  const opts = t => data.folders.filter(f => f.tab === t).map(f => `<option value="${f.id}" ${/^general$/i.test(f.name) ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  sheet('Import Granola notes', `<p class="description">In Granola, open a note › <b>Copy</b> (as Markdown) and paste below, or export notes as .md/.txt files and pick them. Each one becomes a note; the original file is saved to Google Drive.</p>
    <label for="g-files">Files</label><input id="g-files" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple>
    <label for="g-paste">Or paste a note</label><textarea id="g-paste" rows="6" placeholder="# Weekly sync with Dana&#10;Date: Nov 2, 2026&#10;### Decisions&#10;- …"></textarea>
    <label for="g-tab">Notebook</label><select id="g-tab"><option value="work" ${tab === 'work' ? 'selected' : ''}>Work</option><option value="personal" ${tab === 'personal' ? 'selected' : ''}>Personal</option></select>
    <label for="g-folder">Folder</label><select id="g-folder">${opts(tab)}</select>
    <button type="button" class="submit" data-2b="g-import">Import</button>`, { kind: '2b-granola' });
  document.getElementById('g-tab').addEventListener('change', e => { generalFolder(e.target.value); document.getElementById('g-folder').innerHTML = opts(e.target.value); });
}
async function granolaImport() {
  const files = [...(document.getElementById('g-files').files || [])];
  const paste = document.getElementById('g-paste').value.trim();
  const tab = document.getElementById('g-tab').value, folder = document.getElementById('g-folder').value || generalFolder(tab).id;
  const items = [];
  for (const f of files) items.push({ md: await f.text(), file: f });
  if (paste) items.push({ md: paste, file: null });
  if (!items.length) { toast('Pick a file or paste a note first.'); return; }
  const made = [];
  for (const it of items) {
    const h = it.md.match(/^#\s+(.+)$/m) || it.md.match(/^title:\s*(.+)$/im);
    const title = (h ? h[1] : it.file ? it.file.name.replace(/\.[^.]+$/, '') : it.md.split('\n')[0]).replace(/[#*]/g, '').trim().slice(0, 160) || 'Granola note';
    const date = meetingDate(it.md, it.file);
    const fid = 'a' + Math.random().toString(36).slice(2, 10);
    const fname = it.file ? it.file.name : (date + ' ' + title).replace(/[\\/:*?"<>|]/g, '').slice(0, 90) + '.md';
    await LBF.put(fid, it.file || new Blob([it.md], { type: 'text/markdown' }));
    const n = { id: id(), tab, title, body: mdToHTML(it.md.replace(/^---[\s\S]*?---\s*/, '')), folder, entered: new Date().toISOString(), updated: today(), meetingDate: date, source: 'granola', reviews: [], nextReview: today(), pinned: false, files: [{ id: fid, name: fname, size: it.md.length, type: 'text/markdown', added: today(), drive: 'pending' }] };
    data.notes.push(n); made.push(n);
  }
  state.binder = tab; state.lbOpen = state.lbOpen || {}; state.lbOpen[tab] = folder;
  save(); closeModal(); render({ preserveScroll: true });
  toast(`Imported ${made.length} Granola note${made.length > 1 ? 's' : ''}. Open one and tap Summary.`);
}

/* ---------- 8. Sync settings ---------- */
function syncSheet() {
  sheet('Google sync', `<p class="description">Connects this device to your 2nd Brain Google Sheet: to-dos, notes, folders, habits and Spanish sync across devices; Google Calendar and your Little Elm training plan come in; note files are saved to the 2nd Brain Drive folder.</p>
    <label for="s-url">Apps Script web app URL</label><input id="s-url" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
    <label for="s-key">Key</label><input id="s-key" value="${esc(cfg.token || '')}" placeholder="From the setup() log" autocomplete="off">
    <label for="s-names">Names that mean “with people” on your calendar</label><input id="s-names" value="${esc(cfg.names || '')}" placeholder="e.g. Steph, Kofi, Dana">
    <p class="cap-status">App build: <b>${esc(document.querySelector('meta[name="2b-build"]')?.content || 'dev')}</b></p><p class="cap-status" id="s-status">${esc(cfg.status || 'Not connected yet.')}${cfg.planError ? '<br>Plan: ' + esc(cfg.planError) : ''}</p>
    <button type="button" class="submit" data-2b="s-save">${cfg.url ? 'Save and sync now' : 'Connect'}</button>
    ${cfg.url ? '<button type="button" class="wide-button" data-2b="s-plan">Reload training plan</button><button type="button" class="danger" data-2b="s-off">Disconnect this device</button>' : ''}`, { kind: '2b-sync' });
}
function paintStatus() { const el = document.getElementById('s-status'); if (el) el.textContent = cfg.status || ''; const dot = document.getElementById('sync-dot'); if (dot) dot.dataset.state = /^Synced/.test(cfg.status || '') ? 'ok' : /^Syncing/.test(cfg.status || '') ? 'busy' : cfg.url ? 'err' : 'off'; }

/* ---------- 9. Buttons, menu, events ---------- */
document.body.insertAdjacentHTML('beforeend', `<button class="cap-fab" id="cap-fab" data-2b="capture" aria-label="Quick capture by voice or text">${icon('mic')}</button><button class="sync-dot" id="sync-dot" data-2b="sync-settings" aria-label="Google sync settings" title="Google sync"></button>`);
paintStatus();
const _finalMenu = finalMenu;
finalMenu = function () {
  _finalMenu();
  const box = document.querySelector('#modal-root .final-menu');
  if (box) box.insertAdjacentHTML('afterbegin', `<button data-2b="capture">${icon('mic')}Quick capture · voice or text</button><button data-2b="granola">${icon('book')}Import Granola notes</button><button data-2b="sync-settings">${icon('spark')}Google sync · ${esc(cfg.url ? (cfg.status || 'connected') : 'not connected')}</button>`);
};
// "Import from Granola" next to the new-note button in Work / Personal
const _render = render;
render = function (o) {
  const out = _render(o);
  if (state.binder !== 'spanish') document.querySelectorAll('[data-action="lbn-new"]').forEach(b => {
    if (b.parentElement && !b.parentElement.querySelector('[data-2b="granola"]') && !b.closest('.sheet')) b.insertAdjacentHTML('afterend', `<button type="button" class="g-import-btn" data-2b="granola">${icon('book')}Import Granola</button>`);
  });
  return out;
};

addEventListener('click', async e => {
  const b = e.target.closest('[data-2b]'); if (!b) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const a = b.dataset['2b'], n = b.dataset.id && data.notes.find(x => x.id === b.dataset.id);
  switch (a) {
    case 'capture': if (state.modal) closeModal(); captureSheet(false); break;
    case 'mic': listening ? stopMic() : startMic(); break;
    case 'cap-go': capGo(); break;
    case 'granola': if (state.modal) closeModal(); granolaSheet(); break;
    case 'g-import': b.disabled = true; try { await granolaImport(); } finally { b.disabled = false; } break;
    case 'g-sum': if (n) { b.disabled = true; await summarize(n); } break;
    case 'g-add': case 'g-addall': {
      if (!n || !n.summary) return;
      const list = a === 'g-add' ? [n.summary.todos[Number(b.dataset.i)]] : n.summary.todos;
      list.forEach(t => { const { date, text } = splitDate(t); data.tasks.push({ id: id(), title: text, date, time: '', minutes: 15, effort: 3, note: 'From: ' + n.title, done: false }); });
      save(); toast(`${list.length} to-do${list.length > 1 ? 's' : ''} added.`);
      if (a === 'g-add') { b.textContent = 'Added'; b.disabled = true; } else { b.textContent = 'Added'; b.disabled = true; }
      break;
    }
    case 'sync-settings': if (state.modal) closeModal(); syncSheet(); break;
    case 's-save': {
      const url = document.getElementById('s-url').value.trim(), key = document.getElementById('s-key').value.trim();
      cfg.names = document.getElementById('s-names').value.trim(); learnNames();
      if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('That should be the script.google.com …/exec link.'); return; }
      if (url && !key) { toast('Paste your key too: it’s the long code after “Your 2nd Brain key:” in the Apps Script Execution log.'); document.getElementById('s-key').focus(); return; }
      if (url && !/\/exec(\?|$)/.test(url)) { toast('Use the Web app URL that ends in /exec (not /dev).'); return; }
      if (url !== cfg.url || key !== cfg.token) { cfg.since = 0; cfg.planAt = 0; hashes = null; markChanges(); Object.assign(dirty, Object.fromEntries(COLLS.flatMap(c => (data[c] || []).filter(x => syncable(c, x)).map(x => [c + '|' + x.id, { u: Date.now() }])))); }
      cfg.url = url; cfg.token = key; saveCfg(); closeModal();
      if (!url) { toast('Saved.'); break; }
      try { await api({ action: 'ping' }); toast('Connected. Syncing…'); sync(true); } catch (err) { cfg.status = 'Could not connect: ' + err.message; saveCfg(); paintStatus(); toast(cfg.status); }
      break;
    }
    case 's-plan': cfg.planAt = 0; saveCfg(); closeModal(); sync(true); break;
    case 's-off': cfg = { names: cfg.names }; saveCfg(); closeModal(); paintStatus(); toast('This device is no longer syncing. Your data stays here.'); break;
  }
}, true);
// Desktop: Ctrl/Cmd + J opens quick capture
addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); if (state.modal) closeModal(); captureSheet(false); } });
// Home-screen shortcut: ?capture=1 opens capture with the mic; ?add=text runs a command directly
const q = new URLSearchParams(location.search);
if (q.get('add')) { runCommand(q.get('add'), { from: 'link' }); history.replaceState(null, '', location.pathname); }
else if (q.get('capture')) { setTimeout(() => captureSheet(false), 300); history.replaceState(null, '', location.pathname); }

_save(); markChanges();
render({ preserveScroll: true });
if (cfg.url) sync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__2b = { runCommand, splitDate, parseDay, eventKind, localSummary, sync, cfg: () => cfg };
})();
