/**
 * Compilation — IntentClause → the runnable artifacts the runtime consumes.
 *
 * The runtime only ever pulls flat policy-core Rules; it never sees a clause.
 * So a contract's clauses are compiled down to Rules for the network plane,
 * and only the clauses that are `enforced` or `degraded` today produce a live
 * Rule. `understood_only` and `pending` clauses compile to NOTHING runnable —
 * they are retained in the contract for the day their plane ships, but they
 * must never emit a predicate that would silently allow or block traffic.
 *
 * This is also the backward-compatibility bridge: a legacy v1 rule
 * ({effect, condition, constraint:{kind,fields}}) is exactly the
 * any/any/any, network-bound, data.transform clause.
 */

import {
  type IntentClause, type Predicate, type CoreOp, type Op, type Decision,
  type ConstraintSpec, handlerDef,
} from "./schema";
import { networkPredicate, isCatchAll, buildNetworkPredicate } from "./resolve";
import { dataTypes, handlerFromLegacyMode, TRANSFORM_HANDLERS, registryPins } from "@wrapbox/registry";

/* ------------------------------------------------------------------ *
 * The wire shapes the Control Plane stores / the daemon pulls.
 * ------------------------------------------------------------------ */

export type CpEffect = "allow" | "constrain" | "block" | "review";

/** A policy-core condition atom as stored in condition_json. */
export interface WireCondition { field: string; op: CoreOp; value: string; }

/** The wire constraint: v1 `kind` for old runtimes, v2 handler/params for the registry-driven transform. */
export interface WireConstraint {
  kind: "reversible_tokenize" | "redact";
  fields?: string[];
  /** Registry ids (or legacy names) of the classes to protect. */
  classes?: string[];
  handler?: keyof typeof TRANSFORM_HANDLERS;
  params?: Record<string, unknown>;
}

/** Provenance the control plane stores and the daemon echoes into evidence. */
export interface RuleMeta {
  clause_id: string;
  contract_id?: string;
  ir_schema: string;
  kind: "clause" | "carrier";
  coverage: "enforced" | "degraded" | "understood_only" | "pending";
  pins: ReturnType<typeof registryPins>;
}

/** A compiled, runnable rule — exactly what POST /v1/rules accepts. */
export interface CompiledRule {
  name: string;
  effect: CpEffect;
  priority: number;
  condition: WireCondition | WireCondition[] | null;
  constraint?: WireConstraint | null;
  /** An honest coverage note for a DEGRADED clause — the bypass it cannot see.
   *  Stored as the rule description and surfaced by the runtime in Evidence. */
  description?: string;
  /** Provenance: which clause produced this rule. Not enforced, for audit. */
  clause_id: string;
  meta: RuleMeta;
}

export type CompileOutcome =
  | { runnable: true; rule: CompiledRule }
  | { runnable: false; reason: string };

/* ------------------------------------------------------------------ *
 * Op lowering — the canonical superset LOWERS to a CoreOp; meaning preserved.
 * ------------------------------------------------------------------ */

function lowerPredicate(p: Predicate): WireCondition {
  const val = p.value;
  switch (p.op) {
    case "in": {
      // "in [a,b,c]" → a regex alternation; same meaning, network-runnable.
      const alts = (Array.isArray(val) ? val : [val]).map((v) => escapeRe(String(v)));
      return { field: p.field, op: "regex", value: `^(${alts.join("|")})$` };
    }
    case "not_in": {
      const alts = (Array.isArray(val) ? val : [val]).map((v) => escapeRe(String(v)));
      // not_in has no single CoreOp; express as a negative-lookahead regex.
      return { field: p.field, op: "regex", value: `^(?!(${alts.join("|")})$).*$` };
    }
    case "glob":
      return { field: p.field, op: "regex", value: globToRe(String(val)) };
    default:
      return { field: p.field, op: p.op as CoreOp, value: String(Array.isArray(val) ? val.join(",") : val) };
  }
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function globToRe(g: string): string {
  return "^" + g.split("").map((ch) => ch === "*" ? ".*" : ch === "?" ? "." : escapeRe(ch)).join("") + "$";
}

/* ------------------------------------------------------------------ *
 * Constraint lowering — only handlers the NETWORK plane can execute today
 * become a runnable WireConstraint. Others are reported unrunnable so the
 * clause is honestly not-enforced rather than silently allowed.
 * ------------------------------------------------------------------ */

function lowerConstraint(spec: ConstraintSpec | undefined): { constraint: WireConstraint | null; ok: boolean; why?: string } {
  const dt = spec?.handlers.find((h) => h.handler === "data.transform");
  if (!dt) {
    // The clause constrains, but with a handler the network plane can't run
    // (sql.max_rows, payment.max_amount, mcp.*). Not runnable on this plane.
    const named = spec?.handlers.map((h) => h.handler).join(", ") || "none";
    return { constraint: null, ok: false, why: `network plane cannot execute constraint handler(s): ${named}` };
  }
  const handler: keyof typeof TRANSFORM_HANDLERS = typeof dt.params.handler === "string" && Object.hasOwn(TRANSFORM_HANDLERS, dt.params.handler)
    ? (dt.params.handler as keyof typeof TRANSFORM_HANDLERS) : handlerFromLegacyMode(dt.params.mode);
  const kind: WireConstraint["kind"] = TRANSFORM_HANDLERS[handler].legacyKind ?? (handler === "REVERSIBLE_TOKENIZE" ? "reversible_tokenize" : "redact");
  const fields = Array.isArray(dt.params.fields) ? (dt.params.fields as unknown[]).map(String) : undefined;
  const reg = dataTypes();
  // Classes go on the wire as registry ids; a phrase is resolved, an id kept.
  const rawClasses = Array.isArray(dt.params.classes) ? (dt.params.classes as unknown[]).map(String) : [];
  const classes = rawClasses.map((c) => reg.resolve(c)?.id ?? c);
  // Detectable ≠ transformable: drop types the registry declares unsafe for this
  // handler; if nothing safe remains (and no fields), the rule fails closed.
  const safe = classes.filter((c) => reg.transformSupport(c, handler) === "supported" || c.startsWith("CUSTOM."));
  const params = dt.params.params && typeof dt.params.params === "object" ? (dt.params.params as Record<string, unknown>) : undefined;
  if (!fields?.length && !safe.length && handler !== "LIMIT") {
    return { constraint: null, ok: false, why: classes.length ? `${handler} is not safe for ${classes.join(", ")} (never transformed and forwarded)` : "data.transform names no fields or classes" };
  }
  return { constraint: { kind, handler, ...(fields?.length ? { fields } : {}), ...(safe.length ? { classes: safe } : {}), ...(params ? { params } : {}) }, ok: true };
}

/* ------------------------------------------------------------------ *
 * compileToRule — the single clause → Rule step.
 * ------------------------------------------------------------------ */

/**
 * Compile ONE clause for the network plane. Only `enforced`/`degraded` clauses
 * become a runnable rule; everything else returns runnable:false with an honest
 * reason (which the UI shows, and which guarantees nothing unenforced leaks a
 * predicate into the daemon).
 */
export function compileToRule(clause: IntentClause): CompileOutcome {
  const b = clause.binding;
  if (b.status !== "enforced" && b.status !== "degraded") {
    return { runnable: false, reason: b.rationale };
  }
  if (b.plane !== "network") {
    return { runnable: false, reason: `bound to the ${b.plane} plane, which the daemon does not pull rules for yet` };
  }

  // The binding IS the compiled predicate. resolveBinding already built it
  // from the registries at validation time and filtered it to fields the
  // runtime actually observes. Re-deriving here from mutable module state
  // (group definitions, registry) is how validate and compile could disagree —
  // the UI would show one predicate and the daemon would run another. Use the
  // binding's predicate; fall back to a fresh build only if none was stored.
  const pred = (b.match && (Array.isArray(b.match) ? b.match.length : 1)) ? (Array.isArray(b.match) ? b.match : [b.match]) : networkPredicate(clause);
  if (!pred || !pred.length) {
    // A match-everything rule is legal for exactly ONE clause: the genuine
    // catch-all (any subject, any action, any resource, no facets). Any OTHER
    // clause whose predicate came out empty is a clause whose scope could not
    // be expressed — a stated destination that did not resolve, a class the
    // runtime cannot see. Compiling that as a null condition would widen a
    // scoped permission to everything, silently. So it is refused, whatever
    // the reason the predicate is empty. The catch-all is recognised by its
    // SHAPE, never by an empty predicate.
    if (isCatchAll(clause) && b.effectiveDecision === "ALLOW") {
      return { runnable: true, rule: { name: ruleName(clause), effect: "allow", priority: clause.priority, condition: null, clause_id: clause.id, meta: metaFor(clause, "clause") } };
    }
    return { runnable: false, reason: "this clause names a scope (destination, data, or resource) that produced no network-observable predicate — refusing to compile it as match-everything" };
  }

  // The honest effective decision (never the aspirational declared one).
  const eff = b.effectiveDecision;

  let constraint: WireConstraint | null = null;
  if (eff === "CONSTRAIN") {
    const low = lowerConstraint(clause.constraint);
    if (!low.ok) {
      // A CONSTRAIN we cannot actually run must fall closed to BLOCK, never
      // forward intact. (This mirrors the runtime's own fail-closed rule.)
      return { runnable: true, rule: mkRule(clause, "block", pred, null, `${ruleName(clause)} — ${low.why}; blocked rather than forwarded unmasked`) };
    }
    constraint = low.constraint;
  }

  return { runnable: true, rule: mkRule(clause, decisionToEffect(eff), pred, constraint) };
}

function mkRule(clause: IntentClause, effect: CpEffect, pred: Predicate[], constraint: WireConstraint | null, nameOverride?: string): CompiledRule {
  const cond = pred.map(lowerPredicate);
  const gap = clause.binding.status === "degraded" ? clause.binding.coverageGap : undefined;
  return {
    name: nameOverride ?? ruleName(clause),
    effect,
    priority: clause.priority,
    condition: cond.length === 1 ? cond[0] : cond,
    ...(constraint ? { constraint } : {}),
    ...(gap ? { description: `DEGRADED — ${gap}` } : {}),
    clause_id: clause.id,
    meta: metaFor(clause, "clause"),
  };
}

function metaFor(clause: IntentClause, kind: RuleMeta["kind"]): RuleMeta {
  return { clause_id: clause.id, ir_schema: "1.0.0", kind, coverage: clause.binding.status, pins: registryPins() };
}

/**
 * A CARRIER rule stands in for a protection the runtime cannot enforce as
 * written, when the admin chose `block` or `review` for that case: it applies
 * the chosen decision to the likeliest carriers of the protected data —
 * uploads and uninspectable bodies — within the clause's destination scope.
 * Never emitted for hold_activation (the contract is held) or accept_risk
 * (the acceptance is recorded instead).
 */
export function carrierRule(clause: IntentClause): CompiledRule | null {
  if (clause.decision === "ALLOW") return null;
  const st = clause.binding.status;
  if (st === "enforced" || st === "degraded") return null;
  const how = clause.onUnsupported;
  if (how !== "block" && how !== "review") return null;
  const build = buildNetworkPredicate(clause);
  const destPreds = (build.pred ?? []).filter((p) => p.field === "tool_input.host" || p.field === "tool_input.destination_class").map(lowerPredicate);
  const cond: WireCondition[] = [...destPreds, { field: "tool_input.carrier", op: "any_of", value: "upload|uninspectable" }];
  return {
    name: `${ruleName(clause)} — carrier rule (${clause.binding.rationale.slice(0, 100)})`,
    effect: how, priority: clause.priority, condition: cond,
    description: `UNENFORCEABLE AS WRITTEN — ${clause.binding.rationale}`,
    clause_id: clause.id, meta: metaFor(clause, "carrier"),
  };
}

function decisionToEffect(d: Decision): CpEffect {
  return d === "ALLOW" ? "allow" : d === "CONSTRAIN" ? "constrain" : d === "REVIEW" ? "review" : "block";
}

function ruleName(clause: IntentClause): string {
  if (clause.source?.text) return clause.source.text.slice(0, 80);
  const verb = clause.action.verbs?.[0] ?? "act on";
  const res = clause.resource.ref?.[0] ?? clause.resource.type ?? "resource";
  return `${verb} ${res}`.slice(0, 80);
}

/**
 * Compile a whole contract to the runnable rule set for the network daemon.
 * Non-runnable clauses are reported separately so the UI can show exactly what
 * is and is not enforced today — never hidden.
 */
export function compileContract(clauses: IntentClause[]): {
  rules: CompiledRule[];
  skipped: { clause_id: string; name: string; reason: string }[];
} {
  const rules: CompiledRule[] = [];
  const skipped: { clause_id: string; name: string; reason: string }[] = [];
  for (const c of clauses) {
    const out = compileToRule(c);
    if (out.runnable) { rules.push(out.rule); continue; }
    const carrier = carrierRule(c);
    if (carrier) { rules.push(carrier); continue; }
    skipped.push({ clause_id: c.id, name: ruleName(c), reason: out.reason });
  }
  return { rules, skipped };
}

/* ------------------------------------------------------------------ *
 * Backward compatibility — v1 rule ⇄ clause.
 * ------------------------------------------------------------------ */

export interface V1Rule {
  id: string; name: string; effect: CpEffect; priority: number;
  condition?: WireCondition | WireCondition[] | null;
  constraint?: WireConstraint | null;
}

/** A legacy flat rule is the any/any/any, network-bound, data.transform clause. */
export function clauseFromV1(r: V1Rule): IntentClause {
  const decision = (r.effect.toUpperCase() as Decision);
  const constraint: ConstraintSpec | undefined = r.effect === "constrain" && r.constraint
    ? { handlers: [{ handler: "data.transform", params: {
        mode: r.constraint.kind === "reversible_tokenize" ? "reversible_tokenization" : "redact",
        ...(r.constraint.fields ? { fields: r.constraint.fields } : {}),
        ...(r.constraint.classes ? { classes: r.constraint.classes } : {}),
      } }] }
    : undefined;

  const clause: IntentClause = {
    id: r.id, priority: r.priority,
    subject: { any: true }, action: { any: true }, resource: { type: "any", any: true },
    ...(r.condition ? { conditions: { requires: r.condition as Predicate | Predicate[] } } : {}),
    decision,
    ...(constraint ? { constraint } : {}),
    binding: {
      plane: "network", capability: "network.egress.gate", status: "enforced",
      match: (r.condition as Predicate | Predicate[]) ?? undefined,
      effectiveDecision: decision, live: true,
      rationale: "legacy v1 rule — network body inspection/transform",
    },
    authority: "ceiling", origin: "contract",
    source: { text: r.name },
  };
  return clause;
}
