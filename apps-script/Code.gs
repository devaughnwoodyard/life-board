/**
 * Life Board sync — paste into Extensions > Apps Script of a Google Sheet.
 * 1. Run setup() once (Run button). Approve access. Copy the key from the Execution log.
 * 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the /exec URL.
 * 3. In the app: Settings > Sync > paste URL + key > Connect.
 *
 * Storage: sheet "Data" holds one row per item (coll, id, u = edit time on the device,
 * s = time the server received it, json). Newest edit wins per item.
 * Sheet "Inbox" collects quick adds (Siri Shortcut, etc.); the app picks them up on its next sync.
 */
var DATA = 'Data', INBOX = 'Inbox';
// Your "Spanish for Life Tool" sheet (first tab). Columns: Frase en Espanol, Frase en Ingles, Nota,
// Fecha Agregada, Prueba 1..5 Pass. A pass date goes in the first empty Prueba column; 5 = retired.
var ES_SHEET_ID = '1Yrd1kUdiQ3Dv3QEuZVcWlzETm9X-WaFRORSllLkuXAk', ES_LOG = 'Quiz Log';

function setup() {
  var ss = SpreadsheetApp.getActive();
  var d = ss.getSheetByName(DATA) || ss.insertSheet(DATA);
  if (d.getLastRow() === 0) d.appendRow(['coll', 'id', 'u', 's', 'json']);
  var i = ss.getSheetByName(INBOX) || ss.insertSheet(INBOX);
  if (i.getLastRow() === 0) i.appendRow(['id', 'received', 'text', 'source', 'taken']);
  var p = PropertiesService.getScriptProperties();
  var k = p.getProperty('TOKEN');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); p.setProperty('TOKEN', k); }
  try { esBook_().getName(); } catch (x) { Logger.log('Could not open the Spanish sheet: ' + x); }
  Logger.log('Your Life Board key: ' + k);
  return k;
}

function doGet(e) { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  var b = {};
  try { b = JSON.parse(e.postData.contents); } catch (x) {}
  return handle_(b);
}

function handle_(b) {
  var key = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!key || b.token !== key) return out_({ ok: false, error: 'bad key' });
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (b.action === 'add') return out_(add_(b.text, b.source || 'shortcut'));
    if (b.action === 'sync') return out_(sync_(b));
    if (b.action === 'file') return out_(file_(b));
    if (b.action === 'es') return out_(es_(b));
    if (b.action === 'ping') return out_({ ok: true });
    return out_({ ok: false, error: 'unknown action' });
  } finally { lock.releaseLock(); }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) { setup(); sh = SpreadsheetApp.getActive().getSheetByName(name); }
  return sh;
}

// Quick add from Siri / Shortcuts: {action:'add', token, text}
function add_(text, source) {
  text = String(text || '').trim();
  if (!text) return { ok: false, error: 'empty' };
  sheet_(INBOX).appendRow([Utilities.getUuid(), new Date(), text, source, '']);
  return { ok: true, added: text };
}

// {action:'sync', token, since, rows:[{c,id,u,d?,del?}]} -> {ok, now, rows, inbox}
function sync_(b) {
  var sh = sheet_(DATA), now = Date.now();
  var vals = sh.getDataRange().getValues(), idx = {}, r;
  for (r = 1; r < vals.length; r++) idx[vals[r][0] + ':' + vals[r][1]] = r;
  var appends = [], stale = {};
  (b.rows || []).forEach(function (x) {
    if (!x || !x.c || !x.id) return;
    var key = x.c + ':' + x.id, at = idx[key];
    var row = [x.c, String(x.id), Number(x.u) || now, now, x.del ? '' : JSON.stringify(x.d)];
    if (at === undefined) { appends.push(row); idx[key] = -1; }
    else if (at > 0 && Number(vals[at][2]) < row[2]) { vals[at] = row; sh.getRange(at + 1, 1, 1, 5).setValues([row]); }
    else if (at > 0) stale[key] = true;  // the Sheet has a newer edit: send it back
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, 5).setValues(appends);

  var since = Number(b.since) || 0, back = [];
  vals = sh.getDataRange().getValues();
  for (r = 1; r < vals.length; r++) {
    if (Number(vals[r][3]) > since || stale[vals[r][0] + ':' + vals[r][1]]) {
      var j = vals[r][4];
      back.push(j ? { c: vals[r][0], id: String(vals[r][1]), u: Number(vals[r][2]), d: JSON.parse(j) }
                  : { c: vals[r][0], id: String(vals[r][1]), u: Number(vals[r][2]), del: 1 });
    }
  }

  var ib = sheet_(INBOX), iv = ib.getDataRange().getValues(), inbox = [];
  for (r = 1; r < iv.length; r++) {
    if (!iv[r][4]) { inbox.push({ id: iv[r][0], text: iv[r][2] }); ib.getRange(r + 1, 5).setValue(new Date()); }
  }
  var out = { ok: true, now: now, rows: back, inbox: inbox };
  if (Number(b.cal) > 0) { try { out.cal = cal_(Number(b.cal)); } catch (x) { out.calError = String(x); } }
  return out;
}

// ---------- Spanish ----------
function esBook_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('ES_SHEET_ID') || ES_SHEET_ID); }
function esNorm_(x) {
  return String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
// {action:'es', token, ops:[{t:'add',es,en,note,added} | {t:'pass',es,date} | {t:'log',ts,es,picked,ok,run}]}
// -> {ok, rows:[{es,en,note,added,passes:[]}]}
function es_(b) {
  var book = esBook_(), sh = book.getSheets()[0];
  var vals = sh.getDataRange().getDisplayValues(), idx = {}, r, j;
  for (r = 1; r < vals.length; r++) { var k0 = esNorm_(vals[r][0]); if (k0 && idx[k0] === undefined) idx[k0] = r; }
  var logs = [];
  (b.ops || []).forEach(function (o) {
    var k = esNorm_(o.es);
    if (!k) return;
    if (o.t === 'add' && idx[k] === undefined) {
      var row = [o.es, o.en || '', o.note || '', "'" + (o.added || '')];
      sh.appendRow(row);
      idx[k] = sh.getLastRow() - 1;
      vals[idx[k]] = row.concat(['', '', '', '', '']);
      vals[idx[k]][3] = o.added || '';
    } else if (o.t === 'pass' && idx[k] !== undefined) {
      var rr = idx[k], cells = vals[rr] || [], free = -1, have = false;
      for (j = 4; j <= 8; j++) { var v = String(cells[j] || '').trim(); if (v === o.date) have = true; if (!v && free < 0) free = j; }
      if (!have && free >= 0) { sh.getRange(rr + 1, free + 1).setValue("'" + o.date); cells[free] = o.date; vals[rr] = cells; }
    } else if (o.t === 'log') {
      logs.push([new Date(o.ts || Date.now()), o.es, o.picked || '', o.ok ? 'Yes' : 'No', o.run || 1]);
    }
  });
  if (logs.length) {
    var lg = book.getSheetByName(ES_LOG) || book.insertSheet(ES_LOG);
    if (lg.getLastRow() === 0) lg.appendRow(['When', 'Frase en Espanol', 'Answered', 'Correct', 'Quiz run']);
    lg.getRange(lg.getLastRow() + 1, 1, logs.length, 5).setValues(logs);
  }
  var out = [], dv = sh.getDataRange().getDisplayValues();
  for (r = 1; r < dv.length; r++) {
    if (!String(dv[r][0]).trim()) continue;
    var passes = [];
    for (j = 4; j <= 8; j++) if (String(dv[r][j] || '').trim()) passes.push(String(dv[r][j]).trim());
    out.push({ es: String(dv[r][0]).trim(), en: String(dv[r][1]).trim(), note: String(dv[r][2] || '').replace(/^N\/A$/i, '').trim(), added: String(dv[r][3] || '').trim(), passes: passes });
  }
  return { ok: true, rows: out };
}

// ---------- Google Calendar (read-only) ----------
// Events from your visible calendars for today + the next N days, so they can show as tiles on the board.
// Skips holiday/birthday calendars and events you declined. Recurring events get one tile per day.
function cal_(days) {
  var tz = Session.getScriptTimeZone();
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime() + (days + 1) * 864e5);
  var out = [];
  CalendarApp.getAllCalendars().forEach(function (c) {
    if (c.isHidden() || !c.isSelected()) return;
    var name = c.getName();
    if (/holiday|birthday|week numbers|feiertage/i.test(name)) return;
    c.getEvents(start, end).forEach(function (e) {
      try { if (e.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (x) {}
      var s = e.getStartTime(), en = e.getEndTime(), all = e.isAllDayEvent();
      var day = Utilities.formatDate(s, tz, 'yyyy-MM-dd');
      out.push({
        id: e.getId() + '|' + day,
        title: e.getTitle() || '(No title)',
        date: day,
        time: all ? null : Utilities.formatDate(s, tz, 'HH:mm'),
        dur: all ? null : Math.round((en - s) / 60000),
        cal: name,
        loc: e.getLocation() || ''
      });
    });
  });
  return out;
}

// ---------- Note attachments -> Google Drive ----------
// Files dropped into Notes are saved under My Drive / Life Board Notes / Work or Personal.
function folder_(name, parent) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function file_(b) {
  if (!b.b64 || !b.name) return { ok: false, error: 'no file' };
  var root = folder_('Life Board Notes', DriveApp.getRootFolder()), sub = folder_(b.work ? 'Work' : 'Personal', root);
  var blob = Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'application/octet-stream', String(b.name).slice(0, 200));
  var f = sub.createFile(blob);
  return { ok: true, id: f.getId(), url: f.getUrl(), folder: 'Life Board Notes/' + sub.getName() };
}
