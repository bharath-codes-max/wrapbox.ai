/**
 * The rule evaluation engine.
 * Takes a tool call (what the agent wants to do) and a list of rules,
 * returns allow / block / review.
 *
 * Rules are checked in priority order (highest first).
 * First matching rule wins.
 * No matching rule = BLOCK (fail closed — the core security guarantee).
 */

/**
 * "constrain" means: the request proceeds, but only after the runtime has
 * transformed the body so the protected values never leave the device. It is
 * NOT a softer block and NOT a logged allow — if the transform cannot be
 * applied, the runtime must refuse the request rather than forward it intact.
 * That rule is enforced in runtime/src/transform.ts; a decision here only
 * names the intent.
 */
export type Effect = "allow" | "constrain" | "block" | "review";

/** How a CONSTRAIN decision rewrites the body. */
export type ConstraintKind = "reversible_tokenize" | "redact";

export interface Constraint {
  kind: ConstraintKind;
  /** Column / JSON-key names to protect, e.g. ["Email", "Phone"]. */
  fields?: string[];
  /** Data classes to protect wherever they appear, e.g. ["EMAIL", "CARD"]. */
  classes?: string[];
}

export interface Rule {
  id: string;
  name: string;
  effect: Effect;
  priority: number;
  condition: Condition | null;
  /**
   * Required when effect is "constrain" — a constrain rule with no constraint
   * describes no transform, so the runtime has nothing to apply and must fail
   * closed rather than guess.
   */
  constraint?: Constraint | null;
}

export interface ToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
  project_id?: string;
}

export interface Decision {
  effect: Effect;
  reason: string;
  matched_rule_id: string | null;
  /**
   * Carried through from the matched rule when effect is "constrain". Without
   * it the runtime would know it must transform but not what to protect, and
   * a transform it cannot specify is one it must not pretend to have applied.
   */
  constraint?: Constraint | null;
}

/** Parse a rule's stored constraint JSON. Returns null on anything malformed —
 *  the caller must then treat the rule as unenforceable, never as a plain
 *  allow. */
export function parseConstraint(raw: string | null | undefined): Constraint | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Constraint;
    if (!p || typeof p !== "object") return null;
    if (p.kind !== "reversible_tokenize" && p.kind !== "redact") return null;
    const fields = Array.isArray(p.fields) ? p.fields.filter((f) => typeof f === "string" && f.trim()) : [];
    const classes = Array.isArray(p.classes) ? p.classes.filter((c) => typeof c === "string" && c.trim()) : [];
    // A constraint that names nothing protects nothing.
    if (!fields.length && !classes.length) return null;
    return { kind: p.kind, ...(fields.length ? { fields } : {}), ...(classes.length ? { classes } : {}) };
  } catch {
    return null;
  }
}

// --- Condition matching ---

/**
 * Operators. The first nine are the original string/number ops. The rest were
 * added for registry-driven rules:
 *   any_of / none_of  set membership, value "A|B|C"; an array field matches on
 *                     any element (exact token, never substring)
 *   has               exact token membership for array fields ("pii" ≠ "ip")
 *   finding           structured findings: value is JSON {any:[{type,minCount,
 *                     minConfidence}]} or {all:[...]} evaluated against an
 *                     array of {type,count,confidence}; a type matches by
 *                     registry prefix (PII covers PII.CONTACT.EMAIL)
 */
export type Op = "equals" | "contains" | "not_contains" | "starts_with" | "regex" | "lt" | "gt" | "lte" | "gte"
  | "any_of" | "none_of" | "has" | "finding";

const CONF_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

interface FindingLike { type?: unknown; count?: unknown; confidence?: unknown }
interface FindingQueryItem { type: string; minCount?: number; minConfidence?: string }

function typeWithin(actual: string, wanted: string): boolean {
  return actual === wanted || actual.startsWith(wanted + ".");
}

function findingSatisfied(findings: FindingLike[], q: FindingQueryItem): boolean {
  const minCount = typeof q.minCount === "number" ? q.minCount : 1;
  const minConf = CONF_RANK[String(q.minConfidence ?? "low")] ?? 0;
  let total = 0;
  let bestConf = -1;
  for (const f of findings) {
    if (typeof f.type !== "string" || !typeWithin(f.type, q.type)) continue;
    const c = typeof f.count === "number" ? f.count : 1;
    const conf = CONF_RANK[String(f.confidence ?? "low")] ?? 0;
    if (conf < minConf) continue;
    total += c;
    if (conf > bestConf) bestConf = conf;
  }
  return bestConf >= minConf && total >= minCount;
}

/** Evaluate a `finding` op. Exported so the runtime's fail-closed gate can reuse it. */
export function matchesFinding(raw: unknown, valueJson: string): boolean {
  const findings = Array.isArray(raw) ? (raw as FindingLike[]) : [];
  let q: { any?: FindingQueryItem[]; all?: FindingQueryItem[] };
  try { q = JSON.parse(valueJson); } catch { return false; }
  if (!q || typeof q !== "object") return false;
  if (Array.isArray(q.all) && q.all.length) return q.all.every((item) => findingSatisfied(findings, item));
  if (Array.isArray(q.any) && q.any.length) return q.any.some((item) => findingSatisfied(findings, item));
  return false;
}

function tokensOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).toLowerCase());
  if (raw === undefined || raw === null) return [];
  return String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export interface SingleCondition {
  field: string;
  op: Op;
  value: string;
}

export type Condition = SingleCondition | SingleCondition[];

export function readField(call: ToolCall, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = {
    tool_name: call.tool_name,
    tool_input: call.tool_input,
    project_id: call.project_id,
  };
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchesSingle(call: ToolCall, cond: SingleCondition): boolean {
  const raw = readField(call, cond.field);
  const actual = raw === undefined || raw === null ? "" : String(raw);
  const expected = cond.value;

  switch (cond.op) {
    case "equals":
      return actual.toLowerCase() === expected.toLowerCase();
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    case "not_contains":
      return !actual.toLowerCase().includes(expected.toLowerCase());
    case "starts_with":
      return actual.toLowerCase().startsWith(expected.toLowerCase());
    case "regex":
      try { return new RegExp(expected, "i").test(actual); } catch { return false; }
    case "lt":
      return Number(actual) < Number(expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "any_of": {
      const set = new Set(expected.split("|").map((x) => x.trim().toLowerCase()).filter(Boolean));
      return tokensOf(raw).some((t) => set.has(t));
    }
    case "none_of": {
      const set = new Set(expected.split("|").map((x) => x.trim().toLowerCase()).filter(Boolean));
      return !tokensOf(raw).some((t) => set.has(t));
    }
    case "has":
      return tokensOf(raw).includes(expected.toLowerCase());
    case "finding":
      return matchesFinding(raw, expected);
    default:
      return false;
  }
}

export function matchesCondition(call: ToolCall, condition: Condition): boolean {
  if (Array.isArray(condition)) {
    // AND: all must match
    return condition.every((c) => matchesSingle(call, c));
  }
  return matchesSingle(call, condition);
}

export function parseCondition(raw: string | null): Condition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

// --- Main evaluation ---

/**
 * Build the Decision for a matched rule.
 *
 * A "constrain" rule whose constraint is missing or malformed is DOWNGRADED TO
 * BLOCK here, never to allow. The author asked for a transform; if we cannot
 * read which one, forwarding the body intact would be the opposite of what the
 * rule says. Failing closed is the only honest reading.
 */
function decisionFor(rule: Rule & { constraint_json?: string | null }): Decision {
  if (rule.effect !== "constrain") {
    return { effect: rule.effect, reason: rule.name, matched_rule_id: rule.id };
  }
  const constraint = rule.constraint ?? parseConstraint(rule.constraint_json ?? null);
  if (!constraint) {
    return {
      effect: "block",
      reason: `${rule.name} — CONSTRAIN rule has no usable constraint, so nothing could be masked`,
      matched_rule_id: rule.id,
    };
  }
  return { effect: "constrain", reason: rule.name, matched_rule_id: rule.id, constraint };
}

export function evaluate(call: ToolCall, rules: Array<Rule & { condition_json?: string | null; constraint_json?: string | null }>): Decision {
  // Sort by priority descending — highest priority first
  const sorted = [...rules]
    .filter((r) => r.priority !== undefined)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    const condition = rule.condition ?? parseCondition(rule.condition_json ?? null);

    // No condition = matches everything
    if (!condition) {
      return decisionFor(rule);
    }

    if (matchesCondition(call, condition)) {
      return decisionFor(rule);
    }
  }

  // FAIL CLOSED — no rule matched, block by default.
  // This is the core security guarantee: an unknown action is never allowed.
  return {
    effect: "block",
    reason: "No matching rule — blocked by default (fail closed)",
    matched_rule_id: null,
  };
}

/**
 * Keep rules that are org-wide (no project) or scoped to the given project.
 * Mirrors the control-plane SQL: (project_id IS NULL OR project_id = ?).
 */
export function applyProjectFilter<T extends { project_id?: string | null }>(
  rules: T[],
  project_id?: string | null
): T[] {
  return rules.filter((r) => r.project_id == null || r.project_id === project_id);
}
