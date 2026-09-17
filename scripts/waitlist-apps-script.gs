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
 * 1. Create a Google Sheet (sheet.new). Name the first tab exactly:  waitlist
 * 2. Copy its id out of the URL and paste it into SHEET_ID below:
 *       https://docs.google.com/spreadsheets/d/THIS_LONG_ID_HERE/edit
 *    (If you instead created this script from the Sheet itself via
 *     Extensions → Apps Script, you can leave SHEET_ID empty.)
 * 3. Paste this whole file over the sample code in Code.gs, then Save.
 * 4. Run ▸ setupSheet  once. Approve the permissions prompt (Sheets + Gmail send).
 *    "Google hasn't verified this app" → Advanced → Go to <project> (unsafe).
 *    It's your own script; that warning is just for unpublished projects.
 * 5. Deploy → New deployment → gear ▸ Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *    Deploy, then copy the /exec URL.
 * 6. In Vercel → your project → Settings → Environment Variables, add:
 *       WAITLIST_SHEET_URL = <the /exec URL>
 *    Redeploy. Done — signups land in the sheet and the welcome mail goes out.
 *
 * Re-deploying after an edit: Deploy → Manage deployments → edit ▸ New version.
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

/** Run once from the editor: creates the tab and its header row. */
function setupSheet() {
  var ss = book_();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  var headers = ['position', 'joined_at', 'email', 'role', 'company', 'welcome_sent', 'last_newsletter'];
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    // Migrates a sheet made before the newsletter feature existed: adds the
    // missing column without touching any row already on the list.
    sh.getRange(1, sh.getLastColumn() + 1, 1, headers.length - sh.getLastColumn()).setValues([headers.slice(sh.getLastColumn())]).setFontWeight('bold');
  }
  return 'ready';
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
    sh.appendRow([position, new Date(), email, role, company, sent ? 'yes' : 'no', '']);

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

/* ══════════════════════════════════════════════════════════════════════════
 * NEWSLETTER — send a product update to everyone on the waitlist, free,
 * from your own Gmail. Nothing here touches doGet/doPost, so editing or
 * running this needs NO redeploy — just Save, then Run ▸ sendNewsletter.
 *
 * HOW IT WORKS
 *   Bump NEWSLETTER_VERSION below each time you have a new update, edit
 *   NEWSLETTER (the only part you should need to touch), Save, then run
 *   sendNewsletter from the function dropdown. It emails everyone whose
 *   `last_newsletter` column isn't already this version — so re-running
 *   after an error, or after new people join, never double-sends the same
 *   edition to anyone who already got it.
 *
 * QUOTA (free, no card): ~100 emails/day on a personal Gmail, ~1,500/day on
 * Google Workspace (hello@wrapbox.io is Workspace, so 1,500/day). A list
 * bigger than that sends in batches automatically — MAX_PER_RUN below caps
 * how many go out in one click, so you never blow the daily quota by
 * accident; just run it again to continue the rest.
 * ══════════════════════════════════════════════════════════════════════════ */

var NEWSLETTER_VERSION = 'v1';     // bump this string for every new edition you send
var MAX_PER_RUN = 450;             // headroom under the 1,500/day Workspace quota

// ── Edit this block for each edition. Plain text and simple arrays only —
// the HTML layout below turns it into the designed email automatically. ──
var NEWSLETTER = {
  subject: "What's shipping in Wrapbox",
  kicker: 'Product update',
  headline: 'Every agent action now gets a signed receipt.',
  intro:
    "Since you joined the waitlist we've shipped the pieces that make Wrapbox " +
    'a runtime layer, not a linter: real OS-level enforcement, a signed evidence ' +
    'chain, and human approvals you sign with a passkey instead of a click.',
  updates: [
    {
      title: 'Runtime enforcement, not just logging',
      body: 'Apple Endpoint Security on macOS and kernel-level confinement on Linux stop a disallowed action before it runs — not after.',
    },
    {
      title: 'Approvals are signed, not clicked',
      body: 'A held request routes to the right approver in Slack or Teams. They see the exact statement, sign with a passkey, and the permit is bound to those exact arguments.',
    },
    {
      title: 'Evidence you can hand an auditor',
      body: 'Human → agent → rule → permit → outcome, hash-chained for every decision. Filter by environment, person or agent.',
    },
  ],
  ctaLabel: 'See the policy engine in action',
  ctaUrl: 'https://wrapbox-prototype.vercel.app/#/landing',
};

// Real tiers from the pricing page — kept in one place so the newsletter
// can never drift from what the site actually charges.
var TIERS = [
  { name: 'Starter', unit: 'free forever', blurb: 'For a founder or a small team trying agents safely.' },
  { name: 'Team', unit: 'per person / month', blurb: 'For teams putting coding and business agents into daily work.' },
  { name: 'Business', unit: 'per person / month', blurb: 'For companies rolling agents out across departments.' },
  { name: 'Enterprise', unit: 'annual contract', blurb: 'For regulated companies with their own security and data rules.' },
];

/** Run this from the editor whenever you have an update to send. */
function sendNewsletter() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return 'nobody on the list yet';

  var rows = sh.getRange(2, 1, last - 1, 7).getValues();  // A:G
  var sent = 0, skipped = 0, failed = 0;

  for (var i = 0; i < rows.length; i++) {
    if (sent >= MAX_PER_RUN) break;
    var r = rows[i];
    var email = String(r[2] || '').trim();
    var already = String(r[6] || '');
    if (!email) continue;
    if (already === NEWSLETTER_VERSION) { skipped++; continue; }

    try {
      MailApp.sendEmail(email, NEWSLETTER.subject, newsletterText_(), { name: FROM_NAME, htmlBody: newsletterHtml_() });
      sh.getRange(i + 2, 7).setValue(NEWSLETTER_VERSION);
      sent++;
    } catch (err) {
      failed++;
    }
  }
  var msg = 'sent ' + sent + ', already had ' + NEWSLETTER_VERSION + ': ' + skipped + ', failed: ' + failed +
    (sent >= MAX_PER_RUN ? ' — hit the per-run cap, run again for the rest' : '');
  Logger.log(msg);
  return msg;
}

function newsletterText_() {
  var lines = [NEWSLETTER.headline, '', NEWSLETTER.intro, ''];
  NEWSLETTER.updates.forEach(function (u) { lines.push('• ' + u.title + ' — ' + u.body); });
  lines.push('', NEWSLETTER.ctaLabel + ': ' + NEWSLETTER.ctaUrl, '', '— The ' + BRAND + ' team');
  return lines.join('\n');
}

function newsletterHtml_() {
  var ink = '#111c35', muted = '#4a5061', faint = '#8a8e99', line = '#e6e5e0', paper = '#fafaf8', accent = '#1848ff';

  var updatesHtml = NEWSLETTER.updates.map(function (u) {
    return '' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:14px;"><tr>' +
      '<td style="width:8px;vertical-align:top;padding-top:5px;"><div style="width:6px;height:6px;border-radius:999px;background:' + accent + ';"></div></td>' +
      '<td style="vertical-align:top;padding-left:12px;">' +
        '<div style="font-size:14px;font-weight:600;color:' + ink + ';">' + u.title + '</div>' +
        '<div style="font-size:13.5px;line-height:1.6;color:' + muted + ';margin-top:3px;">' + u.body + '</div>' +
      '</td>' +
    '</tr></table>';
  }).join('');

  var tiersHtml = TIERS.map(function (t) {
    return '' +
    '<td style="width:25%;vertical-align:top;padding:14px 10px;border:1px solid ' + line + ';border-radius:10px;">' +
      '<div style="font-size:13px;font-weight:600;color:' + ink + ';">' + t.name + '</div>' +
      '<div style="font-size:10.5px;color:' + faint + ';margin-top:2px;">' + t.unit + '</div>' +
      '<div style="font-size:11.5px;line-height:1.5;color:' + muted + ';margin-top:6px;">' + t.blurb + '</div>' +
    '</td>' +
    '<td style="width:8px;"></td>';
  }).join('');

  return '' +
  '<div style="margin:0;padding:32px 16px;background:' + paper + ';font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ' + line + ';border-radius:16px;overflow:hidden;">' +

      '<div style="background:' + ink + ';padding:22px 28px;">' +
        '<div style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:-0.02em;">' + BRAND + '</div>' +
        '<div style="color:rgba(255,255,255,0.62);font-size:12.5px;margin-top:3px;">' + NEWSLETTER.kicker + '</div>' +
      '</div>' +

      '<div style="padding:28px 28px 0;">' +
        '<div style="font-size:22px;font-weight:600;color:' + ink + ';letter-spacing:-0.02em;line-height:1.3;">' + NEWSLETTER.headline + '</div>' +
        '<p style="margin:14px 0 0;font-size:14.5px;line-height:1.65;color:' + muted + ';">' + NEWSLETTER.intro + '</p>' +
      '</div>' +

      '<div style="padding:24px 28px 6px;">' +
        '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:' + faint + ';padding-bottom:12px;">What shipped</div>' +
        updatesHtml +
      '</div>' +

      '<div style="padding:8px 28px 4px;">' +
        '<a href="' + NEWSLETTER.ctaUrl + '" style="display:inline-block;background:' + ink + ';color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;padding:11px 20px;border-radius:999px;">' + NEWSLETTER.ctaLabel + ' →</a>' +
      '</div>' +

      '<div style="padding:26px 28px 8px;">' +
        '<div style="border-top:1px solid ' + line + ';padding-top:18px;">' +
          '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:' + faint + ';padding-bottom:10px;">Plans, unchanged</div>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0;"><tr>' + tiersHtml + '</tr></table>' +
        '</div>' +
      '</div>' +

      '<div style="padding:20px 28px 26px;">' +
        '<div style="font-size:12px;line-height:1.6;color:' + faint + ';">' +
          'You’re getting this because you joined the ' + BRAND + ' waitlist. Reply and ask to be removed at any time — a person reads this inbox.' +
        '</div>' +
      '</div>' +

    '</div>' +
  '</div>';
}
