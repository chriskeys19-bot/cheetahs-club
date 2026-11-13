/**
 * Appends Cheetahs Club feedback to the Feedback tab.
 * Spreadsheet 1OjRuhozgCTz5myfPkYMjteSE50WeQVimS1dNL61mSpQ, owned by
 * cheetahscc123@gmail.com. Bind this project from that file:
 * Extensions → Apps Script. Setup is in docs/feedback-sync.md.
 * The shared secret is Script property SYNC_SECRET.
 * Row ids live on the hidden "Sync ids" sheet so a retry does not append twice.
 * Visible rows go only to the Feedback tab, columns A–E.
 */

var SPREADSHEET_ID = '1OjRuhozgCTz5myfPkYMjteSE50WeQVimS1dNL61mSpQ';
var FEEDBACK_TAB = 'Feedback';
var HEADER = ['Timestamp', 'Submitter name', 'Submitter email', 'Role', 'Suggestion'];
var ID_SHEET = 'Sync ids';

function doGet() {
  return respond({ ok: false, error: 'POST only' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return respond({ ok: false, error: 'The sheet is busy. Retry shortly.' });
  }
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!secretMatches(body.secret)) return respond({ ok: false, error: 'unauthorized' });
    var rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length < 1 || rows.length > 50) return respond({ ok: false, error: 'send 1 to 50 rows' });
    return respond({ ok: true, results: appendRows(rows) });
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

function secretMatches(given) {
  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET') || '';
  var left = String(given || '');
  if (!left || !expected || left.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i += 1) diff |= left.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function respond(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function appendRows(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== SPREADSHEET_ID) {
    throw new Error('Bind this script to the club feedback spreadsheet.');
  }
  var sheet = ss.getSheetByName(FEEDBACK_TAB);
  if (!sheet) throw new Error('The Feedback tab is missing.');
  ensureHeader(sheet);
  var ids = idSheet(ss);
  var known = loadIds(ids);
  var results = [];
  rows.forEach(function (row) {
    var id = oneLine(row && row.id, 80).toLowerCase();
    if (!id) {
      results.push({ id: '', status: 'rejected', error: 'missing id' });
      return;
    }
    if (known[id]) {
      results.push({ id: id, status: 'duplicate' });
      return;
    }
    sheet.appendRow([
      oneLine(row.timestamp, 40),
      oneLine(row.submitter_name, 200),
      oneLine(row.submitter_email, 320),
      oneLine(row.role, 40),
      suggestionText(row.suggestion),
    ]);
    ids.appendRow([id]);
    known[id] = true;
    results.push({ id: id, status: 'appended' });
  });
  return results;
}

function ensureHeader(sheet) {
  var current = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0].map(function (cell) {
    return String(cell || '').trim();
  });
  var empty = current.every(function (cell) { return cell === ''; });
  var legacy = current.join('|') === 'Timestamp|Submitter|Email|Role|Suggestion';
  var expected = current.join('|') === HEADER.join('|');
  if (empty || legacy) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
    return;
  }
  if (!expected) {
    throw new Error('Feedback!A1:E1 must be Timestamp, Submitter name, Submitter email, Role, Suggestion.');
  }
}

function idSheet(ss) {
  var sheet = ss.getSheetByName(ID_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ID_SHEET);
    sheet.getRange(1, 1).setValue('id');
    sheet.hideSheet();
  }
  return sheet;
}

function loadIds(sheet) {
  var values = sheet.getDataRange().getValues();
  var known = {};
  for (var i = 1; i < values.length; i += 1) {
    var id = String(values[i][0] || '').trim().toLowerCase();
    if (id) known[id] = true;
  }
  return known;
}

function oneLine(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function suggestionText(value) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
}
