/**
 * Client-side authoring: English paragraph → validated IntentClauses.
 *
 * Primary path: POST the paragraph to /api/compile-intent, which uses the LLM
 * ONLY to segment and label into surface clauses. Fallback path (no API key on
 * the server, or the model is unreachable): a deterministic clause segmenter.
 *
 * Either way, the surface clauses go through the SAME deterministic validator
 * (validate.ts), which owns every safety-relevant decision. The LLM never
 * decides anything the validator does not re-check.
 */

import { validateSurface, type SurfaceClause, type ValidatorVerdict } from "./validate";

export type AuthorSource = "llm" | "fallback";
export interface AuthorResult extends ValidatorVerdict {
  source: AuthorSource;
  note?: string;
}

let statusCache: { configured: boolean; model?: string } | null = null;

export async function compilerStatus(force = false): Promise<{ configured: boolean; model?: string }> {
  if (statusCache && !force) return statusCache;
  try {
    const r = await fetch("/api/compile-intent", { method: "GET" });
    const j = (await r.json()) as { configured?: boolean; model?: string };
    statusCache = { configured: Boolean(j.configured), model: j.model };
  } catch {
    statusCache = { configured: false };
  }
  return statusCache;
}

export async function authorContract(intent: string): Promise<AuthorResult> {
  const text = intent.trim();
  if (!text) return { clauses: [], rejected: [], warnings: [], activationBlocked: false, invariants: [], groups: [], source: "fallback" };

  // Try the LLM segmenter.
  try {
    const r = await fetch("/api/compile-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: text }),
    });
    const j = (await r.json()) as { ok?: boolean; clauses?: SurfaceClause[]; reason?: string; message?: string };
    if (j.ok && Array.isArray(j.clauses) && j.clauses.length) {
      const verdict = validateSurface(j.clauses);
      return { ...verdict, source: "llm" };
    }
    // Not configured / model error → deterministic fallback, labelled honestly.
    const fb = validateSurface(segment(text));
    return { ...fb, source: "fallback", note: j.message || "Used the built-in segmenter." };
  } catch {
    const fb = validateSurface(segment(text));
    return { ...fb, source: "fallback", note: "Could not reach the compiler service; used the built-in segmenter." };
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic fallback segmenter.
 *
 * NOT the primary path and NOT a comprehensive NLP engine — it exists so the
 * product works with no API key. It splits the paragraph into clause-like
 * fragments and does a shallow labelling; anything it cannot confidently label
 * still flows to the validator, which rejects or flags it honestly rather than
 * guessing a decision.
 * ------------------------------------------------------------------ */

function segment(text: string): SurfaceClause[] {
  // Split on sentence and conjunction boundaries that usually separate clauses.
  const fragments = text
    .split(/(?:[.;\n]|\bbut\b|\bhowever\b|\band\b(?=[^,]*\b(?:can|cannot|must|may|require|block|allow|review)\b))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);

  const out: SurfaceClause[] = [];
  for (const frag of fragments) {
    const decision = detectDecision(frag);
    if (!decision) continue;                 // no permission stated → skip (validator would reject anyway)
    const action = detectAction(frag);
    out.push({
      text: frag,
      ...(action ? { action } : {}),
      resource: detectResource(frag),
      ...(detectDestination(frag) ? { destination: detectDestination(frag)! } : {}),
      ...(detectData(frag) ? { data: detectData(frag)! } : {}),
      ...(detectThreshold(frag) ? { threshold: detectThreshold(frag)! } : {}),
      decision,
    });
  }
  return out;
}

function detectDecision(f: string): string | undefined {
  const s = f.toLowerCase();
  if (/\b(never|block|deny|forbid|prevent|must not|cannot|can'?t|not allowed|disallow)\b/.test(s)) return "block";
  if (/\b(review|approv|sign.?off|escalate|permission required|require.*approval)\b/.test(s)) return "review";
  if (/\b(tokeni[sz]e|mask|redact|cap|limit to|only|read-only|force-with-lease)\b/.test(s)) return "constrain";
  if (/\b(allow|permit|may|can|able to|let)\b/.test(s)) return "allow";
  return undefined;
}

function detectAction(f: string): string | undefined {
  const s = f.toLowerCase();
  const verbs = ["read", "edit", "write", "modify", "delete", "remove", "run", "execute", "query", "select", "push", "merge", "call", "invoke", "use", "send", "share", "disclose", "transmit", "charge", "pay", "transact", "configure", "connect", "upload", "download", "create"];
  for (const v of verbs) if (new RegExp(`\\b${v}`).test(s)) return v;
  return undefined;
}

function detectResource(f: string): SurfaceClause["resource"] {
  const s = f.toLowerCase();
  const r: NonNullable<SurfaceClause["resource"]> = {};
  const paths = f.match(/[\w./*-]*\.\w+|[\w-]+\/[\w*/-]+/g)?.filter((p) => /[./]/.test(p)) ?? [];
  if (/\brepo|repositor/.test(s)) r.kind = "repo";
  else if (/\.env|\bfile\b/.test(s)) r.kind = "file";
  else if (/\bbranch|main\b/.test(s)) r.kind = "branch";
  else if (/\bsql|database|\btable|schema/.test(s)) r.kind = /statement|drop|truncate|schema op/.test(s) ? "sql" : "table";
  else if (/\bmcp|tool\b/.test(s)) r.kind = "mcp tool";
  else if (/\bapi|endpoint/.test(s)) r.kind = "api";
  else if (/\bpayment|transaction|charge/.test(s)) r.kind = "payment";
  else if (/\biam|role\b/.test(s)) r.kind = "iam role";
  if (paths.length) {
    if (/\bnot\b|\bcannot\b|\bexcept\b/.test(s)) r.excludePaths = paths;
    else r.paths = paths;
  }
  return r;
}

function detectDestination(f: string): SurfaceClause["destination"] | undefined {
  const s = f.toLowerCase();
  if (/\bexternal ai|ai service|chatgpt|claude|gemini|model provider|copilot\b/.test(s)) return { category: "external ai", trust: "external" };
  return undefined;
}

function detectData(f: string): SurfaceClause["data"] | undefined {
  const s = f.toLowerCase();
  const classes: string[] = [];
  if (/email/.test(s)) classes.push("EMAIL");
  if (/phone|mobile/.test(s)) classes.push("PHONE");
  if (/\bpii\b|personal/.test(s)) classes.push("PII");
  if (/secret|credential|api key|token/.test(s)) classes.push("SECRET");
  if (/card|credit/.test(s)) classes.push("CARD");
  return classes.length ? { classes } : undefined;
}

function detectThreshold(f: string): SurfaceClause["threshold"] | undefined {
  const m = f.match(/(over|above|under|below|more than|greater than|less than|>=?|<=?)\s*\$?\s*([\d,]+)/i);
  if (!m) return undefined;
  const op = /over|above|more|greater|>/.test(m[1].toLowerCase()) ? "over" : "under";
  const value = Number(m[2].replace(/,/g, ""));
  const unit = /\$/.test(f) || /usd|dollar/i.test(f) ? "USD" : undefined;
  return { field: "amount", op, value, ...(unit ? { unit } : {}) };
}
