/* Waitlist intake.
 *
 * Runs on Vercel as a Node serverless function. The Google Apps Script endpoint that owns the
 * sheet lives in WAITLIST_SHEET_URL and stays on the server: it is never sent to the browser,
 * never bundled, never logged. The browser only ever sees { ok, position, duplicate }.
 *
 * GET  → { configured }          status only (the landing page shows no counter — the count
 *                                 endpoint on the Apps Script side is left in place for any
 *                                 internal/admin use, just not surfaced here)
 * POST → { ok, position, duplicate }
 *
 * Storage and the confirmation email both belong to the Apps Script (scripts/waitlist-apps-script.gs):
 * it appends the row, de-duplicates by email and sends the welcome mail from the owner's own
 * Gmail. This function validates, forwards and normalises — it never invents a position, so a
 * signup that did not reach the sheet can never read as success.
 */

/** Deliberately permissive: one @, a dot in the domain, no spaces. Real validation is the confirmation mail. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Addresses nobody should be able to sign up as — these bounce and pollute the sheet. */
const BAD_DOMAINS = ["example.com", "test.com", "localhost"];

interface ScriptReply {
  ok?: boolean;
  position?: number;
  duplicate?: boolean;
  count?: number;
  error?: string;
}

async function callScript(url: string, payload: Record<string, unknown>, timeoutMs = 9000): Promise<ScriptReply> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      // Apps Script answers /exec with a 302 to a googleusercontent URL that carries the body.
      redirect: "follow",
    });
    if (!r.ok) return { ok: false, error: `sheet request failed (${r.status})` };
    const text = await r.text();
    try {
      return JSON.parse(text) as ScriptReply;
    } catch {
      return { ok: false, error: "sheet returned a non-JSON response" };
    }
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req: { method?: string; body?: unknown }, res: ResponseLike) {
  const url = process.env.WAITLIST_SHEET_URL;

  if (req.method === "GET") return res.status(200).json({ configured: !!url });

  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!url) return res.status(501).json({ error: "The waitlist is not connected yet.", configured: false });

  let body: { name?: string; email?: string; phone?: string; role?: string; company?: string; companyUrl?: string; message?: string } = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : ((req.body ?? {}) as typeof body);
  } catch {
    return res.status(400).json({ error: "bad request body" });
  }

  // Email is the one field actually enforced — everything else is deliberately
  // permissive (the form marks them required but never blocks on them), since
  // the confirmation mail has nowhere to go if this one is wrong.
  const email = (body.email ?? "").toString().trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address doesn't look right." });
  if (BAD_DOMAINS.includes(email.split("@")[1] ?? "")) return res.status(400).json({ error: "Please use a real work email." });

  const name = (body.name ?? "").toString().trim().slice(0, 120);
  const phone = (body.phone ?? "").toString().trim().slice(0, 40);
  const role = (body.role ?? "").toString().trim().slice(0, 120);
  const company = (body.company ?? "").toString().trim().slice(0, 120);
  const companyUrl = (body.companyUrl ?? "").toString().trim().slice(0, 300);
  const message = (body.message ?? "").toString().trim().slice(0, 1000);

  try {
    const out = await callScript(url, { action: "join", name, email, phone, role, company, companyUrl, message });
    if (!out.ok || typeof out.position !== "number") {
      return res.status(502).json({ error: out.error ? "The waitlist is having a moment. Try again shortly." : "Could not reach the waitlist." });
    }
    return res.status(200).json({ ok: true, position: out.position, duplicate: out.duplicate === true });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return res.status(502).json({ error: aborted ? "The waitlist timed out. Try again shortly." : "Could not reach the waitlist." });
  }
}

interface ResponseLike {
  status: (code: number) => { json: (body: unknown) => unknown };
}
