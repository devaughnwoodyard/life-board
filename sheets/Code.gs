/**
 * Life Board in Google Sheets.
 *
 * 1. In the Life Board sheet: Extensions > Apps Script. Paste this whole file, Save.
 * 2. Pick "setup" in the function list and click Run. Approve access.
 *    It builds every tab, formula, checkbox and dropdown, and turns on:
 *      - Google Calendar sync every hour (Calendar tab + Today)
 *      - nightly Close the day at 11:50pm (Days tab + streak)
 *      - the checkbox automations (Done date, repeating tasks, Notes -> Task, Spanish quiz grading)
 * 3. Optional, for Siri: Deploy > New deployment > Web app (Execute as Me, Anyone). Use the URL
 *    and the Siri key on the Settings tab in an iPhone Shortcut (see Settings tab).
 *
 * Running setup again is safe: it only adds what is missing and resets formatting.
 */

var TABS = ['Today', 'Tasks', 'Week', 'Calendar', 'Habits', 'Workouts', 'Notes', 'Days', 'Spanish Quiz', 'Settings'];
var CATS = ['Errands', 'Home', 'Car', 'Health', 'Travel', 'Workout', 'Work', 'Money', 'Other'];
var INK = '#1c1c28', MUTED = '#6b6b80', HEAD = '#1c1c28', INPUT = '#fff7d6', TODAYBG = '#eef3ff';
var ES_GOAL = 5, ES_QUIZ = 10;

// ---------------------------------------------------------------- menu
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Life Board')
    .addItem('Sync Google Calendar now', 'calendarSync')
    .addItem('New Spanish quiz', 'newSpanishQuiz')
    .addItem('Close the day', 'closeDayPrompt')
    .addSeparator()
    .addItem('Set up / repair', 'setup')
    .addToUi();
}

// ---------------------------------------------------------------- setup
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  TABS.forEach(function (n) { var sh = ss.getSheetByName(n) || ss.insertSheet(n); sh.setHiddenGridlines(true); });
  var stray = ss.getSheetByName('Sheet1'); if (stray && ss.getSheets().length > TABS.length) ss.deleteSheet(stray);
  TABS.forEach(function (n, i) { ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1); });

  buildSettings_(); buildTasks_(); buildCalendar_(); buildWorkouts_(); buildNotes_(); buildDays_();
  buildHabits_(); buildWeek_(); buildSpanishQuiz_(); buildToday_();
  TABS.forEach(function (n) { ss.getSheetByName(n).getDataRange().setFontFamily('Arial'); });

  // Siri key
  var props = PropertiesService.getScriptProperties(), key = props.getProperty('TOKEN');
  if (!key) { key = Utilities.getUuid().replace(/-/g, ''); props.setProperty('TOKEN', key); }
  ss.getSheetByName('Settings').getRange('B7').setValue(key);

  // triggers (replace ours, keep anything else)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['calendarSync', 'closeDayAuto', 'onEditInstalled'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('calendarSync').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('closeDayAuto').timeBased().everyDays(1).atHour(23).nearMinute(50).create();
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();

  try { calendarSync(); } catch (x) { Logger.log('Calendar: ' + x); }
  ss.setActiveSheet(ss.getSheetByName('Today'));
  ss.toast('Life Board is ready. Siri key is on the Settings tab.', 'Set up', 8);
}

// ---------------------------------------------------------------- helpers
function sh_(n) { return SpreadsheetApp.getActive().getSheetByName(n); }
function header_(sh, row, col, labels) {
  var r = sh.getRange(row, col, 1, labels.length);
  r.setValues([labels]).setBackground(HEAD).setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(row, 24);
}
function title_(sh, a1, text, size) { sh.getRange(a1).setValue(text).setFontSize(size || 18).setFontWeight('bold').setFontColor(INK); }
function label_(sh, a1, text, bold) { sh.getRange(a1).setValue(text).setFontColor(bold ? INK : MUTED).setFontWeight(bold ? 'bold' : 'normal'); }
function input_(sh, a1, v) { var r = sh.getRange(a1); if (r.getValue() === '' && v !== undefined) r.setValue(v); r.setBackground(INPUT).setFontWeight('bold').setFontColor(INK); }
function widths_(sh, w) { for (var c in w) sh.setColumnWidth(c.charCodeAt(0) - 64, w[c]); }
function list_(sh, a1, items) { sh.getRange(a1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(items, true).setAllowInvalid(false).build()); }
function cf_(sh, a1, formula, bg, fg, strike) {
  var b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([sh.getRange(a1)]);
  if (bg) b.setBackground(bg); if (fg) b.setFontColor(fg); if (strike) b.setStrikethrough(true);
  return b.build();
}
function isEmpty_(sh) { return sh.getLastRow() === 0; }
function md_(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
function addRow_(sh, keyCol, values) {
  var n = Math.max(sh.getLastRow() - 1, 1), v = sh.getRange(2, keyCol, n, 1).getValues(), last = 1;
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) !== '') { last = i + 2; break; }
  sh.getRange(last + 1, 1, 1, values.length).setValues([values]);
  return last + 1;
}
function today_() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }

// ---------------------------------------------------------------- tabs
function buildSettings_() {
  var s = sh_('Settings'); title_(s, 'A1', 'Settings', 14);
  var rows = [
    ['Day capacity (minutes)', 480, 'Used for Day load on Today. Source: user-provided assumption.', true],
    ['Calendar: days ahead to sync', 14, 'Today plus this many days', true],
    ['Spanish for Life Tool sheet ID', '1Yrd1kUdiQ3Dv3QEuZVcWlzETm9X-WaFRORSllLkuXAk', 'From the sheet URL', true],
    ['Workout plan sheet URL', '', 'Paste when ready; plan import comes next', true],
    ['Strava / Garmin log sheet URL', '', 'Paste when ready; actuals import comes next', true],
    ['Siri key', '', 'Filled in by setup. Keep private.', false],
    ['Current streak (days cleared)', 0, 'Updated nightly by the script', false],
    ['Last calendar sync', '', 'Updated by the script', false]
  ];
  rows.forEach(function (r, i) {
    var row = i + 2;
    label_(s, 'A' + row, r[0], true);
    if (r[3]) input_(s, 'B' + row, r[1]); else { if (s.getRange('B' + row).getValue() === '') s.getRange('B' + row).setValue(r[1]); s.getRange('B' + row).setFontWeight('bold'); }
    label_(s, 'C' + row, r[2]);
  });
  s.getRange('B9').setNumberFormat('mmm d h:mm am/pm');
  label_(s, 'A12', 'Siri Shortcut', true);
  label_(s, 'A13', 'Shortcuts app > New: Dictate Text > Get Contents of URL (your web app /exec URL, POST, JSON body: action = add, token = Siri key, text = Dictated Text) > Show Notification.');
  label_(s, 'A14', 'Start with "Task", "Note", "Work note" or "Spanish ... means ...". Example: "Task call mom tomorrow at 6pm for 15 minutes".');
  widths_(s, { A: 260, B: 330, C: 330 });
}

function buildTasks_() {
  var k = sh_('Tasks');
  var cols = ['Done', 'Task', 'Due', 'Time', 'Minutes', 'Effort (1-10)', 'Realm', 'Category', 'Tags', 'People', 'Repeat', 'Note', 'Source', 'Added', 'Done on', 'Days rolled'];
  header_(k, 1, 1, cols);
  if (k.getLastRow() < 2) {
    var t = today_(), due = new Date(t.getTime() + 2 * 864e5);
    k.getRange(2, 1, 1, 15).setValues([[false, 'Example: renew passport (delete this row)', due, '', 45, 4, 'Personal', 'Errands', 'admin', '', 'None', 'Photo + form DS-82', 'Manual', t, '']]);
  }
  k.getRange('P2').setFormula('=ARRAYFORMULA(IF((B2:B<>"")*(A2:A<>TRUE)*(C2:C<>"")*(C2:C<TODAY()),TODAY()-C2:C,))');
  k.getRange('A2:A1000').insertCheckboxes();
  k.getRange('C2:C1000').setNumberFormat('ddd mmm d'); k.getRange('D2:D1000').setNumberFormat('h:mm am/pm');
  k.getRange('N2:O1000').setNumberFormat('mmm d');
  list_(k, 'G2:G1000', ['Personal', 'Work']); list_(k, 'H2:H1000', CATS);
  list_(k, 'K2:K1000', ['None', 'Daily', 'Weekdays', 'Weekly', 'Monthly', 'Paused']);
  list_(k, 'M2:M1000', ['Manual', 'Siri', 'Note', 'Calendar']);
  list_(k, 'F2:F1000', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  k.setFrozenRows(1); k.setFrozenColumns(2);
  k.setConditionalFormatRules([
    cf_(k, 'A2:P1000', '=$A2=TRUE', null, '#a0a0b0', true),
    cf_(k, 'A2:P1000', '=AND($A2<>TRUE,$P2>=3,$H2<>"Workout")', '#fde2e1'),
    cf_(k, 'A2:P1000', '=AND($A2<>TRUE,$C2=TODAY())', TODAYBG)
  ]);
  widths_(k, { A: 50, B: 300, C: 95, D: 75, E: 70, F: 85, G: 80, H: 85, I: 110, J: 110, K: 80, L: 240, M: 80, N: 80, O: 80, P: 85 });
}

function buildCalendar_() {
  var c = sh_('Calendar');
  header_(c, 1, 1, ['Date', 'Start', 'End', 'Minutes', 'Event', 'Calendar', 'Location', 'Event ID']);
  c.getRange('A2:A').setNumberFormat('ddd mmm d'); c.getRange('B2:C').setNumberFormat('h:mm am/pm');
  c.setFrozenRows(1);
  label_(c, 'J1', 'Filled every hour from your Google Calendar. Edits here are overwritten.');
  widths_(c, { A: 95, B: 75, C: 75, D: 70, E: 300, F: 170, G: 180, H: 200 });
}

function buildWorkouts_() {
  var o = sh_('Workouts');
  header_(o, 1, 1, ['Date', 'Sport', 'Planned', 'Planned min', 'Planned distance', 'Actual (Strava/Garmin)', 'Actual min', 'Actual distance', 'Auto score', 'Your score', 'Score']);
  if (o.getLastRow() < 2) o.getRange(2, 1, 1, 8).setValues([[today_(), 'Run', 'Example: Long run Z2 (delete this row)', 90, '10 mi', '', '', '']]);
  o.getRange('I2').setFormula('=ARRAYFORMULA(IF(D2:D="",,IF(G2:G="",0,IF(G2:G/D2:D>1.5,1.5,G2:G/D2:D))))');
  o.getRange('K2').setFormula('=ARRAYFORMULA(IF(D2:D="",,IF(J2:J<>"",J2:J,I2:I)))');
  o.getRange('A2:A').setNumberFormat('ddd mmm d'); o.getRange('I2:K').setNumberFormat('0%');
  o.getRange('J2:J400').setBackground(INPUT);
  list_(o, 'B2:B400', ['Run', 'Bike', 'Swim', 'Brick', 'Strength', 'Mobility', 'Rest']);
  label_(o, 'M1', 'Last 60 days', true);
  var summ = [
    ['Average score', '=IFERROR(AVERAGEIFS(K2:K,A2:A,">"&TODAY()-60,A2:A,"<="&TODAY(),D2:D,"<>"),"")', '0%'],
    ['Planned sessions', '=COUNTIFS(A2:A,">"&TODAY()-60,A2:A,"<="&TODAY(),D2:D,"<>")', '0'],
    ['Completed', '=COUNTIFS(A2:A,">"&TODAY()-60,A2:A,"<="&TODAY(),D2:D,"<>",G2:G,"<>")', '0'],
    ['Missed', '=N3-N4', '0'],
    ['Average score, last 7 days', '=IFERROR(AVERAGEIFS(K2:K,A2:A,">"&TODAY()-7,A2:A,"<="&TODAY(),D2:D,"<>"),"")', '0%']
  ];
  summ.forEach(function (r, i) { label_(o, 'M' + (2 + i), r[0]); o.getRange('N' + (2 + i)).setFormula(r[1]).setNumberFormat(r[2]).setFontWeight('bold'); });
  label_(o, 'M8', 'Your score overrides the auto score: 100% = did the plan, up to 150%.');
  o.setFrozenRows(1);
  widths_(o, { A: 95, B: 80, C: 260, D: 85, E: 110, F: 220, G: 80, H: 110, I: 80, J: 80, K: 70, L: 20, M: 200, N: 80 });
}

function buildNotes_() {
  var n = sh_('Notes');
  header_(n, 1, 1, ['Added', 'Realm', 'Note', 'Make it a task', 'Task made']);
  if (n.getLastRow() < 2) n.getRange(2, 1, 1, 4).setValues([[new Date(), 'Work', 'Example: confirm sprint scope and QA owner (delete this row)', false]]);
  n.getRange('D2:D1000').insertCheckboxes();
  n.getRange('A2:A').setNumberFormat('mmm d h:mm am/pm'); n.getRange('E2:E').setNumberFormat('mmm d');
  n.getRange('C2:C1000').setWrap(true).setVerticalAlignment('top');
  list_(n, 'B2:B1000', ['Personal', 'Work']);
  n.setFrozenRows(1);
  widths_(n, { A: 120, B: 80, C: 520, D: 100, E: 90 });
}

function buildDays_() {
  var d = sh_('Days');
  header_(d, 1, 1, ['Date', 'Due', 'Done', 'Score', 'Cleared', 'Note']);
  d.getRange('A2:A').setNumberFormat('ddd mmm d'); d.getRange('D2:D').setNumberFormat('0%');
  label_(d, 'H1', 'One row per day, written at 11:50pm or by Life Board > Close the day.');
  d.setFrozenRows(1);
  widths_(d, { A: 95, B: 55, C: 55, D: 60, E: 70, F: 420 });
}

function buildHabits_() {
  var h = sh_('Habits'), H = 'BCDEFGH';
  title_(h, 'A1', 'Habits');
  label_(h, 'A3', 'Habit (type names here)', true);
  var start = ['Stretch', 'Spanish 10 min', 'Read', 'Floss'];
  for (var i = 0; i < 7; i++) input_(h, H[i] + '3', start[i]);
  [['Last 7 days', 7, 4], ['Last 30 days', 30, 5]].forEach(function (r) {
    label_(h, 'A' + r[2], r[0]);
    for (var j = 0; j < 7; j++) {
      var c = H[j];
      h.getRange(c + r[2]).setFormula('=IF(' + c + '$3="","",COUNTIFS($A$11:$A,">"&TODAY()-' + r[1] + ',$A$11:$A,"<="&TODAY(),' + c + '$11:' + c + ',TRUE)/' + r[1] + ')').setNumberFormat('0%');
    }
  });
  label_(h, 'A6', 'Strongest, last 30 days'); h.getRange('B6').setFormula('=IFERROR(INDEX($B$3:$H$3,MATCH(MAX($B$5:$H$5),$B$5:$H$5,0)),"")').setFontWeight('bold');
  label_(h, 'A7', 'Weakest, last 30 days'); h.getRange('B7').setFormula('=IFERROR(INDEX($B$3:$H$3,MATCH(MINIFS($B$5:$H$5,$B$3:$H$3,"<>"),$B$5:$H$5,0)),"")').setFontWeight('bold');
  label_(h, 'A8', 'Median habit, last 30 days'); h.getRange('B8').setFormula('=IFERROR(MEDIAN(FILTER($B$5:$H$5,$B$3:$H$3<>"")),"")').setNumberFormat('0%').setFontWeight('bold');
  label_(h, 'D6', 'This week vs last week'); h.getRange('E6').setFormula('=IFERROR(AVERAGE(FILTER($I$11:$I,$A$11:$A>TODAY()-7,$A$11:$A<=TODAY()))-AVERAGE(FILTER($I$11:$I,$A$11:$A>TODAY()-14,$A$11:$A<=TODAY()-7)),"")').setNumberFormat('+0%;-0%;0%').setFontWeight('bold');
  header_(h, 10, 1, ['Date', '', '', '', '', '', '', '', 'Day %']);
  for (var k = 0; k < 7; k++) h.getRange(H[k] + '10').setFormula('=' + H[k] + '3');
  var n = Math.round((new Date(2027, 11, 31) - new Date(2026, 9, 1)) / 864e5) + 1;
  h.getRange('A11').setFormula('=SEQUENCE(' + n + ',1,DATE(2026,10,1))');
  h.getRange('A11:A').setNumberFormat('ddd mmm d');
  h.getRange('I11').setFormula('=ARRAYFORMULA(IF(A11:A="",,IF(COUNTA($B$3:$H$3)=0,,((B11:B=TRUE)+(C11:C=TRUE)+(D11:D=TRUE)+(E11:E=TRUE)+(F11:F=TRUE)+(G11:G=TRUE)+(H11:H=TRUE))/COUNTA($B$3:$H$3))))');
  h.getRange('I11:I').setNumberFormat('0%');
  h.getRange(11, 2, n, 7).insertCheckboxes();
  h.setConditionalFormatRules([cf_(h, 'A11:I' + (10 + n), '=$A11=TODAY()', TODAYBG)]);
  h.setFrozenRows(10); h.setFrozenColumns(1);
  // chart helpers + charts
  label_(h, 'K10', 'Last 30 days', true); label_(h, 'L10', 'Day %', true);
  h.getRange('K11').setFormula('=FILTER(A11:A,A11:A>TODAY()-30,A11:A<=TODAY())');
  h.getRange('L11').setFormula('=FILTER(I11:I,A11:A>TODAY()-30,A11:A<=TODAY())');
  h.getRange('K11:K41').setNumberFormat('m/d'); h.getRange('L11:L41').setNumberFormat('0%');
  label_(h, 'N10', 'Habit', true); label_(h, 'O10', 'Last 30 days', true);
  h.getRange('N11').setFormula('=TRANSPOSE(FILTER(B3:H3,B3:H3<>""))');
  h.getRange('O11').setFormula('=TRANSPOSE(FILTER(B5:H5,B3:H3<>""))'); h.getRange('O11:O17').setNumberFormat('0%');
  h.getCharts().forEach(function (c) { h.removeChart(c); });
  h.insertChart(h.newChart().setChartType(Charts.ChartType.COLUMN).addRange(h.getRange('K10:L41'))
    .setOption('title', 'Daily completion, last 30 days').setOption('legend', { position: 'none' })
    .setOption('vAxis', { format: 'percent', viewWindow: { min: 0, max: 1 } }).setOption('colors', ['#3d6ef5'])
    .setPosition(1, 17, 0, 0).build());
  h.insertChart(h.newChart().setChartType(Charts.ChartType.BAR).addRange(h.getRange('N10:O17'))
    .setOption('title', 'Each habit, last 30 days').setOption('legend', { position: 'none' })
    .setOption('hAxis', { format: 'percent', viewWindow: { min: 0, max: 1 } }).setOption('colors', ['#1c1c28'])
    .setPosition(22, 17, 0, 0).build());
  widths_(h, { A: 190, B: 105, C: 105, D: 105, E: 105, F: 105, G: 105, H: 105, I: 70, J: 20, K: 80, L: 60, M: 20, N: 130, O: 90 });
}

function buildWeek_() {
  var w = sh_('Week'), L = 'BCDEFGH';
  title_(w, 'A1', 'This week and next');
  label_(w, 'A2', 'Week starting'); w.getRange('B2').setFormula('=TODAY()-WEEKDAY(TODAY(),3)').setNumberFormat('mmm d').setFontWeight('bold');
  var rules = [];
  [[4, 0, 'This week'], [24, 7, 'Next week']].forEach(function (b) {
    var r0 = b[0];
    label_(w, 'A' + r0, b[2], true); label_(w, 'A' + (r0 + 1), 'Tasks'); label_(w, 'A' + (r0 + 11), 'Calendar');
    for (var i = 0; i < 7; i++) {
      var c = L[i];
      w.getRange(c + r0).setFormula('=$B$2+' + (i + b[1])).setNumberFormat('ddd mmm d').setFontWeight('bold').setFontColor('#ffffff').setBackground(HEAD);
      w.getRange(c + (r0 + 1)).setFormula('=IFERROR(ARRAY_CONSTRAIN(FILTER(Tasks!$B$2:$B,Tasks!$B$2:$B<>"",Tasks!$A$2:$A<>TRUE,Tasks!$C$2:$C=' + c + '$' + r0 + '),9,1),"")');
      w.getRange(c + (r0 + 11)).setFormula('=IFERROR(ARRAY_CONSTRAIN(FILTER(TEXT(Calendar!$B$2:$B,"h:mm am/pm")&"  "&Calendar!$E$2:$E,Calendar!$A$2:$A=' + c + '$' + r0 + '),8,1),"")');
    }
    rules.push(cf_(w, 'B' + r0 + ':H' + r0, '=B$' + r0 + '=TODAY()', '#3d6ef5'));
  });
  w.setConditionalFormatRules(rules);
  w.getRange('B4:H43').setWrap(true).setVerticalAlignment('top');
  widths_(w, { A: 80, B: 160, C: 160, D: 160, E: 160, F: 160, G: 160, H: 160 });
}

function buildSpanishQuiz_() {
  var q = sh_('Spanish Quiz');
  title_(q, 'A1', 'Spanish quiz');
  label_(q, 'A2', 'Life Board > New Spanish quiz picks 10 phrases from your Spanish for Life Tool sheet. Choose the meaning in column B. Misses come back at the bottom until you get them. 5 correct days retires a phrase.');
  header_(q, 4, 1, ['Español', 'Your answer', 'Result', 'Correct days (of 5)']);
  widths_(q, { A: 260, B: 260, C: 260, D: 140 });
}

function buildToday_() {
  var t = sh_('Today');
  title_(t, 'A1', 'Life Board');
  t.getRange('A2').setFormula('=TODAY()').setNumberFormat('dddd, mmmm d').setFontSize(12).setFontColor(MUTED);
  var stats = [
    ['Open and due (today or earlier)', '=COUNTIFS(Tasks!B2:B,"<>",Tasks!A2:A,"<>TRUE",Tasks!C2:C,"<="&TODAY())', '0'],
    ['Done today', '=COUNTIF(Tasks!O2:O,TODAY())', '0'],
    ['Day score', '=IF(B4+B5=0,0,B5/(B4+B5))', '0%'],
    ['Status', '=IF(B4+B5=0,"Nothing due yet",IF(B6>=1,"Day cleared",B4&" left"))', '@'],
    ['Current streak (days cleared)', '=Settings!B8', '0'],
    ['Calendar time today (min)', '=SUMIF(Calendar!A2:A,TODAY(),Calendar!D2:D)', '0'],
    ['Task time due today (min)', '=SUMIFS(Tasks!E2:E,Tasks!A2:A,"<>TRUE",Tasks!C2:C,"<="&TODAY())', '0'],
    ['Workout time today (min)', '=SUMIFS(Workouts!D2:D,Workouts!A2:A,TODAY())', '0'],
    ['Day load (vs capacity in Settings)', '=IF(Settings!B2=0,0,(B9+B10+B11)/Settings!B2)', '0%']
  ];
  stats.forEach(function (s, i) { var r = 4 + i; label_(t, 'A' + r, s[0]); t.getRange('B' + r).setFormula(s[1]).setNumberFormat(s[2]).setFontWeight('bold').setFontSize(12).setFontColor(INK); });
  title_(t, 'D3', 'Knock it out', 12);
  label_(t, 'D4', 'Minutes I have'); input_(t, 'E4', 30);
  label_(t, 'D5', 'Effort under (1-10)'); input_(t, 'E5', 6);
  header_(t, 7, 4, ['Task', 'Due', 'Time', 'Min', 'Effort']);
  t.getRange('D8').setFormula('=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(Tasks!B2:F,Tasks!B2:B<>"",Tasks!A2:A<>TRUE,Tasks!E2:E<>"",Tasks!E2:E<=E4,(Tasks!F2:F<E5)+(Tasks!F2:F="")),4,TRUE),5,5),"Nothing fits. Try more time or a higher effort limit.")');
  label_(t, 'A13', 'Yellow cells are inputs. Everything else updates on its own.');
  title_(t, 'A15', 'To do: today, overdue and undated', 12);
  header_(t, 16, 1, ['Task', 'Due', 'Time', 'Min', 'Effort']);
  t.getRange('A17').setFormula('=IFERROR(SORT(FILTER(Tasks!B2:F,Tasks!B2:B<>"",Tasks!A2:A<>TRUE,(Tasks!C2:C<=TODAY())+(Tasks!C2:C="")),2,TRUE,3,TRUE),"All clear")');
  title_(t, 'G15', 'Calendar today', 12);
  header_(t, 16, 7, ['Start', 'End', 'Min', 'Event', 'Calendar']);
  t.getRange('G17').setFormula('=IFERROR(SORT(FILTER(Calendar!B2:F,Calendar!A2:A=TODAY()),1,TRUE),"No events today")');
  title_(t, 'M15', 'Coming up: next 7 days', 12);
  header_(t, 16, 13, ['Task', 'Due', 'Time', 'Min', 'Effort']);
  t.getRange('M17').setFormula('=IFERROR(SORT(FILTER(Tasks!B2:F,Tasks!B2:B<>"",Tasks!A2:A<>TRUE,Tasks!C2:C>TODAY(),Tasks!C2:C<=TODAY()+7,Tasks!H2:H<>"Workout"),2,TRUE,3,TRUE),"Nothing scheduled")');
  t.getRange('E8:E12').setNumberFormat('ddd mmm d'); t.getRange('F8:F12').setNumberFormat('h:mm am/pm');
  t.getRange('B17:B200').setNumberFormat('ddd mmm d'); t.getRange('C17:C200').setNumberFormat('h:mm am/pm');
  t.getRange('G17:H200').setNumberFormat('h:mm am/pm');
  t.getRange('N17:N200').setNumberFormat('ddd mmm d'); t.getRange('O17:O200').setNumberFormat('h:mm am/pm');
  t.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(1).setBackground('#d7f2df').setFontColor('#1e7b45').setRanges([t.getRange('B6')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Day cleared').setBackground('#d7f2df').setFontColor('#1e7b45').setRanges([t.getRange('B7')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(1).setBackground('#fde2e1').setFontColor('#b42318').setRanges([t.getRange('B12')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0.8, 1).setBackground('#fff1d6').setFontColor('#9a6700').setRanges([t.getRange('B12')]).build()
  ]);
  t.setFrozenRows(2);
  widths_(t, { A: 250, B: 100, C: 80, D: 230, E: 90, F: 75, G: 80, H: 80, I: 55, J: 230, K: 130, L: 20, M: 230, N: 95, O: 80, P: 55, Q: 60 });
}

// ---------------------------------------------------------------- Google Calendar -> Calendar tab
function calendarSync() {
  var ss = SpreadsheetApp.getActive(), c = ss.getSheetByName('Calendar'), set = ss.getSheetByName('Settings');
  var days = Number(set.getRange('B3').getValue()) || 14, tz = ss.getSpreadsheetTimeZone();
  var start = today_(), end = new Date(start.getTime() + (days + 1) * 864e5), rows = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    if (cal.isHidden() || !cal.isSelected()) return;
    var name = cal.getName();
    if (/holiday|birthday|week numbers/i.test(name)) return;
    cal.getEvents(start, end).forEach(function (e) {
      try { if (e.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (x) {}
      var s = e.getStartTime(), en = e.getEndTime(), all = e.isAllDayEvent();
      var day = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      rows.push([day, all ? '' : s, all ? '' : en, all ? '' : Math.round((en - s) / 60000), e.getTitle() || '(No title)', name, e.getLocation() || '', e.getId()]);
    });
  });
  rows.sort(function (a, b) { return a[0] - b[0] || (a[1] || 0) - (b[1] || 0); });
  var last = c.getLastRow();
  if (last > 1) c.getRange(2, 1, last - 1, 8).clearContent();
  if (rows.length) c.getRange(2, 1, rows.length, 8).setValues(rows);
  set.getRange('B9').setValue(new Date());
}

// ---------------------------------------------------------------- edits: Done date, repeats, Notes -> Task, quiz grading
function onEditInstalled(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName(), row = e.range.getRow(), col = e.range.getColumn();
  if (row < 2) return;
  if (name === 'Tasks' && col === 1 && e.range.getNumRows() === 1) return taskToggled_(sh, row, e.value === 'TRUE');
  if (name === 'Notes' && col === 4 && e.value === 'TRUE') return noteToTask_(sh, row);
  if (name === 'Spanish Quiz' && col === 2 && row >= 5) return gradeQuiz_(sh, row, e.value);
}

function taskToggled_(k, row, done) {
  var t = today_();
  k.getRange(row, 15).setValue(done ? t : '');
  if (!done) return;
  var v = k.getRange(row, 1, 1, 13).getValues()[0], rep = v[10], due = v[2] instanceof Date ? v[2] : t;
  if (rep && rep !== 'None' && rep !== 'Paused') {
    var next = new Date(due.getTime());
    if (rep === 'Daily') next.setDate(next.getDate() + 1);
    else if (rep === 'Weekdays') { do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6); }
    else if (rep === 'Weekly') next.setDate(next.getDate() + 7);
    else if (rep === 'Monthly') next.setMonth(next.getMonth() + 1);
    if (next < t) next = t;
    var copy = v.slice(); copy[0] = false; copy[2] = next; copy[13] = t;
    addRow_(k, 2, copy);
  }
  // day cleared?
  var data = k.getRange(2, 1, k.getLastRow() - 1, 15).getValues(), open = 0, doneToday = 0;
  data.forEach(function (r) {
    if (!r[1]) return;
    if (r[0] !== true && r[2] instanceof Date && r[2] <= t) open++;
    if (r[14] instanceof Date && r[14].getTime() === t.getTime()) doneToday++;
  });
  if (open === 0 && doneToday > 0) {
    var streak = Number(SpreadsheetApp.getActive().getSheetByName('Settings').getRange('B8').getValue()) || 0;
    SpreadsheetApp.getActive().toast(doneToday + ' of ' + doneToday + ' done. ' + (streak ? 'Streak: ' + (streak + 1) + ' days.' : 'Streak starts tonight.'), 'Day cleared', 8);
  }
}

function noteToTask_(n, row) {
  var v = n.getRange(row, 1, 1, 5).getValues()[0];
  if (v[4]) return;
  addRow_(sh_('Tasks'), 2, [false, String(v[2]).slice(0, 200), today_(), '', '', '', v[1] || 'Personal', v[1] === 'Work' ? 'Work' : 'Other', '', '', 'None', 'From note', 'Note', today_(), '']);
  n.getRange(row, 5).setValue(today_());
}

// ---------------------------------------------------------------- close the day
function closeDayPrompt() {
  var ui = SpreadsheetApp.getUi(), r = ui.prompt('Close the day', 'One line on today (optional)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  closeDay_(r.getResponseText());
  SpreadsheetApp.getActive().toast('Day closed. Open tasks roll to tomorrow.', 'Life Board', 5);
}
function closeDayAuto() { closeDay_(''); }
function closeDay_(note) {
  var ss = SpreadsheetApp.getActive(), k = ss.getSheetByName('Tasks'), d = ss.getSheetByName('Days'), t = today_();
  var data = k.getLastRow() > 1 ? k.getRange(2, 1, k.getLastRow() - 1, 15).getValues() : [], open = 0, done = 0;
  data.forEach(function (r) {
    if (!r[1]) return;
    if (r[0] !== true && r[2] instanceof Date && r[2] <= t) open++;
    if (r[14] instanceof Date && r[14].getTime() === t.getTime()) done++;
  });
  var due = open + done, score = due ? done / due : 0, cleared = due > 0 && open === 0;
  var rows = d.getLastRow() > 1 ? d.getRange(2, 1, d.getLastRow() - 1, 6).getValues() : [], at = -1;
  rows.forEach(function (r, i) { if (r[0] instanceof Date && r[0].getTime() === t.getTime()) at = i; });
  var keepNote = at >= 0 && !note ? rows[at][5] : note;
  var line = [t, due, done, score, cleared ? 'Yes' : 'No', keepNote || ''];
  if (at >= 0) d.getRange(at + 2, 1, 1, 6).setValues([line]); else d.appendRow(line);
  if (note) addRow_(ss.getSheetByName('Notes'), 3, [new Date(), 'Personal', 'Close the day: ' + note, false, '']);
  // streak = consecutive cleared days ending today (or yesterday if today not cleared yet)
  var all = d.getRange(2, 1, d.getLastRow() - 1, 6).getValues().filter(function (r) { return r[0] instanceof Date; })
    .sort(function (a, b) { return b[0] - a[0]; });
  var streak = 0, expect = new Date(t.getTime());
  for (var i = 0; i < all.length; i++) {
    if (all[i][0].getTime() !== expect.getTime()) break;
    if (all[i][4] !== 'Yes') break;
    streak++; expect = new Date(expect.getTime() - 864e5);
  }
  ss.getSheetByName('Settings').getRange('B8').setValue(streak);
}

// ---------------------------------------------------------------- Spanish quiz (reads/writes your Spanish for Life Tool sheet)
function esBook_() { return SpreadsheetApp.openById(String(sh_('Settings').getRange('B4').getValue()).trim()); }
function esNorm_(x) { return String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }
function esRows_() {
  var sh = esBook_().getSheets()[0], v = sh.getDataRange().getDisplayValues(), out = [];
  for (var r = 1; r < v.length; r++) {
    var es = String(v[r][0]).trim(), en = String(v[r][1]).trim();
    if (!es) continue;
    var passes = []; for (var j = 4; j <= 8; j++) if (String(v[r][j] || '').trim()) passes.push(String(v[r][j]).trim());
    out.push({ row: r + 1, es: es, en: en, note: String(v[r][2] || '').replace(/^N\/A$/i, ''), passes: passes });
  }
  return out;
}
function shuffle_(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
var ES_FILL = ['See you later', "I'm tired", "Let's go", 'How much is it?', "I don't know", 'Of course', 'Take care', 'Good morning', "It's late", 'Be careful'];
function options_(p, all) {
  var pool = shuffle_(all.filter(function (x) { return x.en && x.en !== p.en; }).map(function (x) { return x.en; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; }));
  var opts = [p.en].concat(pool.slice(0, 3)), fill = shuffle_(ES_FILL.filter(function (x) { return opts.indexOf(x) < 0; }));
  while (opts.length < 4) opts.push(fill.shift());
  return shuffle_(opts);
}
function quizRow_(q, row, p, all) {
  q.getRange(row, 1, 1, 4).setValues([[p.es, '', '', p.passes.length + ' of ' + ES_GOAL]]);
  q.getRange(row, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options_(p, all), true).setAllowInvalid(false).build()).setBackground(INPUT);
  q.getRange(row, 3).setFontColor(INK).setFontWeight('normal');
  if (p.note) q.getRange(row, 1).setNote(p.note); else q.getRange(row, 1).clearNote();
}
function newSpanishQuiz() {
  var q = sh_('Spanish Quiz'), all = esRows_(), md = md_(new Date());
  var pick = shuffle_(all.filter(function (p) { return p.en && p.passes.length < ES_GOAL; }))
    .sort(function (a, b) { return (a.passes.indexOf(md) >= 0) - (b.passes.indexOf(md) >= 0) || a.passes.length - b.passes.length; })
    .slice(0, ES_QUIZ);
  var last = q.getLastRow(); if (last >= 5) { q.getRange(5, 1, last - 4, 4).clearContent().clearDataValidations().clearNote().setBackground(null); }
  pick.forEach(function (p, i) { quizRow_(q, 5 + i, p, all); });
  PropertiesService.getScriptProperties().setProperty('QUIZ_RUN', String(Number(PropertiesService.getScriptProperties().getProperty('QUIZ_RUN') || 0) + 1));
  SpreadsheetApp.getActive().setActiveSheet(q);
  SpreadsheetApp.getActive().toast(pick.length ? pick.length + ' phrases. Pick the meaning in column B.' : 'Nothing to quiz. Add phrases with an English meaning to your Spanish sheet.', 'Spanish quiz', 6);
}
function gradeQuiz_(q, row, answer) {
  var es = String(q.getRange(row, 1).getValue()); if (!es || !answer) return;
  if (String(q.getRange(row, 3).getValue())) return;   // already graded
  var all = esRows_(), p = all.filter(function (x) { return esNorm_(x.es) === esNorm_(es); })[0]; if (!p) return;
  var ok = esNorm_(answer) === esNorm_(p.en), md = md_(new Date()), book = esBook_(), main = book.getSheets()[0];
  var log = book.getSheetByName('Quiz Log') || book.insertSheet('Quiz Log');
  if (log.getLastRow() === 0) log.appendRow(['When', 'Frase en Espanol', 'Answered', 'Correct', 'Quiz run']);
  log.appendRow([new Date(), p.es, answer, ok ? 'Yes' : 'No', Number(PropertiesService.getScriptProperties().getProperty('QUIZ_RUN') || 1)]);
  if (ok) {
    if (p.passes.indexOf(md) < 0 && p.passes.length < ES_GOAL) {
      main.getRange(p.row, 5 + p.passes.length).setValue("'" + md); p.passes.push(md);
    }
    q.getRange(row, 3).setValue(p.passes.length >= ES_GOAL ? 'Correct. 5 of 5: retired' : 'Correct').setFontColor('#1e7b45').setFontWeight('bold');
    q.getRange(row, 4).setValue(p.passes.length + ' of ' + ES_GOAL);
  } else {
    q.getRange(row, 3).setValue('Not quite: ' + p.en + '. It comes back below.').setFontColor('#b42318').setFontWeight('bold');
    quizRow_(q, q.getLastRow() + 1, p, all);
  }
  q.getRange(row, 2).setBackground(null);
  // finished?
  var v = q.getRange(5, 1, Math.max(1, q.getLastRow() - 4), 3).getValues(), left = v.filter(function (r) { return r[0] && !r[2]; }).length;
  if (!left) SpreadsheetApp.getActive().toast('Quiz done. Run it again from the Life Board menu any time.', 'Spanish quiz', 6);
}

// ---------------------------------------------------------------- Siri / Shortcuts: POST {action:'add', token, text}
function doPost(e) {
  var b = {}; try { b = JSON.parse(e.postData.contents); } catch (x) {}
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  if (b.token !== PropertiesService.getScriptProperties().getProperty('TOKEN')) return out({ ok: false, error: 'bad key' });
  if (b.action !== 'add') return out({ ok: false, error: 'unknown action' });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return out(addFromText_(String(b.text || ''), 'Siri')); } finally { lock.releaseLock(); }
}
function addFromText_(raw, source) {
  var text = raw.trim(); if (!text) return { ok: false, error: 'empty' };
  var m = text.match(/^(work note|note|task|to ?do|spanish|frase|nota de trabajo|nota|tarea)\b[\s:,.\-]*(.*)$/i), kind = 'task', body = text, work = false;
  if (m) { var k = m[1].toLowerCase(); body = m[2].trim();
    if (/note|nota/.test(k)) { kind = 'note'; work = /work|trabajo/.test(k); } else if (/spanish|frase/.test(k)) kind = 'es'; }
  if (!body) return { ok: false, error: 'empty' };
  var cap = body.charAt(0).toUpperCase() + body.slice(1);
  if (kind === 'note') { addRow_(sh_('Notes'), 3, [new Date(), work ? 'Work' : 'Personal', cap, false, '']); return { ok: true, added: 'note', text: cap }; }
  if (kind === 'es') {
    var parts = body.split(/\s+(?:means|significa|=)\s+/i), sheet = esBook_().getSheets()[0];
    sheet.appendRow([parts[0].trim(), (parts[1] || '').trim(), '', "'" + md_(new Date())]);
    return { ok: true, added: 'spanish', text: parts[0] };
  }
  var p = parseTask_(body);
  addRow_(sh_('Tasks'), 2, [false, p.title, p.date, p.time || '', p.dur || '', '', 'Personal', 'Other', '', '', 'None', '', source, today_(), '']);
  return { ok: true, added: 'task', text: p.title };
}
function parseTask_(raw) {
  var t = ' ' + raw + ' ', out = { date: today_(), time: null, dur: null }, m;
  var cut = function (re) { var x = t.match(re); if (x) t = t.replace(x[0], ' '); return x; };
  if ((m = cut(/\bfor (half an hour|an? hour|(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?))\b/i)))
    out.dur = /half/i.test(m[1]) ? 30 : /^an? hour/i.test(m[1]) ? 60 : Math.round(Number(m[2]) * (/^h/i.test(m[3]) ? 60 : 1));
  if ((m = cut(/\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\s|$)/i)) || (m = cut(/\bat (\d{1,2})(?::(\d{2}))?\b/i))) {
    var h = Number(m[1]), mi = m[2] ? Number(m[2]) : 0, ap = (m[3] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12; else if (ap === 'am' && h === 12) h = 0; else if (!ap && h >= 1 && h <= 6) h += 12;
    out.time = new Date(1899, 11, 30, h, mi);
  }
  var base = today_();
  if (cut(/\btomorrow\b|\bma[ñn]ana\b/i)) out.date = new Date(base.getTime() + 864e5);
  else if (cut(/\btoday\b|\btonight\b|\bhoy\b/i)) out.date = base;
  else if ((m = cut(/\b(?:(next|this|on) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    var want = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(m[2].toLowerCase());
    var n = (want - base.getDay() + 7) % 7; if (n === 0 && m[1] && m[1].toLowerCase() === 'next') n = 7;
    out.date = new Date(base.getTime() + n * 864e5);
  }
  t = t.replace(/^\s*(remind me to|i need to|i have to|add)\s+/i, ' ').replace(/\s+(on|at|by|for)\s*$/i, ' ').replace(/\s+/g, ' ').trim();
  out.title = t ? t.charAt(0).toUpperCase() + t.slice(1) : raw;
  return out;
}
