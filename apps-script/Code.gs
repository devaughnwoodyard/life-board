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

function setup() {
  var ss = SpreadsheetApp.getActive();
  var d = ss.getSheetByName(DATA) || ss.insertSheet(DATA);
  if (d.getLastRow() === 0) d.appendRow(['coll', 'id', 'u', 's', 'json']);
  var i = ss.getSheetByName(INBOX) || ss.insertSheet(INBOX);
  if (i.getLastRow() === 0) i.appendRow(['id', 'received', 'text', 'source', 'taken']);
  var p = PropertiesService.getScriptProperties();
  var k = p.getProperty('TOKEN');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); p.setProperty('TOKEN', k); }
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
  return { ok: true, now: now, rows: back, inbox: inbox };
}
