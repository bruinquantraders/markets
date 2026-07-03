/**
 * BQT Markets — Colonel Blotto backend (Google Apps Script)
 * =========================================================
 * Data store: the "markets.bruinquant.com" Google Sheet.
 * Sheet columns (row 1 = headers):  A: username   B: hash (strategy CSV)
 *
 * DEPLOY
 *   1. Open the Sheet → Extensions → Apps Script.
 *   2. Paste this file in (replace Code.gs contents). Save.
 *   3. Deploy → New deployment → type "Web app".
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   4. Copy the /exec Web app URL and paste it into
 *      assets/js/blotto.js  →  CONFIG.APPS_SCRIPT_URL
 *   5. Re-deploy (New version) whenever you change this file.
 *
 * The strategy is stored in the "hash" column as a comma-separated
 * string of 10 integers that sum to 100, e.g. "10,10,10,10,10,10,10,10,10,10".
 */

var SLOTS = 10;
var TROOPS = 100;
var SHEET_NAME = ''; // '' = first sheet; or set a specific tab name.

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(['username', 'hash']);
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Read all players -> { players: [ { username, strategy:[...] } ] } */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'all';
    if (action === 'all') return json_({ players: readAll_() });
    if (action === 'get') {
      var u = (e.parameter.username || '').trim();
      var all = readAll_();
      var hit = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].username.toLowerCase() === u.toLowerCase()) { hit = all[i]; break; }
      }
      return json_({ player: hit });
    }
    return json_({ error: 'unknown action' });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

/* Upsert: body = { action:'submit', username, strategy:[...] } */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'submit') return json_({ error: 'unknown action' });

    var username = String(body.username || '').trim();
    if (!username) return json_({ error: 'username required' });
    if (username.length > 24) return json_({ error: 'username too long' });

    var strat = validateStrategy_(body.strategy);
    if (!strat) return json_({ error: 'invalid strategy: need ' + SLOTS + ' non-negative ints summing to ' + TROOPS });

    var sh = sheet_();
    var values = sh.getDataRange().getValues();
    var csv = strat.join(',');
    var rowIndex = -1;
    for (var r = 1; r < values.length; r++) { // skip header
      if (String(values[r][0]).trim().toLowerCase() === username.toLowerCase()) { rowIndex = r + 1; break; }
    }
    if (rowIndex === -1) {
      sh.appendRow([username, csv]);
    } else {
      sh.getRange(rowIndex, 1, 1, 2).setValues([[username, csv]]);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function readAll_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  var seen = {};
  for (var r = 1; r < values.length; r++) {
    var name = String(values[r][0]).trim();
    if (!name) continue;
    var strat = validateStrategy_(String(values[r][1]).split(/[,\s]+/));
    if (!strat) continue;
    var key = name.toLowerCase();
    if (seen[key] !== undefined) { out[seen[key]] = { username: name, strategy: strat }; } // last wins
    else { seen[key] = out.length; out.push({ username: name, strategy: strat }); }
  }
  return out;
}

function validateStrategy_(s) {
  if (!s) return null;
  var arr = Array.isArray(s) ? s : String(s).split(/[,\s]+/);
  arr = arr.map(function (n) { return parseInt(n, 10); });
  if (arr.length !== SLOTS) return null;
  for (var i = 0; i < arr.length; i++) {
    if (!isFinite(arr[i]) || arr[i] < 0) return null;
  }
  var total = arr.reduce(function (a, b) { return a + b; }, 0);
  if (total !== TROOPS) return null;
  return arr;
}
