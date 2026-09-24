/**
 * Policy IR — the ONE typed representation of an Intent Contract.
 *
 *   English ──(LLM, Structured Outputs)──► SurfaceIR ──(validator)──► PolicyIR
 *                                                                        │
 *                       compile ◄── capability coverage ◄────────────────┘
 *
 * SurfaceIR is what the model is allowed to say: free phrases for data types
 * and destinations, every field present (nullable), no enforcement meaning.
 * PolicyIR is what Wrapbox believes: data types and destination classes are
 * REGISTRY REFERENCES, thresholds are policy semantics on the clause, and every
 * protected clause states what happens when a required capability is missing.
 *
 * Both are Zod schemas. The Surface schema is exported as a strict JSON Schema
 * for OpenAI Structured Outputs (all fields required, additionalProperties
 * false); the model producing valid JSON proves the SHAPE, and the validator
 * re-checks the MEANING against the registries.
 */
import { z } from "zod";
import { DESTINATION_CLASSES, CLASS_GROUPS } from "./destinations.js";
import { TRANSFORM_IDS } from "./datatypes.js";
export const ACTION_VERBS = ["read", "write", "delete", "execute", "query", "push", "merge", "invoke", "disclose", "transact", "configure", "connect", "list"];
export const RESOURCE_TYPES = ["file", "folder", "repo", "branch", "database", "dataset", "schema", "table", "column", "db_statement", "endpoint", "api", "mcp_tool", "account", "cloud_resource", "iam_role", "payment_method", "payment_transaction", "saas_object", "any"];
export const DECISIONS = ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"];
export const CONFIDENCES = ["low", "medium", "high"];
export const ON_UNSUPPORTED = ["hold_activation", "block", "review", "accept_risk"];
export const INVARIANTS = ["fail_closed_transform", "fail_closed_no_rule", "fail_closed_uninspected"];
export const SUBJECT_KINDS = ["any", "group", "user", "agent_class", "device", "workload"];
export const DEST_CLASS_NAMES = [...DESTINATION_CLASSES, ...Object.keys(CLASS_GROUPS)];
/* ------------------------------------------------------------------ *
 * Surface IR — the model's output. Nullable everywhere, no optionals
 * (Structured Outputs requires every key to be present).
 * ------------------------------------------------------------------ */
const SurfaceData = z.object({
    /** The admin's phrase: "customer email addresses", "API keys", "trade secrets". */
    name: z.string(),
    /** Explicit count semantics when the sentence gives one ("more than 100 records"), else null. */
    minCount: z.number().int().nullable(),
    minConfidence: z.enum(CONFIDENCES).nullable(),
    /** "bulk" when the sentence is about lists/exports/databases, "any" otherwise, null if unstated. */
    scope: z.enum(["any", "bulk"]).nullable(),
    /** Column / field names, when the sentence names them. */
    fields: z.array(z.string()).nullable(),
    /** Provenance qualifier: "customer", "employee", "patient", or null. */
    owner: z.string().nullable(),
});
const SurfaceDestination = z.object({
    /** EXACT named services: ["ChatGPT", "Claude", "Microsoft Copilot"]. Never widened. */
    services: z.array(z.string()).nullable(),
    /** A group the contract defined: "approved_ai". */
    group: z.string().nullable(),
    /** Only when the admin literally means every destination of a kind. */
    class: z.enum(DEST_CLASS_NAMES).nullable(),
    hosts: z.array(z.string()).nullable(),
    /** The COMPLEMENT: "any other external destination", "anywhere except X". */
    notInServices: z.array(z.string()).nullable(),
    notInGroup: z.string().nullable(),
    notInClass: z.enum(DEST_CLASS_NAMES).nullable(),
    trust: z.enum(["internal", "external"]).nullable(),
});
const SurfaceThreshold = z.object({ field: z.string().nullable(), op: z.string().nullable(), value: z.number().nullable(), unit: z.string().nullable() });
const SurfaceTransform = z.object({ handler: z.enum(TRANSFORM_IDS), targets: z.array(z.string()).nullable(), params: z.string().nullable() });
export const SurfaceClauseSchema = z.object({
    kind: z.enum(["clause", "definition", "invariant"]),
    text: z.string(),
    confidence: z.number(),
    // definition
    definitionGroup: z.string().nullable(),
    definitionLabel: z.string().nullable(),
    definitionMembers: z.array(z.string()).nullable(),
    // invariant
    invariant: z.enum(INVARIANTS).nullable(),
    // clause
    subjectKind: z.enum(SUBJECT_KINDS).nullable(),
    subjectRefs: z.array(z.string()).nullable(),
    action: z.string().nullable(),
    resourceKind: z.string().nullable(),
    resourceRefs: z.array(z.string()).nullable(),
    resourcePaths: z.array(z.string()).nullable(),
    resourceExcludePaths: z.array(z.string()).nullable(),
    destination: SurfaceDestination.nullable(),
    data: z.array(SurfaceData).nullable(),
    /** true when EVERY listed data type must be present ("PII together with a card number"), else any. */
    dataAll: z.boolean().nullable(),
    environments: z.array(z.string()).nullable(),
    threshold: SurfaceThreshold.nullable(),
    decision: z.enum(["allow", "constrain", "review", "block"]).nullable(),
    transforms: z.array(SurfaceTransform).nullable(),
    approvers: z.array(z.string()).nullable(),
    exceptions: z.array(z.string()).nullable(),
    catchAll: z.boolean().nullable(),
    onUnsupported: z.enum(ON_UNSUPPORTED).nullable(),
});
export const SurfaceIRSchema = z.object({ clauses: z.array(SurfaceClauseSchema) });
/* ------------------------------------------------------------------ *
 * Policy IR — canonical, registry-referenced.
 * ------------------------------------------------------------------ */
export const PredicateSchema = z.object({ field: z.string(), op: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]) });
export const DataRefSchema = z.object({
    /** Registry id or prefix, or a CUSTOM.<tenant>.<TYPE> candidate. */
    type: z.string().regex(/^[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_-]+)*$/),
    /** How the phrase resolved, for provenance. `candidate` = no registry entry (pending). */
    resolution: z.enum(["id", "alias", "phrase", "candidate"]),
    sourcePhrase: z.string(),
    match: z.object({
        minCount: z.number().int().min(1),
        minConfidence: z.enum(CONFIDENCES),
        scope: z.enum(["any", "bulk"]),
        /** Whether minCount/minConfidence came from the sentence, the registry default, or the family default. */
        origin: z.enum(["clause", "registry", "inherited"]),
    }),
    fields: z.array(z.string()).optional(),
    owner: z.string().optional(),
});
export const DestRefSchema = z.object({
    classes: z.array(z.enum(DEST_CLASS_NAMES)).optional(),
    services: z.array(z.string()).optional(),
    groups: z.array(z.string()).optional(),
    hosts: z.array(z.string()).optional(),
    notIn: z.object({
        classes: z.array(z.enum(DEST_CLASS_NAMES)).optional(),
        services: z.array(z.string()).optional(),
        groups: z.array(z.string()).optional(),
        hosts: z.array(z.string()).optional(),
    }).optional(),
    trust: z.enum(["internal", "external"]).optional(),
    /** Names that did not resolve to anything addressable — never guessed. */
    unresolved: z.array(z.string()).optional(),
});
export const TransformRefSchema = z.object({
    handler: z.enum(TRANSFORM_IDS),
    targets: z.union([z.literal("matched"), z.object({ types: z.array(z.string()).optional(), fields: z.array(z.string()).optional() })]),
    params: z.record(z.string(), z.unknown()).optional(),
});
export const ClauseIRSchema = z.object({
    id: z.string(),
    source: z.object({ text: z.string(), span: z.tuple([z.number(), z.number()]).optional() }),
    confidence: z.number().min(0).max(1),
    subject: z.object({ kind: z.enum(SUBJECT_KINDS), refs: z.array(z.string()).optional() }),
    action: z.enum(ACTION_VERBS),
    resource: z.object({
        type: z.enum(RESOURCE_TYPES),
        refs: z.array(z.string()).optional(),
        paths: z.object({ include: z.array(z.string()).optional(), exclude: z.array(z.string()).optional() }).optional(),
    }),
    data: z.array(DataRefSchema).optional(),
    dataAll: z.boolean().optional(),
    destination: DestRefSchema.optional(),
    scope: z.object({ environments: z.array(z.string()).optional(), instances: z.array(z.string()).optional(), owner: z.string().optional() }).optional(),
    conditions: z.object({
        requires: z.array(PredicateSchema).optional(),
        count: z.object({ per: z.enum(["request", "session", "hour", "day"]), max: z.number().int() }).optional(),
    }).optional(),
    decision: z.enum(DECISIONS),
    transforms: z.array(TransformRefSchema).optional(),
    review: z.object({
        approvers: z.array(z.string()),
        quorum: z.number().int().optional(),
        permit: z.object({ ttlSeconds: z.number().int(), singleUse: z.boolean().optional() }).optional(),
        failClosed: z.literal(true),
    }).optional(),
    /** What happens when a required capability is missing on the deployed plane. */
    onUnsupported: z.enum(ON_UNSUPPORTED),
    acceptRisk: z.object({ by: z.string(), reason: z.string(), at: z.string() }).optional(),
    catchAll: z.boolean().optional(),
    exceptions: z.array(z.string()).optional(),
    /** Priority is DERIVED (severity tier + specificity); stored so the IR is self-describing. */
    priority: z.number().int(),
});
export const PolicyIRSchema = z.object({
    v: z.literal(1),
    contract: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        tenant: z.string(),
        sourceText: z.string(),
        sourceSha256: z.string(),
        compiledAt: z.string(),
        compiler: z.object({ mode: z.enum(["llm", "fallback", "authored"]), model: z.string().optional(), schemaVersion: z.string() }),
    }),
    pins: z.object({ dataTypes: z.string(), destinations: z.string(), detectors: z.string(), transforms: z.string(), extractors: z.string() }),
    definitions: z.object({
        destinationGroups: z.array(z.object({ id: z.string(), label: z.string(), members: z.array(z.string()) })),
        dataGroups: z.array(z.object({ id: z.string(), label: z.string(), types: z.array(z.string()) })),
    }),
    invariants: z.array(z.enum(INVARIANTS)),
    clauses: z.array(ClauseIRSchema),
    /** Phrases the validator could not map, kept verbatim so nothing is silently dropped. */
    rejected: z.array(z.object({ text: z.string(), reason: z.string() })),
    warnings: z.array(z.string()),
});
export const IR_SCHEMA_VERSION = "1.0.0";
/* ------------------------------------------------------------------ *
 * Strict JSON Schema for OpenAI Structured Outputs.
 * ------------------------------------------------------------------ */
/**
 * Structured Outputs (strict) requires `additionalProperties:false` on every
 * object and every key in `required`. Zod's JSON Schema export already emits
 * the shape; this walks it to enforce both rules and strips features the API
 * subset does not accept.
 */
export function extractionJsonSchema() {
    const raw = z.toJSONSchema(SurfaceIRSchema, { target: "draft-2020-12", unrepresentable: "any" });
    const walk = (node) => {
        if (!node || typeof node !== "object")
            return;
        const o = node;
        if (o.type === "object" && o.properties && typeof o.properties === "object") {
            o.additionalProperties = false;
            o.required = Object.keys(o.properties);
            for (const v of Object.values(o.properties))
                walk(v);
        }
        if (o.items)
            walk(o.items);
        for (const k of ["anyOf", "oneOf", "allOf"])
            if (Array.isArray(o[k]))
                for (const v of o[k])
                    walk(v);
        if (o.$defs && typeof o.$defs === "object")
            for (const v of Object.values(o.$defs))
                walk(v);
        // Not part of the Structured Outputs subset.
        delete o.$schema;
        delete o.minimum;
        delete o.maximum;
        delete o.minLength;
        delete o.maxLength;
        delete o.pattern;
        delete o.format;
        delete o.default;
    };
    walk(raw);
    return raw;
}
export function severityTier(d) {
    return d === "BLOCK" ? 400 : d === "REVIEW" ? 300 : d === "CONSTRAIN" ? 200 : 100;
}
/** How many independent conditions pin a clause — its specificity within a tier. */
export function specificity(c) {
    let n = 0;
    const d = c.destination;
    if (d && (d.hosts?.length || d.services?.length || d.groups?.length || d.notIn || d.classes?.length))
        n += 2;
    if (c.data?.length)
        n += 2;
    if (c.resource.paths?.include?.length || c.resource.refs?.length)
        n += 1;
    if (c.resource.type && c.resource.type !== "any")
        n += 1;
    if (c.scope?.environments?.length)
        n += 1;
    if (c.conditions?.requires?.length)
        n += 1;
    if (c.subject.kind !== "any")
        n += 1;
    return n;
}
export function derivePriority(c) {
    if (c.catchAll)
        return 10;
    return severityTier(c.decision) + Math.min(99, Math.max(0, specificity(c)));
}
