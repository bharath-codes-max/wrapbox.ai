// The deterministic policy engine. No model in the loop: the same action and
// the same contract always produce the same decision, with a trace of why.

import type { CategoryId, Decision } from "../data/agents";
import { evalTier, fmtValue, type Cond, type Rule } from "../data/contract";

export type Env = "production" | "staging" | "development";

/** Facts about the attempt: provenance, delegation, CI, counts, hashes, permit state.
 *  A key that is absent is unverifiable — rules that require it fail closed. */
export type Ctx = Record<string, string | number | boolean | string[] | undefined>;

export interface Act {
  effect: string;
  ctx?: Ctx;
  path?: string;
  command?: string;
  branch?: string;
  env?: Env;
  amount?: number;
  amountUsd?: number;
  columns?: string[];
  destination?: string;
  credentials?: boolean;
  budget?: number;
  sql?: string;
}

export interface TraceRow {
  rule: Rule;
  matched: boolean;
  why: string;
  decision?: Decision;
}

export interface Verdict {
  decision: Decision;
  observed?: Decision;
  rule: string;
  title: string;
  reason: string;
  trace: TraceRow[];
  approvers?: string;
  quorum?: number;
  constrain?: Rule["constrain"];
}

const RANK: Record<Decision, number> = { ALLOW: 1, CONSTRAIN: 2, REVIEW: 3, BLOCK: 4 };

const RE_CACHE = new Map<string, RegExp>();
function globToRe(pattern: string, kind: "path" | "text") {
  const key = kind + "\0" + pattern;
  const hit = RE_CACHE.get(key);
  if (hit) return hit;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (kind === "path" && pattern[i + 1] === "*") {
        re += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += pattern[i + 2] === "/" ? 2 : 1;
      } else re += kind === "path" ? "[^/]*" : ".*";
    } else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const out = new RegExp(`^${re}$`, kind === "text" ? "i" : "");
  RE_CACHE.set(key, out);
  return out;
}
export const globMatch = (pattern: string, value: string, kind: "path" | "text" = "text") => {
  const v = kind === "path" && !value.startsWith("/") && pattern.startsWith("**/") ? "/" + value : value;
  return globToRe(pattern, kind).test(kind === "text" ? v.replace(/\s+/g, " ").trim() : v);
};

/** One condition of a rule, checked against an action. */
export interface Check {
  /** The `when:` field this check came from. */
  field: string;
  ok: boolean;
  /** Human sentence: what was required and what the action actually carried. */
  detail: string;
}

/* Every condition the engine knows how to check, in the order it checks them. The tester and the
   runtime evaluator both go through here, so a rule can never be explained one way and enforced
   another. */
export function checkRule(r: Rule, a: Act, category: CategoryId): { ok: boolean; checks: Check[]; why: string } {
  const w = r.when;
  const checks: Check[] = [];

  const effectOk = w.effect.some((e) => e === a.effect || (e.endsWith(".*") && a.effect.startsWith(e.slice(0, -1))));
  checks.push({ field: "effect", ok: effectOk, detail: effectOk ? `effect: ${a.effect}` : `effect: ${a.effect} is not ${w.effect.join(" or ")}` });

  if (w.subject) {
    const ok = w.subject.includes(category);
    checks.push({ field: "agents", ok, detail: ok ? `agent category: ${category}` : `agent category: ${category} is not ${w.subject.join("/")}` });
  }
  if (w.env) {
    const env = a.env ?? "production";
    const ok = w.env.includes(env);
    checks.push({ field: "env", ok, detail: ok ? `environment: ${env}` : `environment: ${env} is not ${w.env.join("/")}` });
  }
  if (w.path) {
    const ok = !!a.path && w.path.some((p) => globMatch(p, a.path!, "path"));
    checks.push({ field: "path", ok, detail: ok ? `path ${a.path} matches ${w.path.join(", ")}` : `path ${a.path ?? "—"} does not match ${w.path.join(", ")}` });
  }
  if (w.command) {
    const ok = !!a.command && w.command.some((p) => globMatch(p, a.command!));
    checks.push({ field: "command", ok, detail: ok ? `command matches ${w.command.join(", ")}` : `command ${a.command ?? "—"} does not match ${w.command.join(", ")}` });
  }
  if (w.branch) {
    const ok = !!a.branch && w.branch.some((p) => globMatch(p, a.branch!));
    checks.push({ field: "branch", ok, detail: ok ? `branch ${a.branch} matches ${w.branch.join(", ")}` : `branch ${a.branch ?? "—"} is not ${w.branch.join(", ")}` });
  }
  if (w.columns) {
    const hit = (a.columns ?? []).filter((c) => w.columns!.includes(c.toLowerCase()));
    checks.push({ field: "columns", ok: !!hit.length, detail: hit.length ? `touches ${hit.join(", ")}` : `no ${w.columns.join("/")} column touched` });
  }
  if (w.destinationNotIn) {
    const allowed = !!a.destination && w.destinationNotIn.some((d) => a.destination === d || a.destination!.endsWith("." + d));
    const ok = !!a.destination && !allowed;
    checks.push({ field: "destination", ok, detail: !a.destination ? "no destination in the action" : allowed ? `${a.destination} is on the allowlist` : `${a.destination} is not on the allowlist` });
  }
  if (w.credentials) {
    const ok = !!a.credentials;
    checks.push({ field: "credentials", ok, detail: ok ? "carries credentials" : "no credentials in the payload" });
  }
  for (const c of w.requires ?? []) {
    const r2 = evalCond(c, a.ctx);
    checks.push({ field: `requires ${c.key}`, ok: r2.ok, detail: r2.detail });
  }
  const bad = forbidden(r, a);
  if (bad) checks.push({ field: "forbid", ok: false, detail: `forbidden content: ${bad}` });

  const failed = checks.find((c) => !c.ok);
  return { ok: !failed, checks, why: failed ? failed.detail : "matched" };
}

const label = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

/** Evaluate one context condition. Missing context is never treated as satisfied. */
export function evalCond(c: Cond, ctx: Ctx = {}): { ok: boolean; detail: string; missing: boolean } {
  const got = ctx[c.key];
  if (got === undefined || got === "" || (Array.isArray(got) && !got.length))
    return { ok: false, missing: true, detail: `${c.key}: not proven by the action` };
  const num = typeof got === "number" ? got : Number(got);
  const want = c.value;
  let ok = false;
  switch (c.op) {
    case "is":
      ok = String(got) === String(want);
      break;
    case "not":
      ok = String(got) !== String(want);
      break;
    case "gte":
      ok = num >= Number(want);
      break;
    case "lte":
      ok = num <= Number(want);
      break;
    case "gt":
      ok = num > Number(want);
      break;
    case "lt":
      ok = num < Number(want);
      break;
    case "in": {
      const set = (Array.isArray(want) ? want : [String(want)]).map(String);
      const mine = Array.isArray(got) ? got.map(String) : [String(got)];
      ok = mine.some((x) => set.includes(x));
      break;
    }
    case "not_in": {
      const set = (Array.isArray(want) ? want : [String(want)]).map(String);
      const mine = Array.isArray(got) ? got.map(String) : [String(got)];
      ok = !mine.some((x) => set.includes(x));
      break;
    }
  }
  const verb = { is: "=", not: "≠", gte: "≥", lte: "≤", gt: ">", lt: "<", in: "in", not_in: "not in" }[c.op];
  return { ok, missing: false, detail: `${c.key} ${verb} ${label(want)} (action: ${label(got)})` };
}

/** Content the rule forbids outright — DROP, TRUNCATE, disabling row-level security. */
export function forbidden(r: Rule, a: Act): string | null {
  if (!r.forbid?.length) return null;
  const hay = `${a.sql ?? ""} ${a.command ?? ""}`.toLowerCase();
  for (const f of r.forbid) if (hay.includes(f.toLowerCase())) return f;
  return null;
}

function matchRule(r: Rule, a: Act, category: CategoryId): { ok: boolean; why: string } {
  const { ok, why } = checkRule(r, a, category);
  return { ok, why };
}

/** A permit must still be valid at the moment of execution: not expired, not spent, still bound. */
export function permitCheck(r: Rule, a: Act): { ok: boolean; detail: string } | null {
  const p = r.permit;
  if (!p) return null;
  const ctx = a.ctx ?? {};
  const age = ctx["permit.age_seconds"];
  if (age !== undefined && Number(age) > p.ttlSeconds) return { ok: false, detail: `permit expired — ${Number(age)}s old, valid for ${p.ttlSeconds}s` };
  if (p.singleUse && ctx["permit.consumed"] === true) return { ok: false, detail: "permit already consumed — single use" };
  const changed = ctx["permit.bindings_changed"];
  if (changed !== undefined && changed !== false && String(changed) !== "none") return { ok: false, detail: `binding changed since approval: ${label(changed)}` };
  if (ctx["approval.revoked"] === true) return { ok: false, detail: "an approval was revoked" };
  if (ctx["policy.version_changed"] === true) return { ok: false, detail: "policy version changed since approval" };
  const bound = p.bind ?? [];
  const unproven = bound.filter((b) => ctx[b] === undefined);
  if (unproven.length) return { ok: false, detail: `permit cannot be bound to: ${unproven.join(", ")}` };
  return { ok: true, detail: `permit valid · ${p.ttlSeconds}s${p.singleUse ? " · single use" : ""}${bound.length ? ` · bound to ${bound.length} attributes` : ""}` };
}

/** The strongest escalation whose context holds. */
function escalate(r: Rule, a: Act): { d: Decision; approvers?: string; quorum?: number; why: string } | null {
  let best: { d: Decision; approvers?: string; quorum?: number; why: string } | null = null;
  for (const e of r.escalations ?? []) {
    if (!e.when.every((c) => evalCond(c, a.ctx).ok)) continue;
    const cand = { d: e.decision, approvers: e.approvers, quorum: e.quorum, why: e.why ?? e.when.map((c) => c.key).join(" + ") };
    const stricter =
      !best ||
      RANK[cand.d] > RANK[best.d] ||
      (RANK[cand.d] === RANK[best.d] && ((cand.quorum ?? 1) > (best.quorum ?? 1) || (cand.approvers?.split(",").length ?? 0) > (best.approvers?.split(",").length ?? 0)));
    if (stricter) best = cand;
  }
  return best;
}

function decide(r: Rule, a: Act): { d: Decision; why: string; approvers?: string; quorum?: number } {
  // Forbidden content and unverifiable context are refusals, never fall-throughs.
  const bad = forbidden(r, a);
  if (bad) return { d: "BLOCK", why: `forbidden content: ${bad}` };
  const unmet = (r.when.requires ?? []).map((c) => ({ c, r: evalCond(c, a.ctx) })).filter((x) => !x.r.ok);
  if (unmet.length) {
    const missing = unmet.filter((x) => x.r.missing);
    return {
      d: "BLOCK",
      why: missing.length ? `context not proven: ${missing.map((x) => x.c.key).join(", ")}` : `condition not met: ${unmet[0].r.detail}`,
    };
  }
  const pc = permitCheck(r, a);
  if (pc && !pc.ok) return { d: "BLOCK", why: pc.detail };
  const esc = escalate(r, a);
  if (r.attenuate) {
    const amt = a.amount ?? 0;
    const budget = a.budget ?? 0;
    return amt > budget
      ? { d: "BLOCK", why: `$${amt.toLocaleString("en-US")} exceeds the $${budget.toLocaleString("en-US")} its parent delegated` }
      : { d: "ALLOW", why: `within the delegated $${budget.toLocaleString("en-US")} budget` };
  }
  if (r.tiers) {
    const v = r.unit === "USD" ? (a.amountUsd ?? a.amount ?? 0) : (a.amount ?? 0);
    const t = evalTier(r, v);
    const tier = r.tiers[t.tier];
    const prev = r.tiers[t.tier - 1];
    const band = tier?.max === null ? `above ${fmtValue(prev?.max ?? 0, r.unit)}` : `≤ ${fmtValue(tier?.max ?? 0, r.unit)}`;
    const base = { d: t.decision, why: `${fmtValue(v, r.unit)} · tier ${band}`, approvers: t.approvers, quorum: t.quorum };
    return esc && RANK[esc.d] > RANK[base.d] ? { d: esc.d, why: esc.why, approvers: esc.approvers ?? base.approvers, quorum: esc.quorum ?? base.quorum } : base;
  }
  const base = { d: r.decision ?? "ALLOW", why: r.title, approvers: r.approvers, quorum: r.quorum };
  return esc && RANK[esc.d] > RANK[base.d] ? { d: esc.d, why: esc.why, approvers: esc.approvers ?? base.approvers, quorum: esc.quorum ?? base.quorum } : base;
}

export function evaluate(a: Act, rules: Rule[], category: CategoryId, opts: { kill?: boolean } = {}): Verdict {
  if (opts.kill) return { decision: "BLOCK", rule: "kill-switch", title: "Org kill switch", reason: "org-wide kill switch engaged", trace: [] };
  const trace: TraceRow[] = rules.map((r) => {
    const { checks, ok, why } = checkRule(r, a, category);
    if (!ok) {
      // Which condition failed decides what that means: the rule not applying (fall through) versus
      // the rule applying and refusing (context it demanded is unproven, or content it forbids).
      const shape = checks.filter((c) => !c.field.startsWith("requires") && c.field !== "forbid");
      const appliesHere = shape.every((c) => c.ok);
      if (appliesHere) {
        const d = decide(r, a);
        return { rule: r, matched: true, why: d.why, decision: d.d };
      }
      return { rule: r, matched: false, why };
    }
    const d = decide(r, a);
    return { rule: r, matched: true, why: d.why, decision: d.d };
  });
  const hits = trace.filter((t) => t.matched);
  const enforced = hits.filter((t) => t.rule.mode !== "observe").sort((x, y) => RANK[y.decision!] - RANK[x.decision!]);
  const observing = hits.filter((t) => t.rule.mode === "observe").sort((x, y) => RANK[y.decision!] - RANK[x.decision!]);
  const win = enforced[0];
  const base: Verdict = win
    ? (() => {
        const d = decide(win.rule, a);
        // A refusal explains itself: say which condition failed, not just the rule's name.
        const refused = d.d === "BLOCK" && d.why !== win.rule.title;
        const explains = win.rule.tiers || win.rule.attenuate || win.rule.escalations || win.rule.permit || refused;
        return { decision: win.decision!, rule: win.rule.id, title: win.rule.title, reason: explains ? d.why : win.rule.title, trace, approvers: d.approvers, quorum: d.quorum, constrain: win.rule.constrain };
      })()
    : observing[0]
      ? { decision: "ALLOW", rule: observing[0].rule.id, title: observing[0].rule.title, reason: `observe mode — would ${observing[0].decision}: ${observing[0].why}`, trace }
      : { decision: "ALLOW", rule: "default", title: "Default", reason: "no rule matched · default ALLOW", trace };
  const obs = observing[0];
  if (obs && RANK[obs.decision!] > RANK[base.decision]) base.observed = obs.decision;
  return base;
}

/* ---------- Safe rewrites for CONSTRAIN ---------- */
const PII = ["email", "phone", "pan", "aadhaar"];
export function rewrite(a: Act, how: Rule["constrain"]): string | undefined {
  if (how === "force-with-lease" && a.command) return a.command.replace(/\s--force(?!-)(\s|$)/, " --force-with-lease$1").replace(/\s-f(\s|$)/, " --force-with-lease$1");
  if (how === "mask" && a.sql) {
    let s = a.sql;
    for (const c of PII) s = s.replace(new RegExp(`\\b${c}\\b(?![^(]*\\))`, "gi"), `wbx_mask(${c}) AS ${c}`);
    return /\blimit\b/i.test(s) ? s : s.replace(/;?\s*$/, " LIMIT 500");
  }
  return undefined;
}

/* ---------- Classify free-form agent actions ---------- */
const SECRETISH = /(\.env[\w.-]*|\.pem\b|id_rsa|\.aws\/credentials|secrets?\.(json|ya?ml))/i;

export function classify(text: string, env: Env): { act: Act; label: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const prodNs = /\s-n\s?prod\b|--namespace[= ]prod\b|\bprod(uction)?\b/.test(t);
  const e: Env = prodNs && /kubectl|helm|terraform/.test(t) ? "production" : env;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:read|cat|less|head|tail|more|bat|open|view)\s+(\S+)/i))) return { act: { effect: "filesystem.read", path: abs(m[1]), env: e }, label: "file read" };
  if ((m = t.match(/open\(\s*['"]([^'"]+)['"]/))) return { act: { effect: "filesystem.read", path: abs(m[1]), env: e, command: t }, label: "file read via process" };
  if (/^git push\b/i.test(t)) {
    const toks = t.split(" ").slice(2).filter((x) => !x.startsWith("-"));
    const branch = (toks[1] ?? "main").replace(/^HEAD:/, "").replace(/^refs\/heads\//, "");
    return { act: { effect: "git.push", branch, command: t, env: e }, label: "git push" };
  }
  if ((m = t.match(/^(?:gh pr merge|git merge)\b.*?(?:--base\s+|into\s+)?(\S+)?$/i))) return { act: { effect: "git.merge", branch: /main|master/.test(t) ? "main" : (m[1] ?? "main"), command: t, env: e }, label: "merge" };
  if ((m = t.match(/\b(https?:\/\/[^\s'"]+)/)) && /^(curl|wget|http|fetch|nc)\b/i.test(t)) {
    let host = "";
    try {
      host = new URL(m[1]).hostname;
    } catch {
      host = m[1];
    }
    return { act: { effect: "network.egress", destination: host, credentials: SECRETISH.test(t) || /authorization|token|secret|password/i.test(t), command: t, env: e }, label: "network egress" };
  }
  const sql = t.replace(/^(psql|mysql)\b.*?-c\s+/i, "").replace(/^["']|["']$/g, "");
  if (/^\s*(select)\b/i.test(sql)) {
    const cols = (sql.match(/select\s+(.*?)\s+from/i)?.[1] ?? "").split(",").map((c) => c.trim().split(/\s+/)[0].replace(/.*\./, "").toLowerCase());
    return { act: { effect: "database.read", columns: cols, sql, env: e }, label: "SQL read" };
  }
  if (/^\s*(delete|update|insert|drop|truncate)\b/i.test(sql)) return { act: { effect: "database.write", sql, env: e }, label: "SQL write" };
  if (/^\s*(alter|create)\b/i.test(sql)) return { act: { effect: "database.migrate", sql, env: e }, label: "schema change" };
  if ((m = t.match(/^(?:rm|mv|cp|tee|truncate)\s+(?:-\S+\s+)*(\S+)/))) return { act: { effect: "filesystem.write", path: abs(m[1]), command: t, env: e }, label: "file write" };
  return { act: { effect: "shell.exec", command: t, env: e }, label: "command" };
}
const abs = (p: string) => (p.startsWith("/") || p.startsWith("~") ? p : `/wrapbox/web/${p.replace(/^\.\//, "")}`);

/** A readable one-liner for an action. */
export function describe(a: Act): string {
  if (a.command) return a.command;
  if (a.sql) return a.sql;
  if (a.path) return `${a.effect} ${a.path}`;
  if (a.amountUsd !== undefined) return `${a.effect} $${a.amountUsd.toLocaleString("en-US")}`;
  if (a.amount !== undefined) return `${a.effect} ${a.amount}`;
  return a.effect;
}
