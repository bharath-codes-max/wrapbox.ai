/**
 * Wrapbox waitlist — Google Apps Script backend.  $0, no third-party service.
 *
 * It owns three things:
 *   1. the sheet          — one row per signup, de-duplicated by email
 *   2. the welcome email  — sent from your own Gmail via MailApp (free quota: 100/day
 *                           on a consumer account, 1,500/day on Workspace)
 *   3. the public count   — the real number of rows, for the landing page counter
 *
 * ── SETUP (once, ~4 minutes) ────────────────────────────────────────────────
 * 1. Create a Google Sheet. Name the first tab exactly:  waitlist
 * 2. Extensions → Apps Script. Delete the sample code, paste this whole file, Save.
 * 3. Run ▸ setupSheet  once. Approve the permissions prompt (Sheets + Gmail send).
 * 4. Deploy → New deployment → type "Web app".
 *       Execute as:        Me
 *       Who has access:    Anyone
 *    Deploy, then copy the /exec URL.
 * 5. In Vercel → your project → Settings → Environment Variables, add:
 *       WAITLIST_SHEET_URL = <the /exec URL>
 *    Redeploy. Done — signups land in the sheet and the welcome mail goes out.
 *
 * Re-deploying after an edit: Deploy → Manage deployments → edit ▸ New version.
 * The /exec URL stays the same, so the Vercel env var never changes.
 */

var SHEET_NAME = 'waitlist';
var BRAND = 'Wrapbox';
var FROM_NAME = 'Wrapbox';
var REPLY_TO = '';           // optional: 'hello@wrapbox.ai'
var SEND_WELCOME_EMAIL = true;

/** Run once from the editor: creates the tab and its header row. */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['position', 'joined_at', 'email', 'role', 'company', 'welcome_sent']);
    sh.getRange('A1:F1').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return 'ready';
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var col = sh.getRange(2, 3, last - 1, 1).getValues();   // column C = email
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

    var role = String(body.role || 'other').trim();
    var company = String(body.company || '').trim();

    // Already on the list → hand back the original position, never a second row.
    var existing = findRow_(sh, email);
    if (existing) {
      return json_({ ok: true, position: Number(sh.getRange(existing, 1).getValue()) || existing - 1, duplicate: true, count: Math.max(0, sh.getLastRow() - 1) });
    }

    var position = sh.getLastRow();          // header occupies row 1, so this is the next position
    var sent = false;
    if (SEND_WELCOME_EMAIL) {
      try { sendWelcome_(email, position); sent = true; } catch (err) { sent = false; }
    }
    sh.appendRow([position, new Date(), email, role, company, sent ? 'yes' : 'no']);

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

/* ── the welcome email ────────────────────────────────────────────────────── */

function sendWelcome_(email, position) {
  var opts = { name: FROM_NAME, htmlBody: welcomeHtml_(position) };
  if (REPLY_TO) opts.replyTo = REPLY_TO;
  MailApp.sendEmail(email, "You're on the Wrapbox waitlist — #" + position, welcomeText_(position), opts);
}

function welcomeText_(position) {
  return [
    "You're on the Wrapbox waitlist.",
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

function welcomeHtml_(position) {
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
        '<div style="font-size:21px;font-weight:600;color:' + ink + ';letter-spacing:-0.02em;">You&rsquo;re on the list.</div>' +
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
