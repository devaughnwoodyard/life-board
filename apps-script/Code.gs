/**
 * 2nd Brain sync — paste into Extensions > Apps Script of the "2nd Brain Data" sheet
 * (keep that sheet in your 2nd Brain Drive folder).
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
// Everything the app saves to Drive goes under this folder: "2nd Brain".
var HOME_FOLDER_ID = '1kAWONSWXTozPLNia1oGauzqxi290sOhN';
// Appointment titles: these show yellow in the app. Events with guests show red.
// Training plan sheet (Ironman 70.3 Little Elm 2027). Override with Script Property PLAN_SHEET_ID.
var PLAN_SHEET_ID = '1GyQuEuDgY4o8XndLL7ArBprIBGWNV1-wv7azbsAcSVQ';
var APPT_RE = /appointment|\bappt\b|dentist|doctor|\bdr\.?\s|clinic|therapy|haircut|barber|physio|\bvet\b|check-?up|massage|optometr|dermatolog|orthodont|chiro/i;

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
  try { home_().getName(); } catch (x) { Logger.log('Could not open the 2nd Brain folder: ' + x); }
  try { SpreadsheetApp.openById(p.getProperty('PLAN_SHEET_ID') || PLAN_SHEET_ID).getName(); } catch (x) { Logger.log('Could not open the training plan sheet: ' + x); }
  Logger.log('Your 2nd Brain key: ' + k);
  return k;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.state === 'strava' && (p.code || p.error)) return stravaCallback_(p);
  var res = p.payload ? (function () { try { var b = JSON.parse(p.payload); b.token = b.token || p.token; return handle_(b); } catch (x) { return handle_(p); } })() : handle_(p);
  // JSONP: lets the app read the reply even when a browser or network blocks cross-site fetch
  if (p.callback && /^[\w.$]+$/.test(p.callback)) {
    return ContentService.createTextOutput(p.callback + '(' + res.getContent() + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return res;
}
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
    if (b.action === 'plan') return out_(plan_());
    if (b.action === 'planMove') return out_(planMove_(b));
    if (b.action === 'pushSub') return out_(pushSub_(b));
    if (b.action === 'pushTest') return out_(pushTest_(b));
    if (b.action === 'strava') { var n = syncStrava(); return out_({ ok: true, added: n, strava: stravaState_() }); }
    if (b.action === 'getfile') return out_(getfile_(b));
    if (b.action === 'summarize') return out_(summarize_(b));
    if (b.action === 'icu') return out_(icu_(b));
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
  start = new Date(start.getTime() - 14 * 864e5);  // keep the last two weeks visible too
  var out = [];
  CalendarApp.getAllCalendars().forEach(function (c) {
    if (c.isHidden() || !c.isSelected()) return;
    var name = c.getName();
    if (/holiday|birthday|week numbers|feiertage/i.test(name)) return;
    c.getEvents(start, end).forEach(function (e) {
      try { if (e.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (x) {}
      var s = e.getStartTime(), en = e.getEndTime(), all = e.isAllDayEvent();
      var day = Utilities.formatDate(s, tz, 'yyyy-MM-dd');
      var people = [];
      try { people = e.getGuestList(false).map(function (g) { return g.getName() || g.getEmail(); }); } catch (x) {}
      var title = e.getTitle() || '(No title)';
      out.push({
        people: people,
        kind: APPT_RE.test(title) || /appointment/i.test(name) ? 'appt' : (people.length ? 'people' : ''),
        id: e.getId() + '|' + day,
        title: title,
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
// Files attached to notes are saved under 2nd Brain / Notes / Work or Personal / <note folder>.
function home_() { return DriveApp.getFolderById(HOME_FOLDER_ID); }
function folder_(name, parent) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function file_(b) {
  if (!b.b64 || !b.name) return { ok: false, error: 'no file' };
  var root = folder_('Notes', home_()), sub = folder_(b.work ? 'Work' : 'Personal', root);
  if (b.folder) sub = folder_(String(b.folder).slice(0, 80), sub);
  var blob = Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'application/octet-stream', String(b.name).slice(0, 200));
  var f = sub.createFile(blob);
  return { ok: true, id: f.getId(), url: f.getUrl(), folder: '2nd Brain/Notes/' + (b.work ? 'Work' : 'Personal') + (b.folder ? '/' + sub.getName() : '') };
}

// ---------- Training plan (read-only) ----------
// Columns from the Little Elm sheet: A date, E/G actual sport + minutes (Garmin/Strava sync),
// AA-AC AM sport/session/min, AD-AF PM sport/session/min, AG bail rule, AH planned run miles.
function plan_() {
  var id = PropertiesService.getScriptProperties().getProperty('PLAN_SHEET_ID') || PLAN_SHEET_ID;
  var sh = SpreadsheetApp.openById(id).getSheets()[0];
  var v = sh.getDataRange().getValues(), tz = Session.getScriptTimeZone(), out = [];
  for (var r = 2; r < v.length; r++) {
    var d = v[r][0]; if (!d) continue;
    var day = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.push({ date: day, am: [v[r][26], v[r][27], v[r][28]], pm: [v[r][29], v[r][30], v[r][31]], bail: v[r][32], mi: v[r][33],
               act: v[r][4] ? { sport: String(v[r][4]), min: v[r][6], hr: v[r][7] } : null });
  }
  // Every synced activity (Garmin → Strava → this sheet), so days with two sessions count both.
  var acts = {}, a = SpreadsheetApp.openById(id).getSheetByName('Activities');
  if (a && a.getLastRow() > 1) a.getRange(2, 1, a.getLastRow() - 1, 10).getValues().forEach(function (x) {
    var day = x[0] instanceof Date ? Utilities.formatDate(x[0], tz, 'yyyy-MM-dd') : String(x[0]).slice(0, 10);
    // start as 24h "HH:mm" in the script's time zone (the sheet stores "6:05 AM" text, or a time value)
    var st = '';
    if (x[2] instanceof Date) st = Utilities.formatDate(x[2], tz, 'HH:mm');
    else { var m = String(x[2] || '').match(/(\d{1,2}):(\d{2})\s*([AaPp])?/); if (m) { var h = Number(m[1]) % 12; if (/p/i.test(m[3] || '')) h += 12; if (!m[3]) h = Number(m[1]); st = (h < 10 ? '0' : '') + h + ':' + m[2]; } }
    (acts[day] = acts[day] || []).push({ sport: String(x[1]), start: st, min: Number(x[3]) || 0, mi: Number(x[4]) || 0, hr: x[5], name: String(x[8] || ''), sid: String(x[9] || '') });
  });
  out.forEach(function (o) { o.acts = acts[o.date] || (o.act ? [o.act] : []); });
  return { ok: true, rows: out, synced: PropertiesService.getScriptProperties().getProperty('STRAVA_LAST') || '', strava: stravaState_() };
}

// ---------- Moves made in the app (drag, swap AM/PM, edit) write back to the plan sheet ----------
// b.days = [{ date, am:[sport, session, min], pm:[...], bail, mi }]: rewrites AA:AH and Planned Hrs (D) for each day.
function planMove_(b) {
  var id = PropertiesService.getScriptProperties().getProperty('PLAN_SHEET_ID') || PLAN_SHEET_ID;
  var sh = SpreadsheetApp.openById(id).getSheets()[0], tz = Session.getScriptTimeZone();
  var col = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), at = {};
  col.forEach(function (x, i) { var d = x[0]; if (!d) return; var k = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).slice(0, 10); at[k] = i + 1; });
  var done = [], missing = [];
  (b.days || []).forEach(function (d) {
    var r = at[d.date]; if (!r) { missing.push(d.date); return; }
    var am = d.am || ['', '', ''], pm = d.pm || ['', '', ''];
    sh.getRange(r, 27, 1, 8).setValues([[am[0] || '', am[1] || '', am[2] || '', pm[0] || '', pm[1] || '', pm[2] || '', d.bail || '', d.mi || '']]);
    sh.getRange(r, 4).setValue(Math.round(((Number(am[2]) || 0) + (Number(pm[2]) || 0)) / 6) / 10);
    done.push(d.date);
  });
  return { ok: true, saved: done, missing: missing };
}

// ---------- Download a note file saved earlier ----------
function getfile_(b) {
  var f = DriveApp.getFileById(String(b.id || ''));
  var blob = f.getBlob();
  return { ok: true, name: f.getName(), mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------- Meeting-note summary (optional: needs an Anthropic API key) ----------
// Script Properties: ANTHROPIC_KEY (required for this), CLAUDE_MODEL (optional).
// Without a key the app falls back to its built-in summary.
function summarize_(b) {
  var p = PropertiesService.getScriptProperties(), key = p.getProperty('ANTHROPIC_KEY');
  if (!key) return { ok: false, error: 'no key' };
  var prompt = 'Summarize this meeting note. Reply with JSON only, no prose: ' +
    '{"date":"YYYY-MM-DD (meeting date; use ' + (b.date || 'the date in the note') + ' if unsure)",' +
    '"topics":["3-8 short main topics"],"todos":["action items, each starting with a verb; include the owner name if one is given"]}\n\n' +
    'Title: ' + (b.title || '') + '\n\n' + String(b.text || '').slice(0, 60000);
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: p.getProperty('CLAUDE_MODEL') || 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'Claude ' + res.getResponseCode() };
  var txt = JSON.parse(res.getContentText()).content[0].text;
  var m = txt.match(/\{[\s\S]*\}/);
  var s = JSON.parse(m ? m[0] : txt);
  return { ok: true, summary: { date: s.date || b.date || '', topics: s.topics || [], todos: s.todos || [] } };
}

// ---------- Send the training plan to Garmin (through Intervals.icu) ----------
// One-time: intervals.icu account → Settings → connect Garmin and turn on uploading planned workouts.
// Settings → Developer Settings: copy Athlete ID and API key into Script Properties ICU_ATHLETE and ICU_KEY.
// Then run sendPlanToGarmin (or tap "Send plan to Garmin" in the app). Re-running updates the same workouts.
function sendPlanToGarmin() { var r = icu_({}); Logger.log(JSON.stringify(r)); return r; }
function icu_(b) {
  var p = PropertiesService.getScriptProperties(), ath = p.getProperty('ICU_ATHLETE'), key = p.getProperty('ICU_KEY');
  if (!ath || !key) return { ok: false, error: 'Add ICU_ATHLETE and ICU_KEY in Script Properties first' };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var events = [];
  plan_().rows.forEach(function (d) {
    if (d.date < today) return;
    [['am', d.am], ['pm', d.pm]].forEach(function (s) {
      var sport = String(s[1][0] || ''), text = String(s[1][1] || ''), min = Number(s[1][2]) || 0;
      if (!text || /^rest$/i.test(sport)) return;
      var mi = /run/i.test(sport) && Number(d.mi) ? Number(d.mi) : 0;
      var w = icuWorkout_(sport, text, min, mi);
      events.push({
        category: 'WORKOUT', start_date_local: d.date + 'T00:00:00', type: w.type,
        name: text.split(/[:(]/)[0].trim().slice(0, 60), external_id: 'gp-' + d.date + '-' + s[0],
        moving_time: min * 60, description: text + (d.bail ? '\nBail: ' + d.bail : '') + (w.steps ? '\n\n' + w.steps : '')
      });
    });
  });
  var res = UrlFetchApp.fetch('https://intervals.icu/api/v1/athlete/' + encodeURIComponent(ath) + '/events/bulk?upsert=true', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode('API_KEY:' + key) }, payload: JSON.stringify(events)
  });
  var code = res.getResponseCode();
  if (code >= 300) return { ok: false, error: 'Intervals.icu ' + code + ': ' + res.getContentText().slice(0, 200) };
  return { ok: true, sent: events.length, from: today };
}
// Structured steps in Intervals.icu workout text (Garmin shows these step by step with targets).
function icuWorkout_(sport, t, min, mi) {
  var type = /run|race/i.test(sport) ? 'Run' : /bike|ride|spin/i.test(sport) ? 'Ride' : /swim/i.test(sport) ? 'Swim'
    : /yoga|mobility/i.test(sport) ? 'Yoga' : 'WeightTraining';
  var m, s = null, Z1 = ' Z1 HR', Z2 = ' Z2 HR';
  if (type === 'Run') {
    if ((m = t.match(/(\d+)×60s hill/))) s = '- 2mi' + Z2 + '\n\n' + m[1] + 'x\n- 60s Z5 HR\n- 90s' + Z1 + '\n\n- 1mi' + Z2;
    else if ((m = t.match(/(\d+) min steady tempo/))) s = '- 2mi' + Z2 + '\n- ' + m[1] + 'm Z3 HR\n- 1mi' + Z2;
    else if ((m = t.match(/(\d+) min tempo/))) s = '- 2mi' + Z2 + '\n- ' + m[1] + 'm Z3 HR\n- 1mi' + Z2;
    else if ((m = t.match(/(\d+)×(\d+) min threshold.*?w\/ (\d+)\s*(min|s)/))) s = '- 2mi' + Z2 + '\n\n' + m[1] + 'x\n- ' + m[2] + 'm Z4 HR\n- ' + m[3] + (m[4] === 's' ? 's' : 'm') + Z1 + '\n\n- 1mi' + Z2;
    else if ((m = t.match(/(\d+)×(\d+) mi @[^w]*w\/ (\d+) min/))) s = '- 2mi' + Z2 + '\n\n' + m[1] + 'x\n- ' + m[2] + 'mi Z4 HR\n- ' + m[3] + 'm' + Z1 + '\n\n- 1mi' + Z2;
    else if ((m = t.match(/(\d+)×(\d+) mi @/))) s = '- 2mi' + Z2 + '\n\n' + m[1] + 'x\n- ' + m[2] + 'mi Z4 HR\n- 2m' + Z1 + '\n\n- 1mi' + Z2;
    else if ((m = t.match(/(\d+) mi @ goal HM pace/))) s = '- 2mi' + Z2 + '\n- ' + m[1] + 'mi Z4 HR\n- 1mi' + Z2;
    else if ((m = t.match(/last (\d+) mi at steady/)) && mi) s = '- ' + (mi - Number(m[1])) + 'mi' + Z2 + '\n- ' + m[1] + 'mi Z3 HR';
    else if (/race|half marathon|IRONMAN/i.test(t)) s = null;
    else if (mi) s = '- ' + mi + 'mi' + Z2 + (/strides/.test(t) ? '\n\n4x\n- 20s Z5 HR\n- 60s' + Z1 : '');
    else if (min) s = '- ' + min + 'm' + Z2;
  } else if (type === 'Ride') {
    if ((m = t.match(/(\d+)×(\d+) min @ (\d+)-(\d+) W w\/ (\d+) min/))) s = '- 10m 92-125w\n\n' + m[1] + 'x\n- ' + m[2] + 'm ' + m[3] + '-' + m[4] + 'w\n- ' + m[5] + 'm 90-110w\n\n- 10m 92-125w';
    else if ((m = t.match(/(\d+)×(\d+) min sweet spot \((\d+)-(\d+) W\) w\/ (\d+) min/))) s = '- 10m 92-125w\n\n' + m[1] + 'x\n- ' + m[2] + 'm ' + m[3] + '-' + m[4] + 'w\n- ' + m[5] + 'm 90-110w\n\n- 10m 92-125w';
    else if ((m = t.match(/(\d+)×(\d+) min @ 70\.3 power/))) s = '- 10m 92-125w\n\n' + m[1] + 'x\n- ' + m[2] + 'm 115-125w\n- 3m 90-110w\n\n- 10m 92-125w';
    else if ((m = t.match(/last (\d+) min at 70\.3 effort/)) && min) s = '- ' + (min - Number(m[1])) + 'm 92-125w\n- ' + m[1] + 'm 115-125w';
    else if (min) s = '- ' + min + 'm 92-125w';
  } else if (min) s = '- ' + min + 'm';
  return { type: type, steps: s };
}

// ---------- Garmin → Strava → training plan sheet (automatic, hourly) ----------
// Garmin uploads every activity to Strava; this copies them into the plan sheet ("Activities" tab
// + columns E–J of the day's row) and the app reads them from there.
// One-time setup: run connectStrava() and follow the two lines it prints in the Execution log.
// Strava app keys: Script Properties STRAVA_ID / STRAVA_SECRET, or fill these two lines in your own copy.
var STRAVA_CLIENT_ID = '';
var STRAVA_CLIENT_SECRET = '';
function sid_() { var v = PropertiesService.getScriptProperties().getProperty('STRAVA_ID'); return String(STRAVA_CLIENT_ID || v || '').trim(); }
function ssec_() { var v = PropertiesService.getScriptProperties().getProperty('STRAVA_SECRET'); return String(STRAVA_CLIENT_SECRET || v || '').trim(); }
function connectStrava() {
  var p = PropertiesService.getScriptProperties(), id = sid_(), sec = ssec_();
  var url = (ScriptApp.getService().getUrl() || '').replace(/\/dev$/, '/exec');   // the editor can report the /dev URL; Strava must come back to /exec
  if (!id || !sec) {
    Logger.log('1) Open https://www.strava.com/settings/api and create an app: name "2nd Brain", website https://devaughnwoodyard.github.io, Authorization Callback Domain: script.google.com');
    Logger.log('2) Project Settings → Script Properties: add STRAVA_ID = Client ID and STRAVA_SECRET = Client Secret. Then run connectStrava again.');
    return;
  }
  if (!url) { Logger.log('Deploy the web app first (Deploy → New deployment), then run this again.'); return; }
  p.deleteProperty('STRAVA_ERR');
  Logger.log('Strava will send you back to: ' + url);
  Logger.log('Open this link, click Authorize, and you are done:\n' + 'https://www.strava.com/oauth/authorize?client_id=' + id +
    '&response_type=code&approval_prompt=force&scope=activity:read_all&state=strava&redirect_uri=' + encodeURIComponent(url));
}
function stravaCallback_(p) {
  var props = PropertiesService.getScriptProperties();
  if (p.error) { props.setProperty('STRAVA_ERR', 'Authorize was declined: ' + p.error); return HtmlService.createHtmlOutput('<h2>Strava not connected</h2><p>' + p.error + '</p>'); }
  try { return stravaCallbackInner_(p, props); }
  catch (x) { props.setProperty('STRAVA_ERR', 'Connect failed: ' + String(x).slice(0, 300)); return HtmlService.createHtmlOutput('<h2>Strava connect failed</h2><pre>' + String(x).slice(0, 500) + '</pre>'); }
}
function stravaCallbackInner_(p, props) {
  var r = UrlFetchApp.fetch('https://www.strava.com/oauth/token', { method: 'post', muteHttpExceptions: true, payload: {
    client_id: sid_(), client_secret: ssec_(), code: p.code, grant_type: 'authorization_code' } });
  var j = JSON.parse(r.getContentText());
  if (!j.refresh_token) { props.setProperty('STRAVA_ERR', 'Strava rejected the code: ' + r.getContentText().slice(0, 200)); return HtmlService.createHtmlOutput('<h2>Strava did not connect</h2><pre>' + r.getContentText().slice(0, 300) + '</pre>'); }
  props.deleteProperty('STRAVA_ERR');
  props.setProperty('STRAVA_REFRESH', j.refresh_token);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncStrava') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncStrava').timeBased().everyHours(1).create();
  var n = syncStrava();
  return HtmlService.createHtmlOutput('<h2 style="font-family:sans-serif">Strava connected ✓</h2><p style="font-family:sans-serif">Copied ' + n +
    ' activities into your training plan. It now syncs every hour; Garmin activities show up in 2nd Brain automatically. You can close this tab.</p>');
}
function stravaToken_() {
  var p = PropertiesService.getScriptProperties();
  var r = UrlFetchApp.fetch('https://www.strava.com/oauth/token', { method: 'post', muteHttpExceptions: true, payload: {
    client_id: sid_(), client_secret: ssec_(), refresh_token: p.getProperty('STRAVA_REFRESH'), grant_type: 'refresh_token' } });
  var j = JSON.parse(r.getContentText());
  if (!j.access_token) throw new Error('Strava token: ' + r.getContentText().slice(0, 200));
  if (j.refresh_token) p.setProperty('STRAVA_REFRESH', j.refresh_token);
  return j.access_token;
}
function syncStrava() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('STRAVA_REFRESH')) { if (!p.getProperty('STRAVA_ERR')) p.setProperty('STRAVA_ERR', 'Not authorized yet: run connectStrava, open the link, click Authorize'); return 0; }
  try { var n = syncStravaInner_(p); p.deleteProperty('STRAVA_ERR'); return n; }
  catch (x) { p.setProperty('STRAVA_ERR', 'Sync failed: ' + String(x).slice(0, 300)); throw x; }
}
// Run this in the editor to see where the Strava link stands.
function stravaStatus() { Logger.log(JSON.stringify(stravaState_(), null, 2)); }
function stravaState_() {
  var p = PropertiesService.getScriptProperties();
  return { keys: !!(sid_() && ssec_()), props: Object.keys(p.getProperties()).filter(function (k) { return /strava/i.test(k); }), authorized: !!p.getProperty('STRAVA_REFRESH'),
           last: p.getProperty('STRAVA_LAST') || '', error: p.getProperty('STRAVA_ERR') || '',
           hourly: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncStrava'; }) };
}
function syncStravaInner_(p) {
  var tok = stravaToken_(), tz = Session.getScriptTimeZone();
  var book = SpreadsheetApp.openById(p.getProperty('PLAN_SHEET_ID') || PLAN_SHEET_ID);
  var acts = book.getSheetByName('Activities');
  if (!acts) {
    acts = book.insertSheet('Activities');
    acts.appendRow(['Date', 'Sport', 'Start', 'Minutes', 'Miles', 'Avg HR', 'Max HR', 'Relative Effort', 'Name', 'Strava ID']);
    acts.setFrozenRows(1);
    // weekly actuals in the plan tab now count every activity, not just one per day
    var plan = book.getSheets()[0], keys = ['Run', 'Ride', 'Swim', 'Yoga', 'Weight'];
    for (var r = 3; r <= 21; r++) for (var k = 0; k < 5; k++)
      plan.getRange(r, 45 + k).setFormula('=SUMPRODUCT(ISNUMBER(SEARCH("' + keys[k] + '",Activities!$B$2:$B$2000))*(Activities!$A$2:$A$2000>=$AK' + r + ')*(Activities!$A$2:$A$2000<$AK' + r + '+7)*Activities!$D$2:$D$2000)/60');
  }
  var have = {}, last = acts.getLastRow();
  if (last > 1) acts.getRange(2, 10, last - 1, 1).getValues().forEach(function (x) { have[String(x[0])] = 1; });
  var after = Number(p.getProperty('STRAVA_AFTER')) || Math.floor(new Date('2026-11-01T00:00:00').getTime() / 1000);
  var rows = [], page = 1, newest = after;
  while (page < 6) {
    var res = UrlFetchApp.fetch('https://www.strava.com/api/v3/athlete/activities?per_page=100&page=' + page + '&after=' + (after - 86400),
      { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    var list = JSON.parse(res.getContentText());
    if (!Array.isArray(list)) throw new Error('Strava API: ' + res.getContentText().slice(0, 200));
    if (!list.length) break;
    list.forEach(function (a) {
      var t = Math.floor(new Date(a.start_date).getTime() / 1000); if (t > newest) newest = t;
      if (have[String(a.id)]) return;
      var d = new Date(a.start_date);
      rows.push([Utilities.formatDate(d, tz, 'yyyy-MM-dd'), a.sport_type || a.type, Utilities.formatDate(d, tz, 'h:mm a'),
        Math.round((a.moving_time || a.elapsed_time || 0) / 6) / 10, Math.round((a.distance || 0) / 160.934) / 10,
        a.average_heartrate ? Math.round(a.average_heartrate) : '', a.max_heartrate ? Math.round(a.max_heartrate) : '',
        a.suffer_score || '', a.name || '', String(a.id)]);
    });
    page++;
  }
  if (rows.length) {
    rows.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    acts.getRange(acts.getLastRow() + 1, 1, rows.length, 10).setValues(rows);
    // also fill Actual columns E–J on the plan row for each day (first activity; extra ones listed in Sport)
    var plan = book.getSheets()[0], pv = plan.getRange(3, 1, Math.max(plan.getLastRow() - 2, 1), 1).getValues(), at = {};
    pv.forEach(function (x, i) { var k = x[0] instanceof Date ? Utilities.formatDate(x[0], tz, 'yyyy-MM-dd') : String(x[0]).slice(0, 10); at[k] = i + 3; });
    var byDay = {};
    acts.getRange(2, 1, acts.getLastRow() - 1, 8).getValues().forEach(function (x) {
      var k = x[0] instanceof Date ? Utilities.formatDate(x[0], tz, 'yyyy-MM-dd') : String(x[0]).slice(0, 10); (byDay[k] = byDay[k] || []).push(x);
    });
    rows.forEach(function (r0) {
      var day = r0[0], rr = at[day], list = byDay[day]; if (!rr || !list) return;
      var mins = list.reduce(function (s, x) { return s + (Number(x[3]) || 0); }, 0);
      plan.getRange(rr, 5, 1, 6).setValues([[list.map(function (x) { return x[1]; }).join(' + '), list[0][2], Math.round(mins * 10) / 10, list[0][5], list[0][6], list[0][7]]]);
    });
  }
  p.setProperty('STRAVA_AFTER', String(newest));
  p.setProperty('STRAVA_LAST', new Date().toISOString());
  return rows.length;
}


// ---------- Notifications (Web Push through your Cloudflare Worker) ----------
// The app sends its subscription here (pushSub); daily triggers send the 3 AM workout and the 3 PM Spanish recap.
var PUSH_KEY = '';   // same as SEND_KEY in push-worker.js (or Script Property PUSH_KEY)
function pushKey_() { return String(PUSH_KEY || PropertiesService.getScriptProperties().getProperty('PUSH_KEY') || '').trim(); }
function pushSubs_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PUSH_SUBS') || '[]'); } catch (e) { return []; } }
function pushSub_(b) {
  var p = PropertiesService.getScriptProperties();
  if (!b.sub || !/^https:\/\//.test(b.sub.endpoint || '') || !b.sub.keys) return { ok: false, error: 'No subscription from the app' };
  if (b.worker) { if (!/^https:\/\/[^\s/]+\.workers\.dev\/?$/.test(b.worker)) return { ok: false, error: 'The Worker URL should look like https://name.yourname.workers.dev' }; p.setProperty('PUSH_URL', b.worker.replace(/\/$/, '')); }
  if (!p.getProperty('PUSH_URL')) return { ok: false, error: 'Paste your Worker URL' };
  if (!pushKey_()) return { ok: false, error: 'PUSH_KEY is missing in Code.gs' };
  var subs = pushSubs_().filter(function (x) { return x.endpoint !== b.sub.endpoint; });
  subs.unshift({ endpoint: b.sub.endpoint, keys: b.sub.keys, device: String(b.device || '').slice(0, 60), at: new Date().toISOString() });
  p.setProperty('PUSH_SUBS', JSON.stringify(subs.slice(0, 5)));
  pushTriggers_();
  var r = pushAll_({ title: 'Notifications are on ✓', body: 'Workout of the day at 3 AM, Spanish recap at 3 PM.', url: './', tag: 'test' });
  return { ok: r.sent > 0, sent: r.sent, error: r.sent ? '' : r.errors.join('; ') };
}
function pushTest_() { var r = pushAll_({ title: '2nd Brain test', body: 'If you see this, notifications work.', url: './', tag: 'test' }); return { ok: r.sent > 0, sent: r.sent, error: r.errors.join('; ') }; }
function pushTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (/^push(Workout|Spanish)$/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pushWorkout').timeBased().everyDays(1).atHour(3).nearMinute(0).create();
  ScriptApp.newTrigger('pushSpanish').timeBased().everyDays(1).atHour(15).nearMinute(0).create();
}
function pushAll_(payload) {
  var p = PropertiesService.getScriptProperties(), url = p.getProperty('PUSH_URL'), subs = pushSubs_(), keep = [], sent = 0, errors = [];
  if (!url || !subs.length) return { sent: 0, errors: ['Notifications are not set up'] };
  subs.forEach(function (sub) {
    var r = UrlFetchApp.fetch(url + '/send', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ key: pushKey_(), sub: sub, payload: payload }) });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) { j = { error: r.getContentText().slice(0, 200) }; }
    if (j.ok) { sent++; keep.push(sub); }
    else if (j.status === 404 || j.status === 410) { /* phone unsubscribed: drop it */ }
    else { keep.push(sub); errors.push(j.error || j.text || ('HTTP ' + r.getResponseCode())); }
  });
  p.setProperty('PUSH_SUBS', JSON.stringify(keep));
  return { sent: sent, errors: errors };
}
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
// 3 AM: today's training from the plan sheet
function pushWorkout() {
  var day = todayStr_(), row = (plan_().rows || []).filter(function (r) { return r.date === day; })[0];
  var line = function (slot, c) { return c && c[1] ? slot + ' · ' + String(c[1]).split(' | ').join(' + ') + (c[2] ? ' (' + String(c[2]).split('+').join(' + ') + ' min)' : '') : ''; };
  var lines = row ? [line('AM', row.am), line('PM', row.pm)].filter(String) : [];
  var body = lines.length ? lines.join('\n') + (row.bail ? '\nBail: ' + row.bail : '') : 'No sessions planned today. Rest or mobility.';
  return pushAll_({ title: lines.length ? "Today's training" : 'Rest day', body: body.slice(0, 600), url: './?page=workouts', tag: 'workout-' + day });
}
// 3 PM: Spanish recap from your phrases (Spanish notes with es/en)
function pushSpanish() {
  var v = sheet_(DATA).getDataRange().getValues(), day = todayStr_(), ph = [];
  for (var r = 1; r < v.length; r++) {
    if (v[r][0] !== 'notes' || !v[r][4]) continue;
    var d; try { d = JSON.parse(v[r][4]); } catch (e) { continue; }
    if (d.tab !== 'Spanish' || !(d.es || d.source === 'phrase')) continue;
    ph.push({ es: d.es || d.title, en: d.en || '', passes: (d.passes || []).length, today: (d.reviews || []).some(function (x) { return x.day === day; }), entered: d.entered || '' });
  }
  if (!ph.length) return pushAll_({ title: 'Spanish recap', body: 'No phrases yet. Add one: “Spanish le llegas means do you get it”.', url: './?quiz=1', tag: 'spanish-' + day });
  var learning = ph.filter(function (x) { return x.passes < 5; }), done = ph.filter(function (x) { return x.today; }).length;
  var due = learning.filter(function (x) { return !x.today; }).sort(function (a, b) { return a.passes - b.passes || String(a.entered).localeCompare(String(b.entered)); }).slice(0, 3);
  var body = (done ? 'Reviewed ' + done + ' today. ' : 'No review yet today. ') + learning.length + ' learning · ' + (ph.length - learning.length) + ' mastered.';
  if (due.length) body += '\n' + due.map(function (x) { return x.es + (x.en ? ' = ' + x.en : ''); }).join('\n') + '\nTap to quiz yourself.';
  return pushAll_({ title: 'Spanish recap', body: body.slice(0, 600), url: './?quiz=1', tag: 'spanish-' + day });
}
