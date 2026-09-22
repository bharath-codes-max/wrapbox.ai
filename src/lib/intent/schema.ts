/**
 * The normalized Intent Contract model.
 *
 * Wrapbox is a GENERAL runtime authorization layer, not a DLP/CSV tool. The
 * atomic unit is an IntentClause — exactly one SUBJECT × ACTION × RESOURCE →
 * DECISION. Every other semantic part (destination, data, scope, conditions)
 * hangs off that spine as an OPTIONAL facet. `data`/fields is one facet, never
 * the spine, so the shape is domain-independent: the same clause expresses
 * "edit a repo file", "cap a SQL query", "tokenize an email to an AI service",
 * "restrict an MCP tool", and "block a payment over $500".
 *
 * Three layers stay rigorously separate (this is what stops CONSTRAIN from
 * collapsing into "mask fields"):
 *
 *   DECLARED INTENT   the IntentClause. Plane-agnostic. The MAXIMUM authority.
 *                     Written once from English, never rewritten by binding.
 *      │ resolveBinding()   — pure; sets STATUS, never intent
 *      ▼
 *   LIVE BINDING      which plane enforces it, what it can observe today, and
 *                     an honest status (enforced / degraded / understood_only /
 *                     pending). effectiveDecision ≤ declared, always.
 *      │ compileToRule()    — pure; emits a runnable policy-core Rule
 *      ▼
 *   COMPILED PREDICATE  what actually runs. Network today = a policy-core Rule.
 *
 * The runtime NEVER sees an IntentClause. It only ever pulls compiled Rules.
 * That boundary is deliberate: authoring/understanding is a control-plane
 * concern; enforcement is a runtime concern, and they meet only at the Rule.
 */

/* ------------------------------------------------------------------ *
 * Primitives — the ONE matcher, shared verbatim with @wrapbox/policy-core
 * ------------------------------------------------------------------ */

/** policy-core's ops — the only ones that compile 1:1 onto the network plane. */
export type CoreOp = "equals" | "contains" | "not_contains" | "starts_with" | "regex" | "lt" | "gt" | "lte" | "gte";
/** Canonical superset. Extensions LOWER to a CoreOp at compile (glob→regex, in→regex); meaning never changes. */
export type Op = CoreOp | "in" | "not_in" | "glob";

export type PredValue = string | number | boolean | Array<string | number>;
/** One atom = a policy-core SingleCondition when op ∈ CoreOp. `field` resolves
 *  against a PLANE-SPECIFIC observation frame (see resolve.ts) — that is what
 *  makes "understood here / enforced there" precise rather than hand-waved. */
export interface Predicate { field: string; op: Op; value: PredValue; }
/** An array is AND — exactly policy-core's `Condition = SingleCondition | SingleCondition[]`. */
export type PredicateSet = Predicate | Predicate[];

/** Author-facing, uppercase. Maps 1:1 to policy-core's lowercase Effect.
 *  Ranked for the authority lattice: ALLOW < CONSTRAIN < REVIEW < BLOCK. */
export type Decision = "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK";
export const DECISION_RANK: Record<Decision, number> = { ALLOW: 0, CONSTRAIN: 1, REVIEW: 2, BLOCK: 3 };

/* ------------------------------------------------------------------ *
 * Controlled vocabularies — CLOSED sets. Extraction maps onto these or is
 * rejected; nothing off-vocab silently becomes ALLOW or BLOCK.
 * ------------------------------------------------------------------ */

export type AgentClass = "browser_chat" | "cli_agent" | "ide_agent" | "mcp_tool" | "background_workload" | "human";
export const AGENT_CLASSES: AgentClass[] = ["browser_chat", "cli_agent", "ide_agent", "mcp_tool", "background_workload", "human"];

/** Canonical verbs. Every domain operation maps INTO one of these — SELECT→query,
 *  INSERT→write, `git push`→push, POST→write|disclose, MCP call→invoke, charge→transact.
 *  That normalization is what lets one clause shape span every resource domain. */
export type ActionVerb =
  | "read" | "write" | "delete" | "execute" | "query" | "push" | "merge"
  | "invoke" | "disclose" | "transact" | "configure" | "connect" | "list";
export const ACTION_VERBS: ActionVerb[] = [
  "read", "write", "delete", "execute", "query", "push", "merge",
  "invoke", "disclose", "transact", "configure", "connect", "list",
];

export type ResourceType =
  | "file" | "folder" | "repo" | "branch"
  | "database" | "dataset" | "schema" | "table" | "column" | "db_statement"
  | "endpoint" | "api" | "mcp_tool"
  | "account" | "cloud_resource" | "iam_role" | "payment_method" | "payment_transaction" | "saas_object"
  | "any";
export const RESOURCE_TYPES: ResourceType[] = [
  "file", "folder", "repo", "branch",
  "database", "dataset", "schema", "table", "column", "db_statement",
  "endpoint", "api", "mcp_tool",
  "account", "cloud_resource", "iam_role", "payment_method", "payment_transaction", "saas_object", "any",
];

export type DestinationCategory = "external_ai" | "saas" | "internal" | "vendor" | "public_internet" | "model_provider";
export type Environment = "production" | "staging" | "development" | "test";

/* ------------------------------------------------------------------ *
 * The nine facets. Each selector is a SELECTOR: omitted ⇒ unconstrained on
 * that facet. Facets carry meaning across planes and are preserved even when
 * no plane can enforce them yet.
 * ------------------------------------------------------------------ */

export interface SubjectSelector {                 // 1. WHO/WHAT is acting
  any?: true;
  agentClass?: AgentClass[];
  agentId?: string[];
  user?: string[];
  group?: string[];
  device?: string[];
  workload?: string[];
}

export interface ActionSelector { any?: true; verbs?: ActionVerb[]; }   // 2. atomic clause ⇒ exactly one verb

export interface PathMatch { include?: string[]; exclude?: string[]; }   // globs for hierarchical resources
export interface ResourceSelector {                // 3. WHAT is acted on (the spine)
  any?: true;
  type?: ResourceType;
  ref?: string[];                                  // canonical ids: "repo:acme/payments", "table:prod.customers", "mcp:github.create_pr"
  path?: PathMatch;                                // hierarchical types: file trees, repo paths, schema.table
  match?: PredicateSet;                            // attribute predicate over the resource itself (branch, host, method)
}

export interface DestinationSelector {             // 4. WHERE it's going (present only when data/action leaves)
  any?: true;
  /** Literal hosts / domain suffixes. */
  host?: string[];
  /** Named services from the Destination Registry ("chatgpt", "claude"). These
   *  are kept EXACT — never widened to a category. */
  service?: string[];
  /** An admin-defined group id ("approved_ai"). Resolves via the registry. */
  group?: string;
  /** A built-in kind of destination. Only meaningful when the admin genuinely
   *  said "all/any external AI"; a named list must NOT become a category. */
  category?: DestinationCategory[];
  agentVendor?: string[];
  trust?: "internal" | "external";
  /** The COMPLEMENT: "any other destination", "anywhere except X". Lowers to a
   *  host predicate that matches everything NOT in the set. */
  notIn?: { group?: string; service?: string[]; host?: string[] };
  /** An admin-designated set the parser could not tie to a group definition.
   *  It is a LABEL, not a matcher — unresolvable until the admin names members. */
  namedSet?: string;
  match?: PredicateSet;
}

export interface DataSelector {                    // 5. OPTIONAL facet — NEVER the spine
  any?: true;
  classes?: string[];                              // open vocab: "PII" "EMAIL" "PHONE" "SECRET" "CARD" "SSN" …
  fields?: string[];                               // column / JSON-key names
  /** PROVENANCE / ownership — separate from class (§7). "Verizon customer
   *  data" is class=PII, owner="Verizon". Ownership is NOT inferred from the
   *  presence of PII; it needs its own detector (exact-data match, label,
   *  fingerprint) which does not exist today → the clause is understood_only
   *  until a provenance detector is registered. */
  owner?: string;
}

export interface ScopeSelector {                   // 6. WHICH instances/records/envs
  any?: true;
  environment?: Environment[];
  instances?: string[];
  recordFilter?: PredicateSet;                     // "one record" — the same predicate primitive
}

export interface ClauseConditions {                // 7. contextual limits. ALWAYS selection (match), never narrowing.
  timeWindow?: { after?: string; before?: string; tz?: string };
  maxCount?: { per: "request" | "session" | "hour" | "day"; n: number };
  requiresApproval?: { of: string[]; quorum?: number };   // a PRIOR approval must already exist
  requiresPermit?: { maxAgeSeconds?: number; singleUse?: boolean; bindings?: string[] };
  /** The {field,op,value} escape hatch, as authored. MATCH only — this is where
   *  "amount > 500" lives for a conditional BLOCK, distinct from a narrowing. */
  requires?: PredicateSet;
}

/* ------------------------------------------------------------------ *
 * Decision payloads — present iff the matching decision is chosen.
 * ------------------------------------------------------------------ */

/** 9. CONSTRAINT — extensible namespaced handler + typed params. NOT "mask fields".
 *  Reversible tokenization is ONE handler (`data.transform`); a git-flag rewrite,
 *  a row cap, a payment ceiling are others. */
export interface ConstraintHandler { handler: string; params: Record<string, unknown>; }
export interface ConstraintSpec { handlers: ConstraintHandler[]; }   // several narrowings, ANDed

export interface ReviewSpec {                      // present iff decision === "REVIEW"
  approvers?: string[];                            // group ids. ABSENT ⇒ activation-blocked (Configuration required)
  quorum?: number;
  escalations?: string[];
  permit?: { ttlSeconds: number; singleUse?: boolean; bind?: string[] };
  failClosed?: boolean;                            // default true
}

/* ------------------------------------------------------------------ *
 * Enforcement binding — the honesty layer. A pure derivation of the clause.
 * ------------------------------------------------------------------ */

export type EnforcementPlane = "network" | "endpoint" | "gateway" | "resource";

/**
 * The honest status of a clause against the planes deployed TODAY.
 *
 *  enforced        — a deployed plane observes every referenced field AND executes
 *                    every handler, with no relevant transport able to bypass it.
 *  degraded        — enforced on the traffic/path Wrapbox observes, but another
 *                    relevant transport CAN bypass it. Never shown as fully
 *                    enforced; evidence must state both protection AND the gap.
 *  understood_only — Wrapbox understands the intent but has NO usable enforcement
 *                    path for it today (the owning plane is not deployed). NOT
 *                    used merely because coverage is non-universal — that is degraded.
 *  pending         — no plane in the model can host this verb/handler/field at all
 *                    (an unknown concept). Preserved, surfaced, emits no predicate;
 *                    NEVER silently allowed or blocked.
 */
export type BindingStatus = "enforced" | "degraded" | "understood_only" | "pending";

export interface EnforcementBinding {
  plane: EnforcementPlane | null;                  // null for pending
  capability: string | null;                       // adapter capability id, e.g. "network.egress.body_transform"
  status: BindingStatus;
  match?: PredicateSet;                             // compiled plane-observable predicate. Set iff status ∈ {enforced, degraded}
  effectiveDecision: Decision;                      // honest runtime decision AFTER safe degradation. INVARIANT: ≤ declared.
  live: boolean;                                    // does this clause emit a real predicate on a deployed plane now?
  unenforcedFacets?: string[];                      // facets the bound plane cannot observe today
  unsupportedHandlers?: string[];                   // handlers named but not executable on this plane
  /** For DEGRADED: the transports/paths that bypass this enforcement, named plainly.
   *  This is what Evidence renders as the coverage gap. */
  coverageGap?: string;
  rationale: string;                                // one honest line, shown to the admin verbatim
}

/* ------------------------------------------------------------------ *
 * The atomic clause and the contract.
 * ------------------------------------------------------------------ */

export type ClauseOrigin = "contract" | "runtime_overlay" | "user_prompt";
export interface SourceRef { span?: [number, number]; text: string; }   // the author's exact words for THIS clause

/** A problem the admin must resolve before this clause can go live. */
export interface ClauseIssue {
  severity: "block_activation" | "warning" | "info";
  code: string;                                    // e.g. "review_needs_approver", "unknown_action"
  message: string;
}

export interface IntentClause {
  id: string;
  priority: number;                                // high→low, first-match-wins. Compiler ranks BLOCK/REVIEW above overlapping ALLOW.

  // spine (required)
  subject: SubjectSelector;
  action: ActionSelector;                          // exactly one verb — atomic
  resource: ResourceSelector;                      // one resource — atomic

  // optional facets
  destination?: DestinationSelector;
  data?: DataSelector;
  scope?: ScopeSelector;
  conditions?: ClauseConditions;

  // outcome
  decision: Decision;
  constraint?: ConstraintSpec;                     // REQUIRED iff decision === "CONSTRAIN"
  review?: ReviewSpec;                             //          iff decision === "REVIEW"

  // enforcement reality (a derivation)
  binding: EnforcementBinding;

  // authority + provenance
  authority: "ceiling";                            // the contract grants AT MOST this
  origin: ClauseOrigin;
  /** Extraction confidence (0–1). Low confidence is surfaced, never hidden. */
  confidence?: number;
  /** Exceptions the author attached ("except production", "unless internal"),
   *  preserved verbatim when they could not be lowered into a facet. */
  exceptions?: string[];
  source?: SourceRef;                              // editing must not rewrite this span
  /** Every sentence that normalized to this same clause. When "edit", "modify"
   *  and "overwrite" collapse into one WRITE clause, all three spans are kept
   *  here so provenance survives deduplication. */
  sources?: SourceRef[];
  issues?: ClauseIssue[];                          // activation gates and warnings
}

export type ContractStatus = "draft" | "active";

/**
 * A runtime safety invariant the contract asserts. These are NOT clauses: they
 * do not match requests, they govern how enforcement itself behaves, and the
 * runtime implements them unconditionally. The parser recognises them so an
 * admin's sentence is honoured as the invariant it is, rather than being
 * mangled into an unmatchable clause.
 */
export type RuntimeInvariant =
  | "fail_closed_transform"   // CONSTRAIN whose handler cannot run → BLOCK, never forward
  | "fail_closed_no_rule"     // no matching rule → BLOCK
  | "fail_closed_uninspected"; // body too large / undecodable → BLOCK

export const INVARIANT_META: Record<RuntimeInvariant, { label: string; where: string }> = {
  fail_closed_transform:   { label: "If a required transformation cannot be performed, the original request is never forwarded", where: "runtime/src/mitm.ts constrain branch + transform.ts" },
  fail_closed_no_rule:     { label: "A request matching no rule is blocked", where: "packages/policy-core evaluate()" },
  fail_closed_uninspected: { label: "A body that cannot be inspected is blocked, not forwarded", where: "runtime/src/mitm.ts oversize/undecodable path" },
};

export interface IntentContract {
  id: string;
  name: string;
  org: string;
  version: number;
  sourceText: string;                              // the admin's English, verbatim
  default: "ALLOW" | "BLOCK";                      // fail-closed default is "BLOCK"
  status: ContractStatus;
  clauses: IntentClause[];                         // priority-ordered atomic clauses
  /** Invariants the admin asserted. Always present in the runtime regardless. */
  invariants?: RuntimeInvariant[];
  registryVersion?: string;
  compiledAt?: string;
}

/* ------------------------------------------------------------------ *
 * The constraint-handler registry — the extensibility point.
 * ------------------------------------------------------------------ */

export interface HandlerDef {
  id: string;                                      // "data.transform" "sql.max_rows" "git.force_push" "payment.max_amount"
  namespace: string;                               // "data" "sql" "filesystem" "git" "http" "api" "mcp" "payment" …
  label: string;                                   // human name for Describe / Evidence
  /** Planes that COULD implement this handler. A clause naming it binds to the
   *  strongest deployed plane in this list; if none is deployed → understood_only. */
  planes: EnforcementPlane[];
  /** One-line description of the params it takes, for the authoring UI. */
  paramsHint: string;
  /** Render the handler+params as a phrase, for Describe / Build / Evidence. */
  summary: (params: Record<string, unknown>) => string;
}

/**
 * Seed registry. OPEN by design — new handlers are added here (and, when they
 * become enforceable, implemented in the owning plane's adapter). Tokenization
 * is one row. Nothing here is a hard-coded ceiling on what CONSTRAIN can mean.
 */
export const HANDLER_REGISTRY: Record<string, HandlerDef> = {
  "data.transform": {
    id: "data.transform", namespace: "data", label: "Transform sensitive data",
    planes: ["network", "gateway", "resource"],
    paramsHint: "mode: reversible_tokenization | redact; fields?[]; classes?[]",
    summary: (p) => `${p.mode === "redact" ? "redact" : "tokenize"} ${[...(asArr(p.fields)), ...(asArr(p.classes))].join(", ") || "sensitive data"}`,
  },
  "sql.max_rows": {
    id: "sql.max_rows", namespace: "sql", label: "Cap result rows",
    planes: ["gateway", "resource"], paramsHint: "limit: number",
    summary: (p) => `limit results to ${p.limit} rows`,
  },
  "sql.allowed_columns": {
    id: "sql.allowed_columns", namespace: "sql", label: "Restrict columns",
    planes: ["gateway", "resource"], paramsHint: "columns: string[]",
    summary: (p) => `only columns ${asArr(p.columns).join(", ")}`,
  },
  "sql.blocked_statements": {
    id: "sql.blocked_statements", namespace: "sql", label: "Block SQL statements",
    planes: ["gateway", "resource"], paramsHint: "statements: string[]",
    summary: (p) => `block ${asArr(p.statements).join(", ")}`,
  },
  "filesystem.allowed_paths": {
    id: "filesystem.allowed_paths", namespace: "filesystem", label: "Restrict paths",
    planes: ["endpoint", "resource"], paramsHint: "globs: string[]",
    summary: (p) => `only under ${asArr(p.globs).join(", ")}`,
  },
  "filesystem.operations": {
    id: "filesystem.operations", namespace: "filesystem", label: "Restrict file operations",
    planes: ["endpoint", "resource"], paramsHint: "ops: string[]",
    summary: (p) => `only ${asArr(p.ops).join(", ")}`,
  },
  "git.force_push": {
    id: "git.force_push", namespace: "git", label: "Rewrite force-push",
    planes: ["endpoint"], paramsHint: "rewrite_to: 'force-with-lease'",
    summary: () => "rewrite --force to --force-with-lease",
  },
  "http.allowed_methods": {
    id: "http.allowed_methods", namespace: "http", label: "Restrict HTTP methods",
    planes: ["network", "gateway"], paramsHint: "methods: string[]",
    summary: (p) => `only ${asArr(p.methods).join(", ")}`,
  },
  "api.allowed_endpoints": {
    id: "api.allowed_endpoints", namespace: "api", label: "Restrict API endpoints",
    planes: ["network", "gateway"], paramsHint: "endpoints: string[]",
    summary: (p) => `only ${asArr(p.endpoints).join(", ")}`,
  },
  "mcp.allowed_tools": {
    id: "mcp.allowed_tools", namespace: "mcp", label: "Restrict MCP tools",
    planes: ["network", "gateway"], paramsHint: "tools: string[]",
    summary: (p) => `only tools ${asArr(p.tools).join(", ")}`,
  },
  "mcp.argument_constraints": {
    id: "mcp.argument_constraints", namespace: "mcp", label: "Restrict MCP arguments",
    planes: ["network", "gateway"], paramsHint: "byTool: Record<string, predicate>",
    summary: () => "constrain tool arguments",
  },
  "payment.max_amount": {
    id: "payment.max_amount", namespace: "payment", label: "Cap payment amount",
    planes: ["network", "gateway", "resource"], paramsHint: "amount: number; currency: string",
    summary: (p) => `cap at ${p.amount} ${p.currency ?? ""}`.trim(),
  },
};

function asArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
}

/** Look up a handler; unknown handlers are how a `pending` clause is detected. */
export function handlerDef(id: string): HandlerDef | undefined {
  // Own-property only: "constructor" must be an unknown handler (→ pending),
  // not Object.prototype.constructor masquerading as a registered one.
  return Object.hasOwn(HANDLER_REGISTRY, id) ? HANDLER_REGISTRY[id] : undefined;
}
