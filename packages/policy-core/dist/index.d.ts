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
export declare function parseConstraint(raw: string | null | undefined): Constraint | null;
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
export type Op = "equals" | "contains" | "not_contains" | "starts_with" | "regex" | "lt" | "gt" | "lte" | "gte" | "any_of" | "none_of" | "has" | "finding";
/** Evaluate a `finding` op. Exported so the runtime's fail-closed gate can reuse it. */
export declare function matchesFinding(raw: unknown, valueJson: string): boolean;
export interface SingleCondition {
    field: string;
    op: Op;
    value: string;
}
export type Condition = SingleCondition | SingleCondition[];
export declare function readField(call: ToolCall, path: string): unknown;
export declare function matchesCondition(call: ToolCall, condition: Condition): boolean;
export declare function parseCondition(raw: string | null): Condition | null;
export declare function evaluate(call: ToolCall, rules: Array<Rule & {
    condition_json?: string | null;
    constraint_json?: string | null;
}>): Decision;
/**
 * Keep rules that are org-wide (no project) or scoped to the given project.
 * Mirrors the control-plane SQL: (project_id IS NULL OR project_id = ?).
 */
export declare function applyProjectFilter<T extends {
    project_id?: string | null;
}>(rules: T[], project_id?: string | null): T[];
