/* Waitlist intake.
 *
 * Runs on Vercel as a Node serverless function. The Google Apps Script endpoint that owns the
 * sheet lives in WAITLIST_SHEET_URL and stays on the server: it is never sent to the browser,
 * never bundled, never logged. The browser only ever sees { ok, position, duplicate }.
 *
 * GET  → { configured, count }   status + the real number on the list (no secret)
 * POST → { ok, position, duplicate }
 *
 * Storage and the confirmation email both belong to the Apps Script (scripts/waitlist-apps-script.gs):
 * it appends the row, de-duplicates by email and sends the welcome mail from the owner's own
 * Gmail. This function validates, forwards and normalises — it never invents a position or a
 * count, so a signup that did not reach the sheet can never read as success.
 */

const ROLES = ["security", "platform", "engineering-leadership", "other"] as const;
type Role = (typeof ROLES)[number];

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

  if (req.method === "GET") {
    if (!url) return res.status(200).json({ configured: false, count: null });
    const out = await callScript(url, { action: "count" }, 4000).catch(() => ({ ok: false }) as ScriptReply);
    // A count we could not read is reported as unknown, never as zero.
    return res.status(200).json({ configured: true, count: typeof out.count === "number" ? out.count : null });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!url) return res.status(501).json({ error: "The waitlist is not connected yet.", configured: false });

  let body: { email?: string; role?: string; company?: string } = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : ((req.body ?? {}) as typeof body);
  } catch {
    return res.status(400).json({ error: "bad request body" });
  }

  const email = (body.email ?? "").toString().trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address doesn't look right." });
  if (BAD_DOMAINS.includes(email.split("@")[1] ?? "")) return res.status(400).json({ error: "Please use a real work email." });

  const roleRaw = (body.role ?? "").toString().trim().toLowerCase();
  const role: Role = (ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as Role) : "other";
  const company = (body.company ?? "").toString().trim().slice(0, 120);

  try {
    const out = await callScript(url, { action: "join", email, role, company });
    if (!out.ok || typeof out.position !== "number") {
      return res.status(502).json({ error: out.error ? "The waitlist is having a moment. Try again shortly." : "Could not reach the waitlist." });
    }
    return res.status(200).json({ ok: true, position: out.position, duplicate: out.duplicate === true, count: typeof out.count === "number" ? out.count : null });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return res.status(502).json({ error: aborted ? "The waitlist timed out. Try again shortly." : "Could not reach the waitlist." });
  }
}

interface ResponseLike {
  status: (code: number) => { json: (body: unknown) => unknown };
}
