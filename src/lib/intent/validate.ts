/**
 * The deterministic validator — surface terms → normalized IntentClauses.
 *
 * The extraction pipeline is: English → an LLM emits SURFACE TERMS under a
 * strict JSON schema (see api/compile-intent.ts) → THIS validator maps those
 * terms onto the controlled vocabulary and produces well-formed clauses,
 * rejecting or flagging anything outside the vocabulary rather than inventing
 * a field or silently choosing ALLOW/BLOCK.
 *
 * This is NOT a keyword NLP engine. It never reads free English. It takes an
 * already-structured extraction (subject/action/resource/decision/... as
 * enum-ish strings) and validates it. The linguistic work is the model's; the
 * SAFETY work — vocabulary, threshold semantics, the approver gate, preserving
 * unknowns — is deterministic and lives here where it can be audited.
 *
 * The three product decisions are enforced here:
 *  1. A threshold "X over N is blocked" is a CONDITIONAL BLOCK (match), NOT a
 *     CONSTRAIN. Only an explicit narrowing verb ("cap at N") is a CONSTRAIN
 *     handler. Match-condition and narrow-action are kept distinct.
 *  2. A REVIEW with no approver is an activation-blocking issue ("Configuration
 *     required"), never a silent ALLOW and never an invented approver.
 *  3. An unknown action/resource/handler is preserved as a pending clause or a
 *     rejection with a reason — never coerced.
 */

import {
  type IntentClause, type ClauseIssue, type Decision, type ActionVerb, type ResourceType,
  type SubjectSelector, type ConstraintSpec, type Predicate,
  ACTION_VERBS, RESOURCE_TYPES, AGENT_CLASSES, handlerDef,
} from "./schema";
import { resolveBinding } from "./resolve";
import { bridgeClass } from "./runtime";
import { dataTypes, expandClass } from "@wrapbox/registry";
import { ownedByFuturePlane } from "./resolve";
import type { RuntimeInvariant } from "./schema";
import { setContractGroups, getContractGroups, allGroups, groupIdFor, findService, type DestinationGroup } from "./destinations";

/* ------------------------------------------------------------------ *
 * The surface-term shape the model emits (one per atomic clause).
 * Everything is a plain string / string[] — the model's job is to segment and
 * label, not to know Wrapbox's internal types.
 * ------------------------------------------------------------------ */

export interface SurfaceClause {
  /** The exact span of the admin's sentence this came from. */
  text: string;
  /** What kind of statement this is. Default "clause". A "definition" declares
   *  an admin destination group; an "invariant" asserts a runtime safety rule.
   *  Neither becomes a matching clause. */
  kind?: "clause" | "definition" | "invariant";
  /** For kind="definition": the group being declared. */
  definition?: { group: string; label?: string; members: string[] };
  /** For kind="invariant": which invariant the sentence asserts. */
  invariant?: "fail_closed_transform" | "fail_closed_no_rule" | "fail_closed_uninspected";
  /** Extractor confidence 0–1. */
  confidence?: number;
  /** Exceptions the author attached that could not be lowered into a facet. */
  exceptions?: string[];
  /** The extractor marked this as the general default permission. */
  catchAll?: boolean;
  subject?: {
    agentClass?: string[];       // "browser", "cli", "ide", "mcp", "workload", "any"
    group?: string[];            // "engineering", "sre", "employees"
    agentId?: string[];
    user?: string[];
  };
  action?: string;               // a verb phrase: "read", "edit", "push", "call", "disclose", "charge"...
  resource?: {
    kind?: string;               // "repo", "file", "table", "mcp tool", "api", "payment"...
    ref?: string[];              // "acme/payments", "prod.customers", "main"
    paths?: string[];            // ".env", "src/**"
    excludePaths?: string[];
  };
  destination?: {
    /** Named services EXACTLY as the admin listed them: ["ChatGPT","Claude","Microsoft Copilot"]. */
    service?: string[];
    /** An admin-defined group the clause refers to ("approved_ai", "these approved AI services"). */
    group?: string;
    /** Only when the admin genuinely said "any/all external AI services" — a category, not a list. */
    category?: string;           // "external ai", "saas", "internal"
    host?: string[];
    trust?: string;              // "external" | "internal"
    /** The COMPLEMENT: "any other external destination", "anywhere except these". */
    notIn?: { group?: string; service?: string[]; host?: string[]; classes?: string[] };
    /** Destination Registry class names ("ANY_EXTERNAL", "APPROVED_AI"…) when the admin meant a whole class. */
    classes?: string[];
  };
  data?: {
    classes?: string[]; fields?: string[];
    /** Count / confidence / bulk semantics the sentence stated ("more than 100 records", "any single…"). */
    minCount?: number | null; minConfidence?: "low" | "medium" | "high" | null; scope?: "any" | "bulk" | null;
    owner?: string | null;
  };
  scope?: { environment?: string[]; instances?: string[] };
  /** What should happen when a required capability is missing (protections only). */
  onUnsupported?: "hold_activation" | "block" | "review" | "accept_risk" | null;
  /** A raw threshold the model detected, e.g. {field:"amount", op:">", value:500, unit:"USD"} */
  threshold?: { field?: string; op?: string; value?: number; unit?: string };
  decision?: string;             // "allow" | "constrain" | "review" | "block"
  /** A narrowing the model detected, e.g. {handler:"payment.max_amount", params:{amount:500}} */
  constraint?: { handler?: string; params?: Record<string, unknown> }[];
  approvers?: string[];          // for review
  priorityHint?: number;
}

export interface ValidatorVerdict {
  clauses: IntentClause[];       // accepted, well-formed, bound, deduplicated
  rejected: { text: string; reason: string }[];
  warnings: string[];
  /** True when at least one clause blocks the whole contract from going live. */
  activationBlocked: boolean;
  /** Runtime invariants the admin asserted (recognised, not compiled as clauses). */
  invariants: RuntimeInvariant[];
  /** Destination groups the contract itself defined. */
  groups: DestinationGroup[];
}

/**
 * Identity of a clause AFTER normalization.
 *
 * "edit", "modify", "overwrite" and "add a row" are four different sentences
 * that mean ONE permission: write. Once normalized they are the same clause and
 * must collapse into one, or the contract shows four identical WRITE rules and
 * the compiler emits four identical predicates. Provenance is not lost — every
 * contributing sentence is kept on the surviving clause's `sources`.
 *
 * Deliberately excludes id/priority/source (identity is the POLICY, not the
 * wording) and includes everything that changes meaning.
 */
/**
 * Deterministic, deep-stable serialisation for identity. Keys are sorted at
 * EVERY depth and arrays of primitives are order-insensitive, so
 * {notIn:{group:"a"}} and {notIn:{host:["x"]}} are different, while
 * ["PII","SECRET"] and ["SECRET","PII"] are the same. (The previous
 * JSON.stringify(v, keys) form used the keys array as an allowlist at all
 * depths, which silently dropped every nested key — two different complements
 * or two different thresholds hashed identically and were merged.)
 */
function stable(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    const items = v.map(stable);
    if (v.every((x) => x === null || typeof x !== "object")) items.sort();
    return "[" + items.join(",") + "]";
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

function clauseKey(c: IntentClause): string {
  return [
    stable(c.subject),
    stable(c.action),
    stable({ type: c.resource.type, ref: c.resource.ref, path: c.resource.path, match: c.resource.match }),
    stable(c.destination), stable(c.data), stable(c.scope), stable(c.conditions),
    c.decision,
    stable(c.constraint?.handlers?.map((h) => ({ handler: h.handler, params: h.params })) ?? null),
    // Approvers are deliberately NOT identity: "pushes to main need approval
    // from release managers" and "pushes to main require sign-off" are one
    // obligation; on merge the named approvers are unioned (see addClause).
  ].join("|");
}

/* ------------------------------------------------------------------ *
 * Normalizers — map a surface string onto the controlled vocab. Unknown ⇒ null.
 * These are small alias tables, not a sprawling keyword engine: they exist so
 * the model can say "edit" and we canonicalize to "write", nothing more.
 * ------------------------------------------------------------------ */

/**
 * Semantic normalization: admin language → canonical verb.
 *
 * Organised by canonical verb and spanning every domain the contract can
 * govern (filesystem, git, process, database, API, MCP, cloud/IAM, messaging,
 * payments), because a policy author writes "overwrite", "truncate",
 * "force-push" or "payout" without knowing our vocabulary. A verb missing here
 * does not silently become ALLOW or BLOCK — the clause is REJECTED with a
 * reason, so a gap is visible rather than dangerous.
 */
const ACTION_ALIASES: Record<string, ActionVerb> = {
  // ── read ──────────────────────────────────────────────────────────────
  read: "read", view: "read", get: "read", fetch: "read", download: "read",
  open: "read", access: "read", inspect: "read", analyze: "read", analyse: "read",
  examine: "read", preview: "read", load: "read", clone: "read", checkout: "read",
  retrieve: "read", pull: "read",

  // ── write (create / mutate in place) ──────────────────────────────────
  // NOTE: "upload"/"submit" are NOT here. They move content OFF the machine, so
  // they normalize to `disclose` below. `write` is reserved for modifying a
  // resource in place — the distinction decides whether a clause is judged by
  // the network plane or the endpoint plane.
  write: "write", edit: "write", modify: "write", update: "write", create: "write",
  insert: "write", add: "write", append: "write", overwrite: "write",
  replace: "write", rename: "write", move: "write", copy: "write", save: "write",
  commit: "write", patch: "write", alter: "write", set: "write", put: "write",
  upsert: "write", rebase: "write", tag: "write", archive: "write", chmod: "write",

  // ── delete ────────────────────────────────────────────────────────────
  delete: "delete", remove: "delete", drop: "delete", truncate: "delete",
  purge: "delete", erase: "delete", destroy: "delete", wipe: "delete",
  uninstall: "delete", deprovision: "delete", revoke: "delete", detach: "delete",

  // ── execute ───────────────────────────────────────────────────────────
  execute: "execute", run: "execute", exec: "execute", spawn: "execute",
  install: "execute", launch: "execute", start: "execute", deploy: "execute",
  build: "execute", script: "execute",

  // ── query (read a dataset) ────────────────────────────────────────────
  query: "query", select: "query", search: "query", lookup: "query",
  report: "query", aggregate: "query", scan: "query",

  // ── push / merge (source control) ─────────────────────────────────────
  push: "push", "force push": "push", publish: "push", release: "push",
  "pull request": "push", "merge request": "push", "open pr": "push",
  "create pr": "push", "raise pr": "push", pr: "push",
  merge: "merge", squash: "merge", "cherry pick": "merge", integrate: "merge",

  // ── invoke (tool / API call) ──────────────────────────────────────────
  invoke: "invoke", call: "invoke", use: "invoke", trigger: "invoke",
  request: "invoke", subscribe: "invoke",

  // ── disclose (content crosses a boundary) ─────────────────────────────
  disclose: "disclose", send: "disclose", share: "disclose", transmit: "disclose",
  upload: "disclose", submit: "disclose", "send to": "disclose", "upload to": "disclose",
  expose: "disclose", post: "disclose", email: "disclose", message: "disclose",
  notify: "disclose", leak: "disclose", paste: "disclose", attach: "disclose",
  export: "disclose", sync: "disclose",

  // ── transact (money moves) ────────────────────────────────────────────
  transact: "transact", pay: "transact", charge: "transact", refund: "transact",
  transfer: "transact", payout: "transact", authorize: "transact", capture: "transact",
  purchase: "transact", withdraw: "transact", settle: "transact",

  // ── configure (change settings / permissions) ─────────────────────────
  configure: "configure", change: "configure", provision: "configure",
  grant: "configure", escalate: "configure", enable: "configure", disable: "configure",
  rotate: "configure", scale: "configure", assign: "configure",

  // ── connect / list ────────────────────────────────────────────────────
  connect: "connect", browse: "connect", visit: "connect",
  list: "list", enumerate: "list", index: "list",
};

const RESOURCE_ALIASES: Record<string, ResourceType> = {
  repo: "repo", repository: "repo", branch: "branch",
  file: "file", folder: "folder", directory: "folder",
  database: "database", db: "database", table: "table", column: "column", schema: "schema",
  dataset: "dataset", sql: "db_statement", statement: "db_statement",
  endpoint: "endpoint", api: "api", "mcp tool": "mcp_tool", mcp: "mcp_tool", tool: "mcp_tool",
  account: "account", cloud: "cloud_resource", "iam role": "iam_role", iam: "iam_role",
  payment: "payment_transaction", transaction: "payment_transaction", "payment method": "payment_method",
  saas: "saas_object",
};

const DECISION_ALIASES: Record<string, Decision> = {
  allow: "ALLOW", permit: "ALLOW", let: "ALLOW", allowed: "ALLOW",
  permitted: "ALLOW", may: "ALLOW", can: "ALLOW", able: "ALLOW", ok: "ALLOW",
  constrain: "CONSTRAIN", limit: "CONSTRAIN", cap: "CONSTRAIN", restrict: "CONSTRAIN", narrow: "CONSTRAIN", mask: "CONSTRAIN", tokenize: "CONSTRAIN",
  review: "REVIEW", approve: "REVIEW", approval: "REVIEW", escalate: "REVIEW",
  "require approval": "REVIEW", "requires approval": "REVIEW", "needs approval": "REVIEW",
  "human review": "REVIEW", "sign off": "REVIEW", confirm: "REVIEW", gate: "REVIEW",
  block: "BLOCK", deny: "BLOCK", forbid: "BLOCK", prevent: "BLOCK", never: "BLOCK",
  prohibit: "BLOCK", prohibited: "BLOCK", disallow: "BLOCK", disallowed: "BLOCK",
  refuse: "BLOCK", reject: "BLOCK", stop: "BLOCK", quarantine: "BLOCK",
};

/**
 * Normalize a surface string for lookup: lowercase, collapse hyphens and
 * underscores to spaces (so "force-push" and "force push" behave identically),
 * and squeeze whitespace.
 */
function norm(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip a trailing plural so "files"/"tables"/"branches" match their singular. */
function singular(t: string): string {
  if (/(ss|us|is)$/.test(t)) return t;
  if (/ies$/.test(t)) return t.slice(0, -3) + "y";
  if (/(ches|shes|xes|ses)$/.test(t)) return t.slice(0, -2);
  if (/s$/.test(t)) return t.slice(0, -1);
  return t;
}

/**
 * Safe alias lookup.
 *
 * The tables are plain object literals, so a surface token of "constructor" or
 * "toString" would otherwise return an inherited FUNCTION — truthy, and then
 * returned as if it were a canonical verb. These strings are adversarially
 * reachable in a security component, so every lookup goes through own-property
 * checks.
 */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Split a phrase into candidate tokens, singular forms included. */
function tokens(s?: string): string[] {
  const raw = norm(s).split(/[/,;|&+]|\bor\b|\band\b|\s+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of raw) { out.push(t); const sg = singular(t); if (sg !== t) out.push(sg); }
  return out;
}

/**
 * Words that INVERT the meaning of whatever follows.
 *
 * Without this, "do not allow" tokenizes to [do, not, allow], the first
 * mappable token is "allow", and a prohibition compiles to ALLOW — the policy
 * says the exact opposite of what was written. Negation is checked before any
 * decision lookup, and a negated permission becomes BLOCK (fail closed).
 */
const NEGATION = /\b(not|never|no|none|cannot|can't|cant|don't|dont|doesn't|doesnt|won't|wont|shouldn't|shouldnt|must not|may not|forbidden|prohibited|disallow\w*|without)\b/;

/** Multi-word first, then token-by-token. `mapResource` always did this; the
 *  action and decision mappers did not, which made every multi-word alias dead
 *  code. Now all three share one path. */
function mapVia<T>(table: Record<string, T>, valid: readonly string[], s?: string, pick?: (a: T, b: T) => T): T | null {
  const whole = norm(s);
  if (!whole) return null;
  const direct = lookup(table, whole) ?? lookup(table, singular(whole));
  if (direct !== undefined) return direct;
  if (valid.includes(whole)) return whole as unknown as T;

  let best: T | null = null;
  for (const t of tokens(s)) {
    const v = lookup(table, t) ?? (valid.includes(t) ? (t as unknown as T) : undefined);
    if (v === undefined) continue;
    best = best === null ? v : (pick ? pick(best, v) : best);
  }
  return best;
}

/**
 * When several tokens map, prefer the most security-specific verb rather than
 * whichever came first. "send payment" is a transaction, not a disclosure;
 * "commit and push" is a push. Position in English is unreliable; consequence
 * is not.
 */
const ACTION_SPECIFICITY: Record<string, number> = {
  transact: 100, push: 90, merge: 85, delete: 80, configure: 75,
  disclose: 70, write: 60, execute: 55, query: 50, invoke: 40,
  read: 30, list: 20, connect: 10,
};
const moreSpecificAction = (a: ActionVerb, b: ActionVerb): ActionVerb =>
  (ACTION_SPECIFICITY[b] ?? 0) > (ACTION_SPECIFICITY[a] ?? 0) ? b : a;

/** English puts the head noun LAST ("database table" is a table), so a later
 *  match beats an earlier one. */
const moreSpecificResource = (_a: ResourceType, b: ResourceType): ResourceType => b;

/**
 * Which resource domains each verb naturally acts on.
 *
 * A compound phrase names more than one candidate verb, and position in English
 * does not reliably say which one is meant: "run a query" and "run a script"
 * share the same leading verb but mean different things. What disambiguates
 * them is WHAT is being acted on — a query runs against a table, a script runs
 * as a process. So candidates whose domain matches the clause's resource win
 * over candidates that merely rank more severe.
 */
const VERB_AFFINITY: Partial<Record<ActionVerb, ResourceType[]>> = {
  query:     ["database", "table", "schema", "dataset", "column", "db_statement"],
  execute:   ["file", "db_statement", "any"],
  push:      ["repo", "branch"],
  merge:     ["repo", "branch"],
  transact:  ["payment_transaction", "payment_method", "account"],
  invoke:    ["mcp_tool", "api", "endpoint"],
  configure: ["iam_role", "cloud_resource", "account", "saas_object"],
  disclose:  ["endpoint", "api", "saas_object", "file", "folder"],
  read:      ["file", "folder", "repo", "table", "dataset", "saas_object"],
  write:     ["file", "folder", "repo", "table", "saas_object"],
  delete:    ["file", "folder", "repo", "table", "saas_object", "cloud_resource"],
  list:      ["folder", "repo", "table", "cloud_resource", "mcp_tool"],
  connect:   ["endpoint", "api", "account"],
};

/** Every canonical verb a phrase could plausibly mean, in no particular order. */
function actionCandidates(s?: string): ActionVerb[] {
  const out = new Set<ActionVerb>();
  const whole = norm(s);
  const direct = lookup(ACTION_ALIASES, whole) ?? lookup(ACTION_ALIASES, singular(whole));
  if (direct !== undefined) out.add(direct);
  else if (ACTION_VERBS.includes(whole as ActionVerb)) out.add(whole as ActionVerb);
  for (const t of tokens(s)) {
    const v = lookup(ACTION_ALIASES, t) ?? (ACTION_VERBS.includes(t as ActionVerb) ? (t as ActionVerb) : undefined);
    if (v !== undefined) out.add(v);
  }
  return [...out];
}

/**
 * Resolve a (possibly compound) action phrase, using the resource it acts on to
 * disambiguate. Resource context is applied FIRST; severity ranking is only the
 * tie-breaker when context cannot decide.
 */
function mapAction(s?: string, resType?: ResourceType | null): ActionVerb | null {
  const cands = actionCandidates(s);
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  if (resType) {
    const fit = cands.filter((v) => (VERB_AFFINITY[v] ?? []).includes(resType));
    if (fit.length) return fit.reduce(moreSpecificAction);
  }
  return cands.reduce(moreSpecificAction);
}
function mapResource(s?: string): ResourceType | null {
  return mapVia(RESOURCE_ALIASES, RESOURCE_TYPES, s, moreSpecificResource);
}
/** A prohibition stated with only a modal — "cannot", "must not", "may not" —
 *  carries no permission word to invert, but it IS a decision: BLOCK. */
const BARE_PROHIBITION = /\b(cannot|can't|cant|must not|mustn't|may not|shall not|should not|not allowed|not permitted|prohibited|forbidden|never)\b/;

function mapDecision(s?: string): Decision | null {
  const d = mapVia(DECISION_ALIASES, ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"], s);
  if (d === null) return BARE_PROHIBITION.test(norm(s)) ? "BLOCK" : null;
  // A negated permission is a prohibition. Negating a prohibition is left
  // alone: "do not block" is ambiguous and must not silently become ALLOW.
  if (NEGATION.test(norm(s)) && (d === "ALLOW" || d === "CONSTRAIN")) return "BLOCK";
  return d;
}
function mapAgentClass(s: string): string | null {
  const table: Record<string, string> = {
    browser: "browser_chat", "browser chat": "browser_chat", chat: "browser_chat", web: "browser_chat",
    cli: "cli_agent", terminal: "cli_agent", shell: "cli_agent", "command line": "cli_agent",
    ide: "ide_agent", editor: "ide_agent", cursor: "ide_agent", vscode: "ide_agent", copilot: "ide_agent",
    mcp: "mcp_tool", tool: "mcp_tool", plugin: "mcp_tool",
    workload: "background_workload", background: "background_workload",
    "background workload": "background_workload", daemon: "background_workload",
    worker: "background_workload", ci: "background_workload", pipeline: "background_workload",
    automation: "background_workload", bot: "background_workload", service: "background_workload",
    human: "human", person: "human", employee: "human", user: "human",
    any: "any", agent: "any", assistant: "any",
  };
  const whole = norm(s);
  const direct = lookup(table, whole);
  if (direct) return direct;
  if (AGENT_CLASSES.includes(whole as never)) return whole;
  for (const t of tokens(s)) {
    const v = lookup(table, t) ?? (AGENT_CLASSES.includes(t as never) ? t : undefined);
    if (v) return v;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Threshold semantics — decision #2. A threshold is a MATCH condition on a
 * BLOCK/REVIEW clause, never auto-promoted to a CONSTRAIN handler.
 * ------------------------------------------------------------------ */

const OP_ALIASES: Record<string, Predicate["op"]> = { ">": "gt", "gt": "gt", "over": "gt", "above": "gt", ">=": "gte", "<": "lt", "under": "lt", "below": "lt", "<=": "lte", "=": "equals", "==": "equals", "eq": "equals" };

function thresholdPredicate(t: NonNullable<SurfaceClause["threshold"]>): Predicate | null {
  const field = t.field ? (t.field.includes(".") ? t.field : `tool_input.${t.field}`) : "tool_input.amount";
  const op = lookup(OP_ALIASES, norm(t.op)) ?? null;
  if (!op || t.value == null) return null;
  return { field, op, value: t.value };
}

/* ------------------------------------------------------------------ *
 * The validator.
 * ------------------------------------------------------------------ */

let clauseSeq = 0;
function clauseId(): string { clauseSeq += 1; return `c${Date.now().toString(36)}_${clauseSeq}`; }

export function validateSurface(surface: SurfaceClause[], _opts: { basePriority?: number } = {}): ValidatorVerdict {
  const clauses: IntentClause[] = [];
  const rejected: { text: string; reason: string }[] = [];
  const warnings: string[] = [];
  const byKey = new Map<string, IntentClause>();
  const invariants = new Set<RuntimeInvariant>();
  const groups: DestinationGroup[] = [];

  // ── Pass 1: definitions and invariants. They are not clauses. ────────────
  // A definition ("approved AI services, including ChatGPT, Claude, Copilot")
  // must be registered BEFORE any clause that refers to the group, wherever it
  // appears in the paragraph — hence a separate pass.
  for (const s of surface) {
    if (s.kind === "definition" && s.definition?.group) {
      const members = (s.definition.members ?? []).map((m) => findService(m)?.id ?? m.trim()).filter(Boolean);
      const id = groupIdFor(s.definition.group);
      if (!members.length) { warnings.push(`group “${s.definition.group}” was declared with no members — clauses that refer to it cannot be resolved until members are named`); }
      groups.push({ id, label: s.definition.label ?? s.definition.group, members, origin: "contract" });
      continue;
    }
    if (s.kind === "invariant") {
      if (s.invariant) invariants.add(s.invariant);
      else warnings.push(`“${s.text.slice(0, 60)}” reads as a safety rule but names no known invariant`);
    }
  }
  setContractGroups(groups);

  /**
   * Add a clause, collapsing it into an identical one if we already have it.
   * The survivor keeps the HIGHEST priority of the group (the most restrictive
   * placement the author implied) and accumulates every source sentence.
   */
  const addClause = (c: IntentClause): void => {
    const key = clauseKey(c);
    const existing = byKey.get(key);
    if (!existing) {
      c.sources = c.source ? [c.source] : [];
      byKey.set(key, c);
      clauses.push(c);
      return;
    }
    if (c.source && !existing.sources?.some((s) => s.text === c.source!.text)) {
      (existing.sources ??= []).push(c.source);
    }
    existing.priority = Math.max(existing.priority, c.priority);
    // Union approvers: if either sentence named one, the merged obligation has it.
    if (existing.decision === "REVIEW" || c.decision === "REVIEW") {
      const merged = [...new Set([...(existing.review?.approvers ?? []), ...(c.review?.approvers ?? [])])];
      existing.review = { ...(existing.review ?? {}), failClosed: true, ...(merged.length ? { approvers: merged } : {}) };
      if (merged.length) existing.issues = (existing.issues ?? []).filter((i) => i.code !== "review_needs_approver");
    }
    // Merge issues (e.g. a missing approver) so none is lost in the collapse —
    // unless the union above just satisfied it.
    for (const i of c.issues ?? []) {
      if (i.code === "review_needs_approver" && existing.review?.approvers?.length) continue;
      if (!existing.issues?.some((x) => x.code === i.code)) (existing.issues ??= []).push(i);
    }
  };

  // "documents, spreadsheets … and source code may be uploaded" grants two
  // different things: some FILE TYPES, and a CONTENT class. They need different
  // predicates (filename vs content), and policy-core conditions are AND-only,
  // so one clause cannot express "either". Split a permission that carries both
  // into two atomic clauses. Protections (BLOCK/REVIEW/CONSTRAIN) are NOT split:
  // for those the content class is the pin and a filename must never be
  // required, or renaming the file would defeat the rule.
  /**
   * Recover a DATA CLASS the extractor filed as a file glob ("*.source",
   * "*.secret"). Must run BEFORE the split decision below: a lifted class is
   * exactly what makes a mixed permission need splitting, and lifting it later
   * (inside the clause loop) meant the file-type half of "documents … and
   * source code may be uploaded" was dropped, because by then the clause had a
   * class and filenames were correctly demoted from being the pin.
   */
  const liftClassGlobs = (s: SurfaceClause): SurfaceClause => {
    const globs = s.resource?.paths ?? [];
    if (!globs.length) return s;
    const lifted: string[] = []; const kept: string[] = [];
    for (const g of globs) {
      // Only a "*.<word>" glob can be a mis-filed CLASS ("*.source", "*.secret").
      // A real filename (".env", "src/**") is a path and stays one.
      if (!/^(?:\*+\.)?[a-z_ -]+$/i.test(g.trim())) { kept.push(g); continue; }
      const stem = (g.split("/").pop() ?? g).replace(/^\*+\.?/, "").replace(/\.\*+$/, "").toLowerCase();
      const kind = stem ? bridgeClass(stem) : null;
      if (kind) lifted.push(kind === "source_code" ? "SOURCE_CODE" : kind === "secret" ? "SECRET" : kind === "pii" ? "PII" : "CREDENTIAL_FILE");
      else kept.push(g);
    }
    if (!lifted.length) return s;
    return { ...s,
      resource: { ...s.resource, paths: kept.length ? kept : undefined },
      data: { ...(s.data ?? {}), classes: [...new Set([...(s.data?.classes ?? []), ...lifted])] } };
  };

  const expanded: SurfaceClause[] = [];
  for (const raw of surface) {
    const s = raw.kind === "definition" || raw.kind === "invariant" ? raw : liftClassGlobs(raw);
    const isAllow = mapDecision(s.decision) === "ALLOW";
    const globs = s.resource?.paths ?? [];
    const classes = s.data?.classes ?? [];
    if (s.kind !== "definition" && s.kind !== "invariant" && isAllow && globs.length && classes.length) {
      expanded.push({ ...s, data: { ...(s.data ?? {}), classes: undefined, fields: s.data?.fields } });
      expanded.push({ ...s, resource: { ...(s.resource ?? {}), paths: undefined } });
    } else {
      expanded.push(s);
    }
  }

  expanded.forEach((s) => {
    if (s.kind === "definition" || s.kind === "invariant") return;

    // Catch-all phrasing ("everything else", "all other traffic", "otherwise")
    // becomes the any/any/any default clause at the lowest priority, so it sits
    // beneath every specific rule under first-match-wins.
    // A catch-all is the any/any/any default and the ONE clause that may
    // legitimately match everything. It must therefore have NO scope: a
    // sentence that names a destination, a data class, a path or a resource is
    // a scoped permission, and turning it into a catch-all would silently
    // widen it to every destination. Two guards: the extractor's explicit flag
    // is honoured only when the clause is genuinely unscoped, and the phrasing
    // heuristic is restricted to unambiguous catch-all idioms.
    // "Everything else in the warehouse is readable" names a resource kind and
    // an action — it is a scoped permission, not the default. A catch-all is
    // generic on every axis, including resource kind and action verb.
    const caResource = mapResource(s.resource?.kind);
    const caAction = mapAction(s.action, caResource);
    const genericResource = !caResource || caResource === "any" || caResource === "endpoint";
    const genericAction = !caAction || caAction === "connect" || caAction === "disclose" || caAction === "invoke" || caAction === "list";
    const unscoped = !s.destination && !(s.data?.classes?.length) && !(s.data?.fields?.length)
      && !(s.resource?.paths?.length) && !(s.resource?.ref?.length) && !s.scope && !s.threshold
      && genericResource && genericAction;
    const catchAllPhrasing = /\b(everything else|all other traffic|otherwise|anything else|by default|all remaining|all other requests)\b/i.test(s.text);
    if ((s.catchAll || catchAllPhrasing) && unscoped && mapDecision(s.decision)) {
      const decision = mapDecision(s.decision)!;
      // A catch-all REVIEW still needs an approver; a catch-all is always the
      // lowest priority regardless of any hint (a hinted catch-all ALLOW would
      // otherwise outrank every protection).
      const caApprovers = (s.approvers ?? []).map((a) => String(a).trim()).filter(Boolean);
      const caIssues: ClauseIssue[] = decision === "REVIEW" && !caApprovers.length
        ? [{ severity: "block_activation", code: "review_needs_approver", message: "Configuration required — this REVIEW clause needs an approver before the contract can go live." }]
        : [];
      const clause: IntentClause = {
        id: clauseId(), priority: 10,
        subject: { any: true }, action: { any: true }, resource: { type: "any", any: true },
        decision,
        ...(decision === "REVIEW" ? { review: { failClosed: true, ...(caApprovers.length ? { approvers: caApprovers } : {}) } } : {}),
        binding: { plane: null, capability: null, status: "pending", effectiveDecision: decision, live: false, rationale: "unresolved" },
        authority: "ceiling", origin: "contract", source: { text: s.text },
        ...(caIssues.length ? { issues: caIssues } : {}),
      };
      clause.binding = resolveBinding(clause);
      addClause(clause);
      return;
    }
    if (s.catchAll && !unscoped) {
      warnings.push(`“${s.text.slice(0, 60)}” was marked as a default permission but names a scope — kept as a scoped clause, not widened to a catch-all`);
    }

    // The model sometimes nests data classes under the resource ("kind":"data",
    // "classes":[...]) instead of the data facet. Lift them so the facet is
    // populated and the network predicate can be specific about content.
    const nestedClasses = (s.resource as { classes?: string[] } | undefined)?.classes;
    if (nestedClasses?.length) {
      s = { ...s, data: { ...(s.data ?? {}), classes: [...(s.data?.classes ?? []), ...nestedClasses] } };
      if (norm(s.resource?.kind) === "data") s = { ...s, resource: { ...s.resource, kind: undefined } };
    }

    // The model also sometimes files a DATA CLASS as if it were a file type —
    // "source code" becoming the glob "*.source", "secrets" becoming "*.secret".
    // A filename is never the security boundary for content, and "*.source"
    // matches no real file, so the rule would silently never fire. Recover it
    // generally: a glob whose stem bridges to a runtime content kind is a class,
    // not a path. It moves to data.classes and content becomes the pin.
    // (class-glob lifting already applied in the pre-pass above)

    // Resource first: the action mapper uses it to disambiguate compound
    // phrases ("run a query" on a table is a query, not an execute).
    const resType = mapResource(s.resource?.kind);
    const verb = mapAction(s.action, resType);
    const decision = mapDecision(s.decision);

    if (!verb) { rejected.push({ text: s.text, reason: `could not map the action "${s.action ?? "(none)"}" onto a known operation — left out rather than guessed` }); return; }
    if (!decision) { rejected.push({ text: s.text, reason: `no clear decision (allow/constrain/review/block) in "${s.text}"` }); return; }

    if (s.resource?.kind && !resType) {
      warnings.push(`resource "${s.resource.kind}" in "${s.text}" is not a known resource type — kept as a pending clause`);
    }

    // Subject
    const subject: SubjectSelector = {};
    const agentClasses = (s.subject?.agentClass ?? []).map(mapAgentClass).filter((x): x is string => !!x && x !== "any");
    if (agentClasses.length) subject.agentClass = agentClasses as SubjectSelector["agentClass"];
    if (s.subject?.group?.length) subject.group = s.subject.group;
    if (s.subject?.agentId?.length) subject.agentId = s.subject.agentId;
    if (s.subject?.user?.length) subject.user = s.subject.user;
    if (!Object.keys(subject).length) subject.any = true;

    // Conditions (threshold → match predicate; decision #2)
    const conds: IntentClause["conditions"] = {};
    if (s.threshold) {
      const p = thresholdPredicate(s.threshold);
      if (p) conds.requires = p;
      else warnings.push(`threshold in "${s.text}" was unclear and left out`);
    }

    // Constraint (only when the model emitted an explicit narrowing handler)
    let constraint: ConstraintSpec | undefined;
    const issues: ClauseIssue[] = [];
    if (decision === "CONSTRAIN") {
      const handlers = (s.constraint ?? [])
        .filter((h) => h.handler)
        .map((h) => ({ handler: h.handler!, params: h.params ?? {} }));
      // Data-transform shorthand: "tokenize email/phone" with data.classes but no explicit handler.
      if (!handlers.length && s.data && (s.data.classes?.length || s.data.fields?.length)) {
        handlers.push({ handler: "data.transform", params: { mode: "reversible_tokenization", ...(s.data.classes ? { classes: s.data.classes } : {}), ...(s.data.fields ? { fields: s.data.fields } : {}) } });
      }
      // A data.transform that names a mode but no TARGET inherits the clause's
      // own data facet. The extractor routinely emits {mode} alone when the
      // sentence already said what to tokenize; without this default the
      // handler has nothing to act on, the compiler fails it closed to BLOCK,
      // and a request the admin asked to tokenize-and-forward is blocked
      // instead — safe, but not what was written.
      for (const h of handlers) {
        if (h.handler !== "data.transform") continue;
        const p = h.params as { fields?: unknown; classes?: unknown; mode?: unknown };
        const hasTarget = (Array.isArray(p.fields) && p.fields.length) || (Array.isArray(p.classes) && p.classes.length);
        if (!hasTarget) {
          if (s.data?.classes?.length) p.classes = [...s.data.classes];
          if (s.data?.fields?.length) p.fields = [...s.data.fields];
        }
        if (!p.mode) p.mode = "reversible_tokenization";
      }
      if (!handlers.length) {
        // A CONSTRAIN with nothing to narrow is not enforceable — refuse, do not
        // silently downgrade to allow.
        rejected.push({ text: s.text, reason: "understood as a narrowing, but no constraint handler or data class was named — cannot enforce an empty CONSTRAIN" });
        return;
      }
      constraint = { handlers };
      // Flag handlers that are in no registry (pending), but KEEP the clause.
      const unknown = handlers.filter((h) => !handlerDef(h.handler)).map((h) => h.handler);
      if (unknown.length) issues.push({ severity: "info", code: "unknown_handler", message: `handler ${unknown.join(", ")} is not yet implementable — preserved as understood-only` });
    }

    // Review approver gate (decision #3)
    let review: IntentClause["review"];
    if (decision === "REVIEW") {
      const approvers = (s.approvers ?? []).map((a) => String(a).trim()).filter(Boolean);
      review = { failClosed: true, ...(approvers.length ? { approvers } : {}) };
      if (!approvers.length) {
        issues.push({ severity: "block_activation", code: "review_needs_approver", message: "Configuration required — this REVIEW clause needs an approver before the contract can go live." });
      }
    }

    // DATA — resolve every phrase through the Data Type Registry. A phrase that
    // resolves to nothing becomes a CUSTOM candidate (pending, visibly), never
    // an adjacent family. Count/confidence semantics live on the clause.
    const dataFacet = buildData(s, decision, issues);

    const clause: IntentClause = {
      id: clauseId(),
      priority: 0, // assigned below from severity + specificity
      subject,
      action: { verbs: [verb] },
      resource: buildResource(s, resType),
      ...(s.destination ? { destination: buildDestination(s, decision) } : {}),
      ...(dataFacet ? { data: dataFacet } : {}),
      ...(decision !== "ALLOW" ? { onUnsupported: s.onUnsupported ?? "hold_activation" } : {}),
      ...(s.scope && (s.scope.environment?.length || s.scope.instances?.length) ? { scope: { ...(s.scope.environment ? { environment: s.scope.environment as never } : {}), ...(s.scope.instances ? { instances: s.scope.instances } : {}) } } : {}),
      ...(Object.keys(conds).length ? { conditions: conds } : {}),
      decision,
      ...(constraint ? { constraint } : {}),
      ...(review ? { review } : {}),
      binding: { plane: null, capability: null, status: "pending", effectiveDecision: decision, live: false, rationale: "unresolved" },
      authority: "ceiling",
      origin: "contract",
      source: { text: s.text },
      ...(typeof s.confidence === "number" ? { confidence: s.confidence } : {}),
      ...(s.exceptions?.length ? { exceptions: s.exceptions } : {}),
      ...(issues.length ? { issues } : {}),
    };

    // A hint adjusts ordering only WITHIN the decision's severity tier. It can
    // never lift an ALLOW above a BLOCK — the tiers are the guarantee that a
    // broad permission cannot outrank an overlapping protection.
    clause.priority = typeof s.priorityHint === "number"
      ? SEVERITY_TIER[decision] + Math.min(99, Math.max(0, Math.round(s.priorityHint)))
      : severityPriority(decision, specificityOf(clause));
    if (typeof s.confidence === "number" && s.confidence < 0.7) {
      (clause.issues ??= []).push({ severity: "warning", code: "low_confidence", message: `the wording here was ambiguous (confidence ${Math.round(s.confidence * 100)}%) — check this clause says what you meant` });
    }
    // Bind it now so the caller sees honest status immediately.
    clause.binding = resolveBinding(clause);
    // INVARIANT I1 — no silent allow. A protection the deployed runtime cannot
    // enforce holds the whole contract unless the admin resolves it (block the
    // carrier, require review, or accept the risk with a signed reason).
    markUnenforceable(clause);
    addClause(clause);
  });

  const activationBlocked = clauses.some((c) => c.issues?.some((i) => i.severity === "block_activation"));
  return { clauses, rejected, warnings, activationBlocked, invariants: [...invariants], groups };
}

/**
 * The data facet: phrases → registry ids, plus count/confidence semantics.
 *
 *   "customer email addresses and phone numbers" → [PII.CONTACT.EMAIL, PII.CONTACT.PHONE]
 *   "trade secrets"                                → [COMPANY_IP.TRADE_SECRET]  (declared → understood_only)
 *   "frobnicator ids"                              → [CUSTOM.?.FROBNICATOR_IDS] (pending, admin must register)
 *
 * minCount / minConfidence come from the sentence when stated, else from the
 * most specific registry default among the named types ("bulk" phrasing uses
 * the family's bulkCount). This is where the old "5+ emails" detector
 * threshold now lives — as POLICY, per clause, for every type alike.
 */
function buildData(s: SurfaceClause, decision: Decision, issues: ClauseIssue[]): IntentClause["data"] | undefined {
  const d = s.data;
  if (!d || (!d.classes?.length && !d.fields?.length)) return undefined;
  const reg = dataTypes();
  const classes: string[] = [];
  const unresolved: string[] = [];
  for (const raw of d.classes ?? []) {
    const phrase = String(raw).trim();
    if (!phrase) continue;
    const hits = reg.resolveAll(phrase);
    if (hits.length) { for (const h of hits) if (!classes.includes(h.id)) classes.push(h.id); continue; }
    const cand = `CUSTOM.?.${phrase.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "UNKNOWN"}`;
    classes.push(cand); unresolved.push(phrase);
  }
  if (unresolved.length) {
    issues.push({ severity: decision === "ALLOW" ? "warning" : "info", code: "unknown_data_class",
      message: `“${unresolved.join("”, “")}” is not a registered data type — register it as a tenant type (identifier list, pattern, dictionary or label) to make it enforceable; kept as pending` });
  }
  // Defaults: the most specific named type wins; "bulk" phrasing uses bulkCount.
  let minCount = 1, minConfidence: "low" | "medium" | "high" = "medium", origin: "clause" | "registry" | "inherited" = "registry";
  const known = classes.filter((c) => !c.startsWith("CUSTOM.?."));
  if (known.length) {
    const defs = known.map((c) => reg.defaults(c));
    minCount = Math.max(...defs.map((x) => x.minCount));
    minConfidence = defs.map((x) => x.minConfidence).sort((a, b) => ({ low: 0, medium: 1, high: 2 }[a] - { low: 0, medium: 1, high: 2 }[b]))[0];
    origin = known.some((c) => reg.has(c)) ? "registry" : "inherited";
  }
  const scope: "any" | "bulk" = d.scope === "bulk" ? "bulk" : "any";
  if (scope === "bulk" && known.length) minCount = Math.max(minCount, ...known.map((c) => reg.defaults(c).bulkCount ?? 5));
  if (typeof d.minCount === "number" && d.minCount >= 1) { minCount = Math.round(d.minCount); origin = "clause"; }
  if (d.minConfidence) { minConfidence = d.minConfidence; origin = "clause"; }
  // A CONSTRAIN on a type the registry says is never transformable is refused at
  // the policy level, not silently downgraded: the runtime would block, and the
  // admin should know before activation.
  if (decision === "CONSTRAIN") {
    const bad = known.filter((c) => !reg.allowedActions(c).includes("CONSTRAIN"));
    if (bad.length) issues.push({ severity: "warning", code: "constrain_not_allowed", message: `${bad.join(", ")} can never be transformed and forwarded (only blocked or reviewed) — this clause will BLOCK, not tokenize` });
  }
  return {
    ...(classes.length ? { classes } : {}),
    ...(d.fields?.length ? { fields: d.fields } : {}),
    ...(unresolved.length ? { unresolved } : {}),
    ...(d.owner ? { owner: d.owner } : {}),
    match: { minCount, minConfidence, scope, origin },
  };
}

/** I1: a protection the runtime cannot enforce today must be resolved before activation. */
function markUnenforceable(clause: IntentClause): void {
  if (clause.decision === "ALLOW") return;
  const st = clause.binding.status;
  if (st === "enforced" || st === "degraded") return;
  // I1 is about the DEPLOYED plane: a network-owned protection (content leaves
  // the machine) that the network runtime cannot enforce would otherwise ride
  // the catch-all ALLOW. A clause owned by an undeployed plane (an in-place
  // file edit, a git push, an IAM grant, a payment rail) is not observable on
  // the network at all; it stays understood_only and is reported, but does
  // not hold the whole contract hostage to a plane that has not shipped.
  if (ownedByFuturePlane(clause) !== null) return;
  // …and only where the network plane is the one that WOULD see it: a clause
  // that names protected content or a destination. A threshold on a payment
  // amount, a deploy, an IAM grant name no data and no host — the network has
  // nothing to pin on; that gap is reported as understood_only, not held.
  const networkPin = Boolean(clause.data?.classes?.length) || Boolean(clause.destination && Object.keys(clause.destination).length);
  if (!networkPin) return;
  const how = clause.onUnsupported ?? "hold_activation";
  const why = clause.binding.rationale;
  const existing = (clause.issues ?? []).filter((i) => i.code !== "protection_unenforceable" && i.code !== "accept_risk_unsigned");
  if (how === "hold_activation") {
    existing.push({ severity: "block_activation", code: "protection_unenforceable", message: `Cannot be enforced as written (${why}). Choose: block the carrier (uploads and uninspectable bodies to this destination), require review, or accept the risk with a reason.` });
  } else if (how === "accept_risk") {
    if (!clause.acceptRisk?.by || !clause.acceptRisk?.reason) existing.push({ severity: "block_activation", code: "accept_risk_unsigned", message: "Accepting the risk needs your identity and a reason — both are recorded in evidence." });
    else existing.push({ severity: "warning", code: "risk_accepted", message: `risk accepted by ${clause.acceptRisk.by}: ${clause.acceptRisk.reason}` });
  } else {
    existing.push({ severity: "warning", code: "carrier_rule", message: `unenforceable as written; compiled as ${how.toUpperCase()} on uploads and uninspectable bodies to its destination scope` });
  }
  clause.issues = existing;
}

function buildResource(s: SurfaceClause, resType: ResourceType | null): IntentClause["resource"] {
  const paths = [...(s.resource?.paths ?? []), ...(s.resource?.excludePaths ?? [])];
  const refs = s.resource?.ref ?? [];

  // Infer the type from paths/refs when the model omitted it, so a filesystem/
  // repo intent resolves toward the endpoint plane instead of defaulting to
  // "any" (which the network branch then mislabels). This is general shape
  // inference, not a rule for any particular filename.
  let type: ResourceType = resType ?? "any";
  if (!resType) {
    if (refs.some((r) => /#(main|master|dev|release|prod)/.test(r))) type = "branch";
    else if (refs.some((r) => /^repo:|^[\w.-]+\/[\w.-]+$/.test(r))) type = "repo";
    else if (paths.some((p) => /\.\w+$|^\.[\w.]+$|\/\*|\*\*/.test(p))) type = "file";
  }

  const r: IntentClause["resource"] = { type };
  if (refs.length) r.ref = refs;
  if (s.resource?.paths?.length || s.resource?.excludePaths?.length) {
    r.path = { ...(s.resource.paths ? { include: s.resource.paths } : {}), ...(s.resource.excludePaths ? { exclude: s.resource.excludePaths } : {}) };
  }
  if (type === "any" && !r.ref && !r.path) r.any = true;
  return r;
}

/** Qualifiers that mean "the specific set I, the admin, have designated" —
 *  not "every destination of this kind". Only the admin knows which hosts are
 *  in such a set, so it cannot be expanded from a built-in catalog. */
const NAMED_SET_QUALIFIER = /\b(approved|sanctioned|authorized|authorised|permitted|allowed|whitelisted|allowlisted|corporate|company|official|blessed)\b/;

/**
 * The same qualifier as it appears in the ADMIN'S OWN SENTENCE, bound to a
 * destination noun.
 *
 * The extractor normalizes "approved AI services" to the category "external ai"
 * and drops the qualifier on the way — so checking the category alone misses
 * exactly the case that matters. Requiring a destination noun within a couple of
 * words keeps "approved users may send…" (where the qualifier describes the
 * subject) from being misread as a destination set.
 */
const NAMED_SET_IN_TEXT = /\b(approved|sanctioned|authorized|authorised|whitelisted|allowlisted|corporate|company|official)\s+(\w+\s+){0,2}(ai|llm|model|service|services|vendor|vendors|provider|providers|tool|tools|app|apps|site|sites|domain|domains|host|hosts|destination|destinations|endpoint|endpoints)\b/;

/** Words that mean the admin genuinely meant the WHOLE category, not a list. */
const ALL_OF_KIND = /\b(any|all|every|each|other|another|unapproved|unsanctioned|unlisted|third[- ]party)\b/;

/**
 * Build the destination facet while preserving EXACTLY the scope the admin
 * stated. Precedence, most specific first:
 *
 *   1. named services   "ChatGPT, Claude, and Copilot"   → service: [chatgpt, claude, copilot]
 *   2. a group          "these approved AI services"     → group: "approved_ai"
 *   3. a complement     "any other external destination" → notIn: { group | service }
 *   4. literal hosts
 *   5. a category       ONLY if the admin said "any/all external AI" — a list
 *                       of names must never be widened into a category.
 *
 * An unresolvable admin-designated set ("approved vendors" with no definition
 * anywhere) is kept as namedSet — a label the resolver reports as needing
 * members, never expanded on a guess.
 */
function buildDestination(s: SurfaceClause, decision?: Decision): NonNullable<IntentClause["destination"]> {
  const d: NonNullable<IntentClause["destination"]> = {};
  const src = s.destination ?? {};
  const text = norm(s.text);
  const cat = norm(src.category);
  const isProtection = decision !== undefined && decision !== "ALLOW";
  // Explicit Destination Registry classes from the extractor.
  const classNames = (src.classes ?? []).map((c) => String(c).toUpperCase().replace(/[\s-]+/g, "_")).filter((c) => expandClass(c).length);
  if (classNames.length) d.classes = classNames;
  const notClasses = (src.notIn?.classes ?? []).map((c) => String(c).toUpperCase().replace(/[\s-]+/g, "_")).filter((c) => expandClass(c).length);

  // 1. Named services — resolve each name against the registry, keep the rest
  //    verbatim so the resolver can report them as unknown rather than drop them.
  if (src.service?.length) {
    d.service = src.service.map((n) => findService(n)?.id ?? n.trim()).filter(Boolean);
  }

  // 2. Group reference.
  if (src.group) d.group = groupIdFor(src.group);
  // The extractor may have put a group-ish label in `category` ("approved ai
  // services"). If that label matches a defined group, it IS the group.
  if (!d.group && cat && NAMED_SET_QUALIFIER.test(cat)) {
    const gid = groupIdFor(cat);
    if (getContractGroups().some((g) => g.id === gid) || allGroups().some((g) => g.id === gid)) d.group = gid;
    else d.namedSet = (src.category ?? "").trim();
  }
  // Same check on the sentence itself, since the extractor often normalizes the
  // qualifier away ("approved AI services" → "external ai"). NOT for a
  // complement: "outside the approved services" mentions the group only to
  // negate it, and attaching it positively would make the clause match the
  // very destinations it excludes.
  if (!src.notIn && !d.group && !d.namedSet && !d.service?.length) {
    const m = NAMED_SET_IN_TEXT.exec(text);
    if (m) {
      const gid = groupIdFor(m[0]);
      const known = [...getContractGroups(), ...allGroups()].find((g) => g.id === gid);
      if (known) d.group = known.id; else d.namedSet = m[0].trim();
    }
  }

  // 3. Complement.
  if (src.notIn) {
    d.notIn = {
      ...(src.notIn.group ? { group: groupIdFor(src.notIn.group) } : {}),
      ...(src.notIn.service?.length ? { service: src.notIn.service.map((n) => findService(n)?.id ?? n.trim()) } : {}),
      ...(src.notIn.host?.length ? { host: src.notIn.host } : {}),
      ...(notClasses.length ? { classes: notClasses } : {}),
    };
  }

  // A positive scope that equals its own complement can never match — the
  // complement is the meaning; drop the positive side rather than compile a
  // rule that silently never fires.
  if (d.group && d.notIn?.group === d.group) delete d.group;
  if (d.service?.length && d.notIn?.service?.length && d.service.every((x) => d.notIn!.service!.includes(x))) delete d.service;

  // 4. Literal hosts.
  if (src.host?.length) d.host = src.host;

  // 5. Category — only when the admin meant the whole kind. A named list or a
  //    group reference already carries the exact scope; adding a category on
  //    top would widen it.
  // A category may coexist with a complement — "any AI assistant other than the
  // banned ones" is (category external_ai) AND (not in banned). Only a POSITIVE
  // named list/group/host makes a category redundant-and-widening.
  const namedScope = Boolean(d.service?.length || d.group || d.host?.length || d.namedSet);
  const looksLikeAI = /external.*ai|ai.*service|\bai\b|llm|model provider|chat ?gpt|claude|gemini|copilot/.test(cat);
  if (!namedScope) {
    if (looksLikeAI && (ALL_OF_KIND.test(text) || ALL_OF_KIND.test(cat) || /external/.test(cat))) d.category = ["external_ai"];
    else if (cat && !looksLikeAI) d.category = [cat.replace(/\s+/g, "_") as never];
  }

  if (norm(src.trust) === "external" || d.category?.includes("external_ai") || d.notIn) d.trust = "external";
  if (norm(src.trust) === "internal") d.trust = "internal";

  // 6. CLASSES for protections. "Any external AI service" must cover the AI
  //    service that launches tomorrow, and "any other external destination" every
  //    host nobody catalogued — so a PROTECTION scoped by category/trust/complement
  //    carries a destination CLASS the runtime resolves per request. A PERMISSION
  //    keeps the catalogue hosts (never wider than written).
  if (isProtection && !d.classes?.length) {
    if (d.category?.includes("external_ai")) d.classes = ["ANY_AI"];
    else if (d.trust === "external" && !d.service?.length && !d.group && !d.host?.length && !d.namedSet && !d.notIn) d.classes = ["ANY_EXTERNAL"];
  }
  if (!isProtection && d.trust === "internal" && !d.classes?.length && !d.service?.length && !d.group && !d.host?.length) d.classes = ["INTERNAL"];
  return d;
}

/**
 * Deterministic precedence for overlapping clauses.
 *
 * One request can be a business document AND contain PII AND contain a
 * credential. Under first-match-wins, whichever rule sorts first decides — so
 * the ORDER must encode severity, not the order the admin happened to write
 * the sentences in. Tiers guarantee BLOCK > REVIEW > CONSTRAIN > ALLOW for any
 * overlap; within a tier, a more specific clause (more predicates) outranks a
 * broader one. Position in the source text contributes nothing.
 *
 * Consequence the admin can rely on: "business files → ALLOW" can never
 * short-circuit "SECRET → BLOCK" or "EMAIL → CONSTRAIN", and a request with
 * both PII and an API key is BLOCKED, never tokenized-and-forwarded.
 */
const SEVERITY_TIER: Record<Decision, number> = { BLOCK: 400, REVIEW: 300, CONSTRAIN: 200, ALLOW: 100 };
function severityPriority(d: Decision, specificity: number): number {
  return SEVERITY_TIER[d] + Math.min(99, Math.max(0, specificity));
}

/** How many independent conditions pin this clause — its specificity. */
function specificityOf(c: IntentClause): number {
  let n = 0;
  const d = c.destination;
  if (d && (d.host?.length || d.service?.length || d.group || d.notIn || d.category?.length)) n += 2;
  if (c.data?.classes?.length) n += 2;
  if (c.resource.path?.include?.length || c.resource.ref?.length) n += 1;
  if (c.resource.type && c.resource.type !== "any") n += 1;
  if (c.scope?.environment?.length) n += 1;
  if (c.conditions?.requires) n += 1;
  if (!c.subject.any) n += 1;
  return n;
}
