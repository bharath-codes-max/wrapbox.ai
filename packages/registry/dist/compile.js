/**
 * IR → wire rules for the network plane.
 *
 * The daemon evaluates policy-core rules. This module lowers a ClauseIR to the
 * predicates the runtime observes: destination CLASS (so uncatalogued hosts
 * are still classified), exact hosts, and structured FINDINGS with count and
 * confidence semantics — never the coarse `content_kinds contains` predicate
 * that hid the single-instance PII gap.
 *
 * Non-runnable clauses (understood-only, pending) compile to NOTHING, and the
 * activation invariant decides whether a carrier rule stands in for them.
 */
import { dataTypes } from "./datatypes.js";
import { DestinationRegistry, destinations, expandClass } from "./destinations.js";
import { TRANSFORM_HANDLERS } from "./transforms.js";
import { coverage } from "./capabilities.js";
export function findingQuery(refs, all = false) {
    const items = refs.map((r) => ({ type: r.type, minCount: r.match.minCount, minConfidence: r.match.minConfidence }));
    return all ? { all: items } : { any: items };
}
export function destinationPredicates(clause, reg = destinations()) {
    const d = clause.destination;
    const preds = [];
    const unresolved = [...(d?.unresolved ?? [])];
    if (!d)
        return { preds, unresolved };
    const classes = new Set();
    for (const c of d.classes ?? [])
        for (const x of expandClass(c))
            classes.add(x);
    if (d.trust === "external" && !d.classes?.length && !d.hosts?.length && !d.services?.length && !d.groups?.length && !d.notIn)
        for (const x of expandClass("ANY_EXTERNAL"))
            classes.add(x);
    if (d.trust === "internal" && !d.classes?.length)
        classes.add("INTERNAL");
    if (classes.size)
        preds.push({ field: "tool_input.destination_class", op: "any_of", value: [...classes].join("|") });
    const hosts = [...(d.hosts ?? [])];
    const names = [...(d.services ?? [])];
    for (const g of d.groups ?? []) {
        const grp = reg.tenantConfig().groups.find((x) => x.id === g);
        if (grp)
            names.push(...grp.members);
        else
            unresolved.push(g);
    }
    const r = reg.resolveNames(names);
    hosts.push(...r.hosts);
    unresolved.push(...r.unresolved);
    if (hosts.length)
        preds.push({ field: "tool_input.host", op: "regex", value: DestinationRegistry.hostInRegex([...new Set(hosts)]) });
    if (d.notIn) {
        const notClasses = new Set();
        for (const c of d.notIn.classes ?? [])
            for (const x of expandClass(c))
                notClasses.add(x);
        if (notClasses.size)
            preds.push({ field: "tool_input.destination_class", op: "none_of", value: [...notClasses].join("|") });
        const notHosts = [...(d.notIn.hosts ?? [])];
        const notNames = [...(d.notIn.services ?? [])];
        for (const g of d.notIn.groups ?? []) {
            const grp = reg.tenantConfig().groups.find((x) => x.id === g);
            if (grp)
                notNames.push(...grp.members);
            else
                unresolved.push(g);
        }
        const nr = reg.resolveNames(notNames);
        notHosts.push(...nr.hosts);
        unresolved.push(...nr.unresolved);
        if (notHosts.length)
            preds.push({ field: "tool_input.host", op: "regex", value: DestinationRegistry.hostNotInRegex([...new Set(notHosts)]) });
        // "any other destination" with nothing positive: the complement alone is the scope — but a
        // protection must still exclude nothing by accident, so it applies to every external class.
        if (!classes.size && !hosts.length && clause.decision !== "ALLOW")
            preds.push({ field: "tool_input.destination_class", op: "any_of", value: expandClass("ANY_EXTERNAL").join("|") });
    }
    return { preds, unresolved: [...new Set(unresolved)] };
}
export function lowerConstraint(clause) {
    const ts = clause.transforms ?? [];
    if (!ts.length)
        return { ok: false, why: "no transform named" };
    const t = ts[0];
    const h = TRANSFORM_HANDLERS[t.handler];
    if (!h.legacyKind && t.handler !== "MASK" && t.handler !== "HASH" && t.handler !== "DROP_FIELD" && t.handler !== "LIMIT")
        return { ok: false, why: `${t.handler} is not executable by the network runtime yet` };
    const reg = dataTypes();
    const types = t.targets === "matched" ? (clause.data ?? []).map((r) => r.type) : (t.targets.types ?? (clause.data ?? []).map((r) => r.type));
    const fields = t.targets === "matched" ? (clause.data ?? []).flatMap((r) => r.fields ?? []) : (t.targets.fields ?? []);
    const bad = types.filter((ty) => reg.transformSupport(ty, t.handler) !== "supported");
    if (bad.length && !fields.length)
        return { ok: false, why: `${t.handler} is not safe for ${bad.join(", ")}` };
    const safe = types.filter((ty) => !bad.includes(ty));
    return { ok: true, constraint: { kind: h.legacyKind ?? "redact", handler: t.handler, ...(fields.length ? { fields } : {}), ...(safe.length ? { classes: safe } : {}), ...(t.params ? { params: t.params } : {}) } };
}
const effectOf = (d) => d === "ALLOW" ? "allow" : d === "CONSTRAIN" ? "constrain" : d === "REVIEW" ? "review" : "block";
export function compileIR(ir, rt, reg = destinations()) {
    const rules = [];
    const skipped = [];
    const cov = {};
    for (const c of ir.clauses) {
        const v = coverage(c, rt);
        cov[c.id] = v;
        const name = c.source.text.slice(0, 80);
        const meta = (kind) => ({ clause_id: c.id, contract_id: ir.contract.id, ir_schema: "1.0.0", kind, coverage: v.status });
        if (c.catchAll && c.decision === "ALLOW") {
            rules.push({ name, effect: "allow", priority: c.priority, condition: null, clause_id: c.id, meta: meta("clause") });
            continue;
        }
        const runnable = v.status === "enforced" || v.status === "degraded";
        const { preds: destPreds } = destinationPredicates(c, reg);
        if (!runnable) {
            // Carrier rule: the protection cannot see its data, but it can see the
            // destination scope and whether a body is an upload or uninspectable.
            if (c.decision !== "ALLOW" && (c.onUnsupported === "block" || c.onUnsupported === "review")) {
                const carrier = [...destPreds, { field: "tool_input.carrier", op: "any_of", value: "upload|uninspectable" }];
                rules.push({ name: `${name} — carrier rule (${v.unmet.map((u) => u.reason).join("; ").slice(0, 120)})`, effect: c.onUnsupported, priority: c.priority, condition: carrier, clause_id: c.id, meta: meta("carrier"), description: `UNENFORCEABLE AS WRITTEN — ${v.unmet.map((u) => u.reason).join("; ")}` });
            }
            else {
                skipped.push({ clause_id: c.id, reason: v.unmet.map((u) => u.reason).join("; ") || v.status });
            }
            continue;
        }
        const preds = [...destPreds];
        if (c.data?.length) {
            // Only OBSERVABLE types go on the wire; unobservable ones are reported in coverage (degraded).
            const observable = c.data.filter((r) => !v.unobservableTypes.includes(r.type));
            if (observable.length)
                preds.push({ field: "tool_input.findings", op: "finding", value: JSON.stringify(findingQuery(observable, c.dataAll)) });
        }
        else if (c.resource.paths?.include?.length) {
            const alts = c.resource.paths.include.map((g) => {
                const nm = g.split("/").pop() ?? g;
                const ext = /\.[A-Za-z0-9]+\*?$/.exec(nm)?.[0]?.replace(/\*$/, "");
                return ext ? ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[A-Za-z0-9]*" : nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            });
            preds.push({ field: "tool_input.filenames", op: "regex", value: `(${alts.join("|")})(,|$)` });
        }
        for (const p of c.conditions?.requires ?? [])
            preds.push({ field: p.field, op: p.op, value: String(p.value) });
        if (!preds.length) {
            skipped.push({ clause_id: c.id, reason: "no observable predicate — refusing to compile a scoped clause as match-everything" });
            continue;
        }
        let effect = effectOf(c.decision);
        let constraint;
        let ruleName = name;
        if (c.decision === "CONSTRAIN") {
            const low = lowerConstraint(c);
            if (!low.ok) {
                effect = "block";
                ruleName = `${name} — ${low.why}; blocked rather than forwarded unmasked`;
            }
            else
                constraint = low.constraint;
        }
        rules.push({
            name: ruleName, effect, priority: c.priority,
            condition: preds.length === 1 ? preds[0] : preds,
            ...(constraint ? { constraint } : {}),
            ...(v.status === "degraded" ? { description: `DEGRADED — ${v.unmet.map((u) => u.reason).concat(v.notes).join("; ")}` } : {}),
            clause_id: c.id, meta: meta("clause"),
        });
    }
    return { rules, skipped, coverage: cov };
}
/** Types used by the runtime's fail-closed gate: every registered type, so a
 *  worst-case evaluation asks "if this body held ANY protected data, would a
 *  protection fire?". */
export function allTypeIds() { return dataTypes().ids(); }
