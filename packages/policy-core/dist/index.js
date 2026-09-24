/**
 * The rule evaluation engine.
 * Takes a tool call (what the agent wants to do) and a list of rules,
 * returns allow / block / review.
 *
 * Rules are checked in priority order (highest first).
 * First matching rule wins.
 * No matching rule = BLOCK (fail closed — the core security guarantee).
 */
/** Parse a rule's stored constraint JSON. Returns null on anything malformed —
 *  the caller must then treat the rule as unenforceable, never as a plain
 *  allow. */
export function parseConstraint(raw) {
    if (!raw)
        return null;
    try {
        const p = JSON.parse(raw);
        if (!p || typeof p !== "object")
            return null;
        if (p.kind !== "reversible_tokenize" && p.kind !== "redact")
            return null;
        const fields = Array.isArray(p.fields) ? p.fields.filter((f) => typeof f === "string" && f.trim()) : [];
        const classes = Array.isArray(p.classes) ? p.classes.filter((c) => typeof c === "string" && c.trim()) : [];
        // A constraint that names nothing protects nothing.
        if (!fields.length && !classes.length)
            return null;
        return { kind: p.kind, ...(fields.length ? { fields } : {}), ...(classes.length ? { classes } : {}) };
    }
    catch {
        return null;
    }
}
const CONF_RANK = { low: 0, medium: 1, high: 2 };
function typeWithin(actual, wanted) {
    return actual === wanted || actual.startsWith(wanted + ".");
}
function findingSatisfied(findings, q) {
    const minCount = typeof q.minCount === "number" ? q.minCount : 1;
    const minConf = CONF_RANK[String(q.minConfidence ?? "low")] ?? 0;
    let total = 0;
    let bestConf = -1;
    for (const f of findings) {
        if (typeof f.type !== "string" || !typeWithin(f.type, q.type))
            continue;
        const c = typeof f.count === "number" ? f.count : 1;
        const conf = CONF_RANK[String(f.confidence ?? "low")] ?? 0;
        if (conf < minConf)
            continue;
        total += c;
        if (conf > bestConf)
            bestConf = conf;
    }
    return bestConf >= minConf && total >= minCount;
}
/** Evaluate a `finding` op. Exported so the runtime's fail-closed gate can reuse it. */
export function matchesFinding(raw, valueJson) {
    const findings = Array.isArray(raw) ? raw : [];
    let q;
    try {
        q = JSON.parse(valueJson);
    }
    catch {
        return false;
    }
    if (!q || typeof q !== "object")
        return false;
    if (Array.isArray(q.all) && q.all.length)
        return q.all.every((item) => findingSatisfied(findings, item));
    if (Array.isArray(q.any) && q.any.length)
        return q.any.some((item) => findingSatisfied(findings, item));
    return false;
}
function tokensOf(raw) {
    if (Array.isArray(raw))
        return raw.map((x) => String(x).toLowerCase());
    if (raw === undefined || raw === null)
        return [];
    return String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function readField(call, path) {
    const parts = path.split(".");
    let current = {
        tool_name: call.tool_name,
        tool_input: call.tool_input,
        project_id: call.project_id,
    };
    for (const part of parts) {
        if (typeof current !== "object" || current === null)
            return undefined;
        current = current[part];
    }
    return current;
}
function matchesSingle(call, cond) {
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
            try {
                return new RegExp(expected, "i").test(actual);
            }
            catch {
                return false;
            }
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
export function matchesCondition(call, condition) {
    if (Array.isArray(condition)) {
        // AND: all must match
        return condition.every((c) => matchesSingle(call, c));
    }
    return matchesSingle(call, condition);
}
export function parseCondition(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed;
    }
    catch {
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
function decisionFor(rule) {
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
export function evaluate(call, rules) {
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
export function applyProjectFilter(rules, project_id) {
    return rules.filter((r) => r.project_id == null || r.project_id === project_id);
}
