/**
 * Gateway plane foundation (§6) — software-only.
 *
 * The network plane governs what leaves the device over HTTPS. The gateway
 * plane governs BROKERED calls an agent makes to APIs, databases, cloud control
 * planes, MCP tools and payment rails. This module is the foundation: it maps a
 * brokered call onto the SAME Intent IR / ToolCall the network plane uses, runs
 * it through the SAME policy-core engine (one matcher, never a second), and
 * implements the CONSTRAIN handlers that are pure software — SQL row caps and
 * statement blocks, MCP tool allow-lists, API endpoint/method limits, payment
 * amount caps. None of these needs a cloud or vendor credential.
 *
 * WHAT THIS IS NOT. It does not open a live socket to a production database or
 * a cloud provider — that requires real credentials and is an integration, not
 * a local capability (external blocker D). So the gateway plane is reported as
 * NOT deployed (no live brokered traffic yet); this foundation is what a broker
 * transport would call the day one is wired, and it is fully tested on its own.
 * Nothing here is allowed to claim enforcement of traffic it never sees.
 */

import { evaluate, applyProjectFilter } from "@wrapbox/policy-core";
import type { Rule, ToolCall } from "@wrapbox/policy-core";

export type BrokeredKind = "sql" | "api" | "mcp" | "iam" | "payment";

export interface BrokeredCall {
  kind: BrokeredKind;
  agent?: string;
  /** SQL text, for kind "sql". */
  statement?: string;
  /** REST endpoint path/host, for kind "api". */
  endpoint?: string;
  method?: string;
  /** MCP tool name + arguments, for kind "mcp". */
  tool?: string;
  args?: Record<string, unknown>;
  /** Cloud/IAM action, for kind "iam". */
  action?: string;
  /** Payment amount in minor units, for kind "payment". */
  amount?: number;
  currency?: string;
}

export interface GatewayVerdict {
  effect: "allow" | "constrain" | "block" | "review";
  reason: string;
  rule_id: string | null;
  /** For a constrain verdict that this module could apply, the rewritten call. */
  rewritten?: BrokeredCall;
}

/* ------------------------------------------------------------------ *
 * Brokered call → ToolCall. The field names match the gateway plane's
 * self-description so a rule authored against the Intent IR evaluates here
 * exactly as the compiler predicted.
 * ------------------------------------------------------------------ */

export function toToolCall(c: BrokeredCall): ToolCall {
  // The engine's readField() splits a field path on every dot, so a field named
  // "tool_input.sql.verb" resolves through nested objects — build them nested,
  // not as flat dotted keys.
  const ti: Record<string, unknown> = { agent: c.agent ?? "unknown" };
  if (c.kind === "sql") ti.sql = { statement: c.statement ?? "", verb: leadingVerb(c.statement ?? "") };
  if (c.kind === "api") ti.api = { endpoint: c.endpoint ?? "", method: (c.method ?? "GET").toUpperCase() };
  if (c.kind === "mcp") ti.mcp = { tool: c.tool ?? "", args: JSON.stringify(c.args ?? {}) };
  if (c.kind === "iam") ti.iam = { action: c.action ?? "" };
  if (c.kind === "payment") ti.payment = { amount: c.amount ?? 0, currency: c.currency ?? "" };
  return { tool_name: `gateway.${c.kind}`, tool_input: ti };
}

function leadingVerb(sql: string): string {
  // Strip every comment form (block, --, and MySQL #) and any leading parens or
  // whitespace, so a statement dressed up to hide its verb ("# noise\nDROP …",
  // "(SELECT …") still resolves to its real leading keyword. An unparseable
  // statement returns "" — callers fail closed on that.
  const s = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*(\n|$)/g, " ")
    .replace(/#[^\n]*(\n|$)/g, " ")
    .replace(/^[\s(]+/, "");
  const m = /^([A-Za-z]+)/.exec(s);
  return (m?.[1] ?? "").toLowerCase();
}

/* ------------------------------------------------------------------ *
 * The evaluator — one engine, shared with the network plane and the CP.
 * ------------------------------------------------------------------ */

export function decideGateway(c: BrokeredCall, rules: Rule[]): GatewayVerdict {
  const filtered = applyProjectFilter(rules as Array<Rule & { project_id?: string | null }>, undefined);
  const d = evaluate(toToolCall(c), filtered);
  const effect = d.effect === "allow" ? "allow" : d.effect === "review" ? "review" : d.effect === "constrain" ? "constrain" : "block";

  if (effect === "constrain") {
    // A gateway constraint must be EXECUTABLE, exactly like the network plane's
    // transform invariant: if we cannot apply it, we do not forward — we block.
    const applied = applyConstraint(c, d.constraint ?? null);
    if (!applied.ok) return { effect: "block", reason: `${d.reason} — ${applied.reason}`, rule_id: d.matched_rule_id ?? null };
    return { effect: "constrain", reason: d.reason, rule_id: d.matched_rule_id ?? null, rewritten: applied.call };
  }
  return { effect, reason: d.reason, rule_id: d.matched_rule_id ?? null };
}

/* ------------------------------------------------------------------ *
 * Constraint handlers — pure software, fail-closed.
 * ------------------------------------------------------------------ */

interface Constraintish { kind?: string; fields?: string[]; classes?: string[]; params?: Record<string, unknown>; }

type ApplyResult = { ok: true; call: BrokeredCall } | { ok: false; reason: string };

/** Which gateway handlers this runtime can actually execute today. */
export const GATEWAY_HANDLERS = [
  "sql.max_rows", "sql.blocked_statements", "mcp.allowed_tools", "api.allowed_endpoints",
  "http.allowed_methods", "payment.max_amount",
] as const;

// "Destructive" leading verbs — schema/data mutations that wipe or alter. DELETE
// is included: `DELETE FROM t` with no WHERE is a whole-table wipe, and a
// blocked_statements:["destructive"] must catch it.
const DESTRUCTIVE_SQL = new Set(["drop", "truncate", "alter", "grant", "revoke", "create", "delete"]);

// Statements that RETURN rows — the only ones a row cap is meaningful for.
const ROW_RETURNING = new Set(["select", "with", "table", "values"]);

/** Canonical param names come from the shared HANDLER_REGISTRY (schema.ts):
 *  sql.max_rows→limit, sql.blocked_statements→statements, mcp.allowed_tools→tools,
 *  api.allowed_endpoints→endpoints, http.allowed_methods→methods,
 *  payment.max_amount→amount. We read the canonical name first and accept the
 *  older aliases too, so a constraint authored through the product's shared
 *  model is understood here rather than silently no-op'd. */
const ALIASES: Record<string, string[]> = {
  statements: ["statements", "blocked_statements"],
  limit: ["limit", "max_rows"],
  tools: ["tools", "allowed_tools"],
  endpoints: ["endpoints", "allowed_endpoints"],
  methods: ["methods", "allowed_methods"],
  amount: ["amount", "max_amount"],
};
function pick(p: Record<string, unknown>, canonical: string): unknown {
  for (const k of ALIASES[canonical] ?? [canonical]) if (p[k] !== undefined) return p[k];
  return undefined;
}

export function applyConstraint(c: BrokeredCall, raw: unknown): ApplyResult {
  const con = (raw ?? {}) as Constraintish;
  // Merge params over the top-level object so either shape is read.
  const p: Record<string, unknown> = { ...(con as Record<string, unknown>), ...(con.params ?? {}) };

  if (c.kind === "sql") {
    const verb = leadingVerb(c.statement ?? "");
    // An unparseable statement type cannot be safely enforced → fail closed.
    if (!verb) return { ok: false, reason: "could not determine the SQL statement type — refusing to forward" };

    const blocked = asList(pick(p, "statements") ?? con.classes).map((b) => b.toLowerCase());
    const rowCap = num(pick(p, "limit"));
    // A SQL constraint that names NEITHER a block list NOR a row cap cannot
    // enforce anything — we do not understand it, so we fail closed.
    if (blocked.length === 0 && rowCap == null) {
      return { ok: false, reason: "SQL constraint names neither blocked statements nor a row limit — cannot enforce, failing closed" };
    }
    if (blocked.includes(verb) || (blocked.includes("destructive") && DESTRUCTIVE_SQL.has(verb))) {
      return { ok: false, reason: `SQL ${verb.toUpperCase()} is a blocked statement` };
    }
    // A DELETE/UPDATE with no WHERE is a full-table mutation — refuse it.
    if ((verb === "delete" || verb === "update") && !/\bwhere\b/i.test(c.statement ?? "")) {
      return { ok: false, reason: `${verb.toUpperCase()} without a WHERE clause affects the whole table` };
    }
    if (rowCap != null && ROW_RETURNING.has(verb)) {
      const rewritten = enforceLimit(c.statement ?? "", rowCap);
      if (rewritten == null) return { ok: false, reason: "could not apply a row limit to this SQL safely" };
      return { ok: true, call: { ...c, statement: rewritten } };
    }
    return { ok: true, call: c };
  }

  if (c.kind === "mcp") {
    const allowed = asList(pick(p, "tools") ?? con.fields);
    if (allowed.length === 0) return { ok: false, reason: "MCP constraint names no allowed tools — cannot enforce, failing closed" };
    if (!allowed.includes(c.tool ?? "")) return { ok: false, reason: `MCP tool ${c.tool} is not on the allow-list` };
    return { ok: true, call: c };
  }

  if (c.kind === "api") {
    const eps = asList(pick(p, "endpoints") ?? con.fields);
    const methods = asList(pick(p, "methods"));
    if (eps.length === 0 && methods.length === 0) return { ok: false, reason: "API constraint names no endpoints or methods — cannot enforce, failing closed" };
    if (eps.length && !eps.some((e) => (c.endpoint ?? "").startsWith(e))) return { ok: false, reason: `endpoint ${c.endpoint} is not allowed` };
    if (methods.length && !methods.map((m) => m.toUpperCase()).includes((c.method ?? "GET").toUpperCase())) return { ok: false, reason: `method ${c.method} is not allowed` };
    return { ok: true, call: c };
  }

  if (c.kind === "payment") {
    const cap = num(pick(p, "amount"));
    // A payment CONSTRAIN with no readable cap cannot be enforced → fail closed
    // rather than forward the payment uncapped.
    if (cap == null) return { ok: false, reason: "payment constraint names no amount cap — cannot enforce, failing closed" };
    if ((c.amount ?? 0) > cap) return { ok: false, reason: `payment ${c.amount} exceeds the cap of ${cap}` };
    return { ok: true, call: c };
  }

  // A handler we do not implement cannot be applied → fail closed.
  return { ok: false, reason: `no gateway handler for ${c.kind}` };
}

/** Ensure a row-returning statement carries an OUTER LIMIT no greater than n.
 *  Only a LIMIT at the END of the statement counts as the statement's own cap —
 *  a LIMIT inside a subquery does not bound the outer result, so we append one.
 *  Refuses (null) anything with multiple statements. */
export function enforceLimit(sql: string, n: number): string | null {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (/;/.test(trimmed)) return null; // multiple statements — do not guess
  const tail = /\blimit\s+(\d+)(\s+offset\s+\d+)?\s*$/i.exec(trimmed);
  if (tail) {
    const cur = Number(tail[1]);
    if (cur <= n) return sql;
    return trimmed.replace(/\blimit\s+\d+(\s+offset\s+\d+)?\s*$/i, `LIMIT ${n}${tail[2] ?? ""}`);
  }
  return `${trimmed} LIMIT ${n}`;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * Gateway plane self-description (§7).
 * ------------------------------------------------------------------ */

export function gatewayObserves(): string[] {
  return [
    "tool_input.agent",
    "tool_input.sql.statement", "tool_input.sql.verb",
    "tool_input.api.endpoint", "tool_input.api.method",
    "tool_input.mcp.tool", "tool_input.mcp.args",
    "tool_input.iam.action",
    "tool_input.payment.amount", "tool_input.payment.currency",
  ];
}
