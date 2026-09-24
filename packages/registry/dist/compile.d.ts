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
import { DestinationRegistry } from "./destinations.js";
import type { ClauseIR, PolicyIR, DataRef } from "./ir.js";
import { type CoverageVerdict, type RuntimeSnapshot } from "./capabilities.js";
export interface WireCondition {
    field: string;
    op: string;
    value: string;
}
export interface WireConstraint {
    kind: "reversible_tokenize" | "redact";
    handler: string;
    fields?: string[];
    classes?: string[];
    params?: Record<string, unknown>;
}
export interface WireRule {
    name: string;
    effect: "allow" | "constrain" | "block" | "review";
    priority: number;
    condition: WireCondition | WireCondition[] | null;
    constraint?: WireConstraint;
    description?: string;
    clause_id: string;
    /** Provenance for evidence: the clause and IR pins this rule came from. */
    meta: {
        clause_id: string;
        contract_id?: string;
        ir_schema: string;
        kind: "clause" | "carrier";
        coverage: CoverageVerdict["status"];
    };
}
/** The structured value of a `finding` predicate — what the runtime parses. */
export interface FindingQuery {
    any?: Array<{
        type: string;
        minCount: number;
        minConfidence: "low" | "medium" | "high";
    }>;
    all?: Array<{
        type: string;
        minCount: number;
        minConfidence: "low" | "medium" | "high";
    }>;
}
export declare function findingQuery(refs: DataRef[], all?: boolean): FindingQuery;
export declare function destinationPredicates(clause: ClauseIR, reg?: DestinationRegistry): {
    preds: WireCondition[];
    unresolved: string[];
};
export declare function lowerConstraint(clause: ClauseIR): {
    ok: true;
    constraint: WireConstraint;
} | {
    ok: false;
    why: string;
};
export interface CompileOutcome {
    rules: WireRule[];
    skipped: Array<{
        clause_id: string;
        reason: string;
    }>;
    coverage: Record<string, CoverageVerdict>;
}
export declare function compileIR(ir: PolicyIR, rt: RuntimeSnapshot | null, reg?: DestinationRegistry): CompileOutcome;
/** Types used by the runtime's fail-closed gate: every registered type, so a
 *  worst-case evaluation asks "if this body held ANY protected data, would a
 *  protection fire?". */
export declare function allTypeIds(): string[];
