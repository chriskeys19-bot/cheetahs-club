/**
 * Standalone Apps Script for Cheetahs Club winter dues.
 * It is not bound to the spreadsheet. Deploy it as the Google account that
 * can open "Cheetah CC Finance_2026". Setup is in docs/finance-sheet.md.
 *
 * This web app only reads. It has no setValue, appendRow, or batchUpdate.
 * The shared secret is Script property SYNC_SECRET. It is finance_sheet_secret
 * from Supabase Vault, not the feedback secret.
 *
 * Spreadsheet: 1ny69ZpWL6c9r_1xofvROJfcVzWlviWAqKYKdvJtY-Ic
 * Tabs: '26 Winter Club Dues, '26 Winter GC Splits, Game Dues Ledger
 * The dues and splits tab names start with an apostrophe. A1 notation
 * doubles that apostrophe inside the surrounding quotes. Game Dues Ledger
 * does not start with an apostrophe; it is quoted only because of the space.
 * Club Dues is read through column P so column O (automatic credit) and
 * column P (manual credit) come back with the dues grid.
 */

var SPREADSHEET_ID = '1ny69ZpWL6c9r_1xofvROJfcVzWlviWAqKYKdvJtY-Ic';
var DUES_RANGE = "'''26 Winter Club Dues'!A1:P400";
var SPLITS_RANGE = "'''26 Winter GC Splits'!A2:AV700";
var LEDGER_RANGE = "'Game Dues Ledger'!A3:K2000";

function doGet() {
  return respond({ ok: false, error: 'POST only' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!secretMatches(body.secret)) return respond({ ok: false, error: 'unauthorized' });
    if (body.action !== 'read') return respond({ ok: false, error: 'read only' });
    return respond(readLedger());
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) });
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

function readRange(range) {
  var result = Sheets.Spreadsheets.Values.get(SPREADSHEET_ID, range, {
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return result && result.values ? result.values : [];
}

function readOptionalRange(range) {
  try {
    return readRange(range);
  } catch (err) {
    return null;
  }
}

function readLedger() {
  var payload = {
    ok: true,
    readOnly: true,
    spreadsheetId: SPREADSHEET_ID,
    dues: { startRow: 1, values: readRange(DUES_RANGE) },
    splits: { startRow: 2, values: readRange(SPLITS_RANGE) },
  };
  // A deployment that cannot see the ledger tab still returns dues and splits.
  var ledgerValues = readOptionalRange(LEDGER_RANGE);
  if (ledgerValues) payload.ledger = { startRow: 3, values: ledgerValues };
  return payload;
}
