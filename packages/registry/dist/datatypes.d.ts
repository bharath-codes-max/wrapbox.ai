/**
 * Canonical Data Type Registry — the ONE vocabulary of protected data.
 *
 * Every surface (the LLM extraction schema, the validator's alias table, the
 * compiler, the runtime detectors, the transforms, the evidence and the UI)
 * refers to protected data by a registry id. Nothing else may carry its own
 * list of classes: the drift-guard tests in the compiler and the runtime fail
 * if a class name appears anywhere that is not resolvable here.
 *
 * Ids are hierarchical (`FAMILY.SUBFAMILY.TYPE`) so a clause can name any
 * level and match by prefix: `PII` covers `PII.CONTACT.EMAIL`. A type is a
 * CLAIM ABOUT DATA, not a detector — a type with no detector registered is
 * legal and is exactly what makes UNDERSTOOD_ONLY mechanical.
 *
 * Tenant types live under `CUSTOM.<tenant>.<TYPE>` and are indistinguishable to
 * the compiler from built-ins once registered.
 */
export type Confidence = "low" | "medium" | "high";
export declare const CONFIDENCE_RANK: Record<Confidence, number>;
export type TransformId = "REDACT" | "MASK" | "REVERSIBLE_TOKENIZE" | "HASH" | "DROP_FIELD" | "GENERALIZE" | "DATE_SHIFT" | "FORMAT_PRESERVING" | "LIMIT" | "REWRITE";
export declare const TRANSFORM_IDS: TransformId[];
export type TransformSupport = "supported" | "unsafe" | "not_applicable";
export type Decision = "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK";
export type Locality = "device" | "tenant_service" | "external_optin";
export type ContentInput = "text" | "table" | "structured" | "image" | "code" | "metadata" | "any";
export interface DataType {
    id: string;
    parent?: string;
    label: string;
    /** Phrases an administrator might use. Lower-case, matched as whole-word phrases. */
    aliases: string[];
    regulatory?: string[];
    /** Content-unit kinds the type is meaningful in. */
    inputs: ContentInput[];
    /** Per-transform support. Detectable ≠ transformable: a type can be found but
     *  never safely rewritten (a credential), or rewritten only in some formats. */
    transforms: Partial<Record<TransformId, TransformSupport>>;
    /** Decisions a clause may take on this type. CREDENTIAL.* forbids CONSTRAIN:
     *  a secret is never tokenised and forwarded. */
    actions: Decision[];
    /** Where detection may run. `external_optin` types can never be enabled
     *  without explicit tenant configuration (§N privacy boundary). */
    locality: Locality;
    /** Tenant configuration a detector for this type needs before it exists. */
    tenantConfig?: {
        required: boolean;
        kind: "edm_index" | "dictionary" | "regex" | "label_map" | "model" | "none";
    };
    /** Policy defaults, overridable per clause by `match`. */
    defaults: {
        minCount: number;
        minConfidence: Confidence;
        bulkCount?: number;
    };
    /** What evidence may record for a finding of this type. Values are NEVER recorded. */
    evidence: Array<"label" | "count" | "confidence" | "detector" | "detector_version" | "unit_path" | "field_names">;
    /** `declared` = no detector exists yet anywhere (UNDERSTOOD_ONLY by construction). */
    status: "stable" | "beta" | "declared";
    /** The coarse runtime kind older rules match on (`tool_input.content_kinds`).
     *  Derived, never authored per clause — kept only for wire compatibility. */
    legacyKind?: string;
}
/** Normalise a phrase for alias matching: lower-case, non-alphanumerics → single space. */
export declare function norm(s: string): string;
/** Light stemming for alias tokens: "numbers" → "number", "addresses" → "address". */
export declare function stem(w: string): string;
export declare const BUILTIN_TYPES: DataType[];
export declare const UNINSPECTABLE_STATES: readonly ["ENCRYPTED", "PASSWORD_PROTECTED", "UNSUPPORTED_FORMAT", "OVERSIZE", "DEPTH_EXCEEDED", "PARSER_FAILURE", "TIMEOUT", "DECOMPRESSION_REFUSED", "MALFORMED", "TRANSPORT"];
export type UninspectableState = (typeof UNINSPECTABLE_STATES)[number];
export interface CustomTypeSpec {
    tenant: string;
    /** Upper-case name, e.g. "EMPLOYEE_ID" → CUSTOM.<tenant>.EMPLOYEE_ID */
    name: string;
    label: string;
    aliases: string[];
    detection: {
        kind: "edm_index" | "regex" | "dictionary" | "label_map" | "model";
    };
    transforms?: DataType["transforms"];
    actions?: Decision[];
    defaults?: DataType["defaults"];
    /** True once the tenant has supplied the index / regex / dictionary / model. */
    configured: boolean;
}
export declare class DataTypeRegistry {
    private byId;
    private aliasIndex;
    readonly version: string;
    constructor(types?: DataType[], version?: string);
    add(d: DataType): void;
    /** Register a tenant type. Unconfigured tenant types are `declared`. */
    addCustom(spec: CustomTypeSpec): DataType;
    get(id: string): DataType | undefined;
    has(id: string): boolean;
    all(): DataType[];
    ids(): string[];
    /** Ancestors from the type up to its family, inclusive of the type itself. */
    lineage(id: string): string[];
    /** True when `id` is `prefix` or a descendant of it. */
    isWithin(id: string, prefix: string): boolean;
    /** Every registered type at or under a prefix. */
    descendants(prefix: string): DataType[];
    family(id: string): string;
    /**
     * Resolve an administrator's phrase to a registry id. Exact id, exact alias,
     * then the LONGEST alias that appears as a whole-word phrase. Returns null
     * rather than guessing; the caller turns null into a CUSTOM candidate.
     */
    resolve(phrase: string): {
        id: string;
        via: "id" | "alias" | "phrase";
    } | null;
    /**
     * Resolve EVERY type named in a phrase ("customer email addresses and phone
     * numbers" → EMAIL, PHONE). Greedy, longest alias first, non-overlapping,
     * with light plural stemming so "card numbers" meets "card number".
     */
    resolveAll(phrase: string): Array<{
        id: string;
        via: "id" | "alias" | "phrase";
        match: string;
    }>;
    /** The coarse runtime kind a type reduces to (wire compatibility). */
    legacyKind(id: string): string | null;
    /** Effective policy defaults, inherited down the lineage. */
    defaults(id: string): DataType["defaults"];
    /** Whether a transform is declared supported for a type (inherited). */
    transformSupport(id: string, transform: TransformId): TransformSupport;
    /** Decisions a clause may take on this type (inherited). */
    allowedActions(id: string): Decision[];
    /** Generated alias table — the ONLY alias table the validator may use. */
    aliasTable(): Record<string, string>;
}
/** The process-wide registry (built-ins + whatever tenant types were added). */
export declare function dataTypes(): DataTypeRegistry;
/** Test hook: replace the process-wide registry. */
export declare function setDataTypeRegistry(r: DataTypeRegistry | null): void;
