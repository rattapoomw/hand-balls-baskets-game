/**
 * BALL & BOX — Google Apps Script receiver.
 * One flat sheet. Every row carries a `type`:
 *   session | wave | movement | pinchcheck | calib
 *
 * Use a SEPARATE Google Sheet from the word game. The two games are
 * independent; rows still carry a `game` column so the logs can be joined on
 * player_key later if a single patient timeline is ever wanted.
 *
 * SETUP
 *  1. New Google Sheet ▸ Extensions ▸ Apps Script ▸ paste this file.
 *  2. Deploy ▸ New deployment ▸ Web app.
 *       Execute as:     Me
 *       Who has access: Anyone
 *  3. Copy the /exec URL into `endpoint` in ballbox_config.js.
 *
 * When you edit this script later you must Deploy ▸ Manage deployments ▸ ✏️ ▸
 * New version, or the old URL keeps serving the old code.
 *
 * The game sends text/plain rather than application/json on purpose: that
 * keeps it a "simple request", so the browser skips the CORS preflight that
 * Apps Script cannot answer.
 *
 *
 * WHY COLUMNS ARE MAPPED BY NAME
 * The obvious implementation keeps a fixed HEADERS array, writes each row
 * positionally, and creates the header row only when the sheet is empty:
 *
 *     if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
 *
 * Add a column to that array later and an existing sheet keeps its OLD header
 * row while new rows arrive in the NEW order. Every column past the insertion
 * point shifts by one. The header still looks correct, nothing errors, and
 * the damage is only detectable if you know the exact deploy time.
 *
 * Here the sheet's own header row is the authority. Unknown keys are appended
 * as new columns on the right. Old rows keep their meaning; new fields simply
 * start being populated the day they first appear.
 */

var SHEET    = 'log';
var READ_KEY = '';        // set to a string to require ?key= on reads
var MAX_ROWS = 20000;     // cap on a single read response
var MAX_COLS = 400;       // a runaway client must not grow the sheet forever

/* How far back to look when checking whether a rid has already landed.
   Retries follow the original send within minutes, so a window beats a full
   column scan: the scan is O(sheet) inside a lock that serialises every
   client, and this game logs ~30 movement rows per session. */
var DEDUP_WINDOW = 2000;

/* Seed order for a brand-new sheet. NOT authoritative — the sheet's own
   header row wins once it exists, so this never has to stay in sync with the
   game. */
var SEED = ['rid', 'type', 'game', 'ts', 'sid', 'player_key', 'display_name',
            'note', 'side', 'posture', 'received_at'];


/* ---------------------------------------------------------------------------
   Header handling
--------------------------------------------------------------------------- */
function headerMap_(sh) {
  var lastCol = sh.getLastColumn();
  if (sh.getLastRow() === 0 || lastCol === 0) {
    sh.getRange(1, 1, 1, SEED.length).setValues([SEED]);
    sh.setFrozenRows(1);
    lastCol = SEED.length;
  }
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i]).trim();
    if (name && idx[name] === undefined) idx[name] = i;   // first wins
  }
  return { header: header, idx: idx };
}

/* Append every key the sheet has not seen, once per request rather than once
   per row. */
function extendHeader_(sh, map, rows) {
  var missing = [], seen = {};
  for (var r = 0; r < rows.length; r++) {
    for (var k in rows[r]) {
      if (!rows[r].hasOwnProperty(k)) continue;
      if (map.idx[k] === undefined && !seen[k]) { seen[k] = true; missing.push(k); }
    }
  }
  if (!missing.length) return map;

  var start = map.header.length;
  if (start + missing.length > MAX_COLS) {
    missing = missing.slice(0, Math.max(0, MAX_COLS - start));
    if (!missing.length) return map;
  }
  if (sh.getMaxColumns() < start + missing.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - sh.getMaxColumns());
  }
  sh.getRange(1, start + 1, 1, missing.length).setValues([missing]);
  for (var i = 0; i < missing.length; i++) {
    map.idx[missing[i]] = start + i;
    map.header.push(missing[i]);
  }
  return map;
}

/* Recent rids only — see DEDUP_WINDOW. */
function recentRids_(sh, ridCol) {
  var seen = {};
  if (ridCol === undefined || sh.getLastRow() < 2) return seen;
  var first = Math.max(2, sh.getLastRow() - DEDUP_WINDOW + 1);
  var n = sh.getLastRow() - first + 1;
  if (n < 1) return seen;
  var have = sh.getRange(first, ridCol + 1, n, 1).getValues();
  for (var i = 0; i < have.length; i++) {
    if (have[i][0]) seen[String(have[i][0])] = 1;
  }
  return seen;
}


/* ---------------------------------------------------------------------------
   Write
--------------------------------------------------------------------------- */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);

    var rows = (JSON.parse(e.postData.contents).rows) || [];
    if (!rows.length) return json_({ ok: true, n: 0, skipped: 0 });

    var map = headerMap_(sh);
    map = extendHeader_(sh, map, rows);

    /* The client resends anything it could not confirm, so duplicate rids are
       expected rather than exceptional. */
    var seen = recentRids_(sh, map.idx['rid']);
    var before = rows.length;
    rows = rows.filter(function (r) {
      if (!r.rid) return true;
      if (seen[String(r.rid)]) return false;
      seen[String(r.rid)] = 1;
      return true;
    });

    var now = new Date(), width = map.header.length;
    var out = rows.map(function (r) {
      var line = new Array(width).fill('');
      for (var k in r) {
        if (!r.hasOwnProperty(k)) continue;
        var c = map.idx[k];
        if (c === undefined) continue;                 // dropped by MAX_COLS
        line[c] = (r[k] === null || r[k] === undefined) ? '' : r[k];
      }
      if (map.idx['received_at'] !== undefined) line[map.idx['received_at']] = now;
      return line;
    });

    if (out.length) {
      sh.getRange(sh.getLastRow() + 1, 1, out.length, width).setValues(out);
    }
    return json_({ ok: true, n: out.length, skipped: before - out.length, cols: width });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}


/* ---------------------------------------------------------------------------
   Read
     ?action=data&callback=fn   → JSONP (works cross-origin from Pages)
     ?action=data               → plain JSON
     ?since=2026-07-01          → rows at/after this ISO date
     ?action=has&rid=…          → did this row land? (delivery confirmation)
     ?key=SECRET                → required only if READ_KEY is set

   Returns columns + rows-as-arrays rather than objects: for ~10k rows that is
   roughly a third of the payload.
--------------------------------------------------------------------------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'data' && p.action !== 'has') {
    return ContentService.createTextOutput('Ball & Box stats endpoint is running.');
  }

  var out;
  try {
    if (READ_KEY && p.key !== READ_KEY) throw new Error('bad key');
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET);

    if (p.action === 'has') {
      var found = false;
      if (sh && sh.getLastRow() > 1) {
        var m = headerMap_(sh);
        var rc = m.idx['rid'];
        if (rc !== undefined) found = !!recentRids_(sh, rc)[String(p.rid)];
      }
      return reply_({ ok: true, found: found }, p.callback);
    }

    if (!sh || sh.getLastRow() < 2) {
      out = { ok: true, columns: sh ? headerMap_(sh).header.map(String) : SEED, rows: [] };
    } else {
      var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
      var cols = values.shift().map(String);
      var tsIdx = cols.indexOf('ts');
      var since = p.since ? String(p.since) : null;
      var rows = [];

      for (var i = 0; i < values.length; i++) {
        var r = values[i];
        /* Normalise BEFORE filtering. Sheets may have coerced an ISO string
           into a real date value, and String(Date) is "Sat Aug 08 2026 …",
           which compares against "2026-07-01" as gibberish — silently keeping
           or dropping everything depending on the first letter. */
        for (var c = 0; c < r.length; c++) {
          if (r[c] instanceof Date) r[c] = r[c].toISOString();
        }
        if (since && tsIdx >= 0 && String(r[tsIdx]) < since) continue;
        rows.push(r);
      }

      /* Keep the NEWEST rows when over the cap — truncating from the top
         would hide the most recent sessions, which is the opposite of useful. */
      var truncated = rows.length > MAX_ROWS;
      if (truncated) rows = rows.slice(rows.length - MAX_ROWS);
      out = { ok: true, columns: cols, rows: rows, truncated: truncated };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return reply_(out, p.callback);
}


/* ---------------------------------------------------------------------------
   Helpers
--------------------------------------------------------------------------- */
function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Quick sanity check from the editor: does every row's `type` hold a value
   this game actually writes? Anything else is a sign of a column shift from
   an older positional receiver. */
function auditRows() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET);
  if (!sh || sh.getLastRow() < 2) { Logger.log('empty sheet'); return; }
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = values.shift().map(function (h) { return String(h).trim(); });
  var ti = header.indexOf('type');
  var known = ['session', 'wave', 'movement', 'pinchcheck', 'calib'];
  var bad = [];
  values.forEach(function (r, i) {
    var t = String(r[ti]);
    if (t && known.indexOf(t) < 0) bad.push(i + 2);
  });
  Logger.log(bad.length ? 'Suspect rows: ' + bad.join(', ')
                        : 'All ' + values.length + ' rows have a valid type.');
}
