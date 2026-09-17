/**
 * Wrapbox waitlist — Google Apps Script backend.  $0, no third-party service.
 *
 * It owns three things:
 *   1. the sheet          — one row per signup, de-duplicated by email
 *   2. the welcome email  — sent from your own Gmail via MailApp (free quota: 100/day
 *                           on a consumer account, 1,500/day on Workspace). Sent by a
 *                           1-minute timer (sendPendingWelcomes), NOT inside doPost —
 *                           so a slow Gmail send can never make a signup itself time out.
 *   3. the row count      — available via doGet/action:'count' for any internal use
 *
 * ── SETUP (once, ~4 minutes) ────────────────────────────────────────────────
 * 1. Create a Google Sheet (sheet.new). Name the first tab exactly:  waitlist
 * 2. Copy its id out of the URL and paste it into SHEET_ID below:
 *       https://docs.google.com/spreadsheets/d/THIS_LONG_ID_HERE/edit
 *    (If you instead created this script from the Sheet itself via
 *     Extensions → Apps Script, you can leave SHEET_ID empty.)
 * 3. Paste this whole file over the sample code in Code.gs, then Save.
 * 4. Run ▸ setupSheet  once. Approve the permissions prompt (Sheets + Gmail send +
 *    "manage your triggers" — new this version, for the 1-minute welcome-email timer).
 *    "Google hasn't verified this app" → Advanced → Go to <project> (unsafe).
 *    It's your own script; that warning is just for unpublished projects.
 * 5. Deploy → New deployment → gear ▸ Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *    Deploy, then copy the /exec URL.
 * 6. In Vercel → your project → Settings → Environment Variables, add:
 *       WAITLIST_SHEET_URL = <the /exec URL>
 *    Redeploy. Done — signups land in the sheet instantly and the welcome mail
 *    follows within about a minute.
 *
 * Already deployed and just pulled this update? Re-paste this file, Save, then
 * run ▸ setupSheet once more (it re-installs the timer; running it twice is
 * harmless) — Deploy → Manage deployments → edit ▸ New version, same as any edit.
 * The /exec URL stays the same, so the Vercel env var never changes.
 */

// Paste the id from your Sheet's URL. Leave '' only if this script was created
// from inside the Sheet (Extensions → Apps Script), which binds it automatically.
var SHEET_ID = '1mv_uOqB32Ek2z_B_P1A5VjOSI9JPYdW7JWD9PNHufU0';
var SHEET_NAME = 'waitlist';
var BRAND = 'Wrapbox';
var FROM_NAME = 'Wrapbox';
var REPLY_TO = '';           // optional: 'hello@wrapbox.ai'
var SEND_WELCOME_EMAIL = true;

/** The spreadsheet, whether this script is standalone (SHEET_ID) or bound to it. */
function book_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet. Paste your Sheet id into SHEET_ID at the top of this file.');
  return ss;
}

// Current layout. Role is free text (a searched-or-typed job title from the
// form), not the old fixed enum — there is no newsletter feature anymore, so
// there is no last_newsletter column either.
var HEADERS = ['position', 'joined_at', 'name', 'email', 'phone', 'role', 'company', 'company_url', 'message', 'welcome_sent'];
// Two earlier layouts this migrates FROM, oldest first, so a sheet at either
// point gets remapped into HEADERS rather than corrupted by a blind append.
var HEADERS_V1 = ['position', 'joined_at', 'email', 'role', 'company', 'welcome_sent', 'last_newsletter'];
var HEADERS_V2 = ['position', 'joined_at', 'name', 'email', 'phone', 'company', 'company_url', 'message', 'welcome_sent', 'last_newsletter'];

/** Run once from the editor: creates the tab, or migrates it to the current column layout. */
function setupSheet() {
  var ss = book_();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  ensureWelcomeTrigger_(); // idempotent — safe to call on every run of setupSheet

  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    return 'ready';
  }

  var current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (current.join('|') === HEADERS.join('|')) return 'already up to date';

  var last = sh.getLastRow();
  var migrated = null;

  if (current.join('|') === HEADERS_V1.join('|')) {
    // old: [position, joined_at, email, role, company, welcome_sent, last_newsletter]
    var oldV1 = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS_V1.length).getValues() : [];
    migrated = oldV1.map(function (r) {
      return [r[0], r[1], '', r[2], '', r[3], r[4], '', '', r[5]];
    });
  } else if (current.join('|') === HEADERS_V2.join('|')) {
    // old: [position, joined_at, name, email, phone, company, company_url, message, welcome_sent, last_newsletter]
    var oldV2 = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS_V2.length).getValues() : [];
    migrated = oldV2.map(function (r) {
      return [r[0], r[1], r[2], r[3], r[4], '', r[5], r[6], r[7], r[8]];
    });
  }

  if (migrated) {
    sh.clearContents();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    if (migrated.length) sh.getRange(2, 1, migrated.length, HEADERS.length).setValues(migrated);
    sh.setFrozenRows(1);
    return 'migrated ' + migrated.length + ' row(s) from the old layout';
  }

  // An unrecognised layout: extend it rather than guess at reordering it.
  if (sh.getLastColumn() < HEADERS.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, HEADERS.length - sh.getLastColumn()).setValues([HEADERS.slice(sh.getLastColumn())]).setFontWeight('bold');
  }
  return 'extended an unrecognised layout — check the header row';
}

function sheet_() {
  var ss = book_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { setupSheet(); sh = ss.getSheetByName(SHEET_NAME); }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Row index (1-based) of an email already on the list, or 0. */
function findRow_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = sh.getRange(2, 4, last - 1, 1).getValues();   // column D = email
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toLowerCase() === email) return i + 2;
  }
  return 0;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);   // two people submitting at once must not get the same position
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }

    var sh = sheet_();

    if (body.action === 'count') {
      return json_({ ok: true, count: Math.max(0, sh.getLastRow() - 1) });
    }

    var email = String(body.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) return json_({ ok: false, error: 'bad email' });

    // Everything else is deliberately unenforced here too — the form marks
    // these required but never blocks on them, so a blank string is a valid,
    // honest value rather than something to reject.
    var name = String(body.name || '').trim();
    var phone = String(body.phone || '').trim();
    var role = String(body.role || '').trim();
    var company = String(body.company || '').trim();
    var companyUrl = String(body.companyUrl || '').trim();
    var message = String(body.message || '').trim();

    // Already on the list → hand back the original position, never a second row.
    var existing = findRow_(sh, email);
    if (existing) {
      return json_({ ok: true, position: Number(sh.getRange(existing, 1).getValue()) || existing - 1, duplicate: true, count: Math.max(0, sh.getLastRow() - 1) });
    }

    var position = sh.getLastRow();          // header occupies row 1, so this is the next position
    // The row is written and the response returned WITHOUT waiting on Gmail:
    // MailApp.sendEmail can occasionally take long enough (especially on a
    // cold start) to blow past the caller's own timeout, which would report
    // a false failure even though the signup itself succeeded. The welcome
    // email is sent a few seconds later by sendPendingWelcomes(), on a timer
    // this file's own setupSheet() installs — see below.
    sh.appendRow([position, new Date(), name, email, phone, role, company, companyUrl, message, SEND_WELCOME_EMAIL ? 'pending' : 'no']);

    return json_({ ok: true, position: position, duplicate: false, count: Math.max(0, sh.getLastRow() - 1) });
  } catch (err) {
    return json_({ ok: false, error: String(err).slice(0, 120) });
  } finally {
    lock.releaseLock();
  }
}

/** The counter on the landing page also comes through here. */
function doGet() {
  var sh = sheet_();
  return json_({ ok: true, count: Math.max(0, sh.getLastRow() - 1) });
}

var WELCOME_SENT_COL = 10; // column J — must match HEADERS' welcome_sent position

/**
 * Runs on a 1-minute timer (installed once by setupSheet). Sends the welcome
 * mail for any row still marked 'pending' — decoupled from doPost entirely,
 * so a slow Gmail send can never make a signup itself time out. A row stays
 * 'pending' and is simply retried next run if sending throws.
 */
function sendPendingWelcomes() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return 'nothing pending';

  var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var sent = 0, failed = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[WELCOME_SENT_COL - 1]) !== 'pending') continue;
    var email = String(r[3] || '').trim();
    if (!email) continue;
    try {
      sendWelcome_(email, r[0], String(r[2] || ''));
      sh.getRange(i + 2, WELCOME_SENT_COL).setValue('yes');
      sent++;
    } catch (err) {
      failed++; // stays 'pending' — picked up again next run
    }
  }
  return 'sent ' + sent + ', failed (retrying next run): ' + failed;
}

/** Idempotent: only installs the 1-minute trigger for sendPendingWelcomes if it isn't there yet. */
function ensureWelcomeTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendPendingWelcomes') return;
  }
  ScriptApp.newTrigger('sendPendingWelcomes').timeBased().everyMinutes(1).create();
}

/* ── the welcome email ────────────────────────────────────────────────────── */

function sendWelcome_(email, position, name) {
  var opts = { name: FROM_NAME, htmlBody: welcomeHtml_(position, name) };
  if (REPLY_TO) opts.replyTo = REPLY_TO;
  MailApp.sendEmail(email, "You're on the Wrapbox waitlist — #" + position, welcomeText_(position, name), opts);
}

function welcomeText_(position, name) {
  var first = name ? String(name).trim().split(/\s+/)[0] : '';
  return [
    first ? 'Hi ' + first + ',' : "You're on the Wrapbox waitlist.",
    '',
    'Position #' + position,
    '',
    'Wrapbox is the runtime authorization layer for AI agents. Every risky action — from a coding',
    'agent running a shell command to an MCP tool moving money — is checked against one intent',
    'contract, milliseconds before it runs. Allowed, constrained, held for a human, or blocked,',
    'with a signed receipt either way.',
    '',
    'What happens next',
    '  1. We open access in small batches, security and platform teams first.',
    "  2. When your turn comes you'll get an invite from this address with a workspace link.",
    '  3. Reply to this email any time — it reaches a person, not a queue.',
    '',
    '— The ' + BRAND + ' team',
  ].join('\n');
}

function welcomeHtml_(position, name) {
  var first = name ? String(name).trim().split(/\s+/)[0] : '';
  var ink = '#111c35', muted = '#4a5061', faint = '#8a8e99', line = '#e6e5e0', paper = '#fafaf8';
  return '' +
  '<div style="margin:0;padding:32px 16px;background:' + paper + ';font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ' + line + ';border-radius:16px;overflow:hidden;">' +

      // header
      '<div style="background:' + ink + ';padding:22px 28px;">' +
        '<div style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:-0.02em;">' + BRAND + '</div>' +
        '<div style="color:rgba(255,255,255,0.62);font-size:12.5px;margin-top:3px;">Runtime authorization for AI agents</div>' +
      '</div>' +

      // the position, as a receipt
      '<div style="padding:28px 28px 4px;">' +
        '<div style="font-size:21px;font-weight:600;color:' + ink + ';letter-spacing:-0.02em;">' + (first ? 'Hi ' + first + ' &mdash; you&rsquo;re on the list.' : 'You&rsquo;re on the list.') + '</div>' +
        '<div style="margin-top:16px;border:1px solid ' + line + ';border-radius:12px;background:' + paper + ';padding:16px 18px;">' +
          '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:' + faint + ';">Waitlist position</div>' +
          '<div style="font-size:32px;font-weight:600;color:' + ink + ';letter-spacing:-0.03em;margin-top:2px;">#' + position + '</div>' +
        '</div>' +
      '</div>' +

      // what it is
      '<div style="padding:20px 28px 0;">' +
        '<p style="margin:0;font-size:14.5px;line-height:1.65;color:' + muted + ';">' +
          'Wrapbox checks every risky thing an AI agent tries to do — a shell command, a force&#8209;push, a refund, ' +
          'a production write — against one intent contract, milliseconds before it runs. ' +
          '<strong style="color:' + ink + ';">Allowed, constrained, held for a person, or blocked</strong>, with a signed receipt either way.' +
        '</p>' +
      '</div>' +

      // what happens next
      '<div style="padding:22px 28px 4px;">' +
        '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:' + faint + ';padding-bottom:10px;">What happens next</div>' +
        step_(1, 'We open access in small batches', 'Security and platform teams first, so we can support each one properly.', line, ink, muted) +
        step_(2, 'You get an invite from this address', 'A workspace link, plus a 10&#8209;minute setup for your first agent.', line, ink, muted) +
        step_(3, 'Reply any time', 'This inbox reaches a person, not a queue. Tell us which agents you run.', line, ink, muted) +
      '</div>' +

      '<div style="padding:22px 28px 26px;">' +
        '<div style="border-top:1px solid ' + line + ';padding-top:16px;font-size:12px;line-height:1.6;color:' + faint + ';">' +
          'You received this because you joined the ' + BRAND + ' waitlist. ' +
          'We&rsquo;ll only email you about access — no newsletter, no list sharing.' +
        '</div>' +
      '</div>' +

    '</div>' +
  '</div>';
}

function step_(n, title, body, line, ink, muted) {
  return '' +
  '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>' +
    '<td style="width:26px;vertical-align:top;padding-top:1px;">' +
      '<div style="width:20px;height:20px;border-radius:999px;border:1px solid ' + line + ';color:' + muted + ';font-size:11px;font-weight:600;text-align:center;line-height:20px;">' + n + '</div>' +
    '</td>' +
    '<td style="vertical-align:top;padding-left:10px;">' +
      '<div style="font-size:13.5px;font-weight:600;color:' + ink + ';">' + title + '</div>' +
      '<div style="font-size:13px;line-height:1.55;color:' + muted + ';margin-top:2px;">' + body + '</div>' +
    '</td>' +
  '</tr></table>';
}

