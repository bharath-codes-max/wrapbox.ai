/**
 * Binding resolution — the honesty layer.
 *
 * Given a declared clause and the set of enforcement planes deployed today,
 * decide WHERE it enforces and HOW honestly. This is a pure derivation: it
 * reads the clause and never mutates it, so the declared intent survives
 * verbatim even when nothing can enforce it yet. The day an endpoint or
 * gateway adapter ships, re-running this flips clauses to `enforced` with no
 * change to any clause — the contract was right all along; the fleet's reach
 * grew.
 *
 * The status vocabulary is exactly as specified:
 *   enforced        — a deployed plane covers every field + handler, no bypass.
 *   degraded        — enforced on what Wrapbox observes, but another relevant
 *                     transport can bypass it. The bypass is named as a
 *                     coverageGap; evidence states both protection AND gap.
 *   understood_only — understood, but NO usable enforcement path exists today.
 *   pending         — no plane can host the concept at all (unknown handler/field).
 */

import {
  type IntentClause, type EnforcementBinding, type EnforcementPlane, type BindingStatus,
  type Predicate, type PredicateSet, type Decision, handlerDef,
} from "./schema";
import { NETWORK_RUNTIME, bridgeClass, bridgeClasses, networkCapabilities, futurePlaneCapabilities } from "./runtime";
import { observableKinds } from "./detectors";
import { requirements, deriveStatus, classFamily, type StatusVerdict } from "./capabilities";
import { resolveNames, resolveGroup, resolveCategory, hostInRegex, hostNotInRegex, type HostResolution } from "./destinations";

/* ------------------------------------------------------------------ *
 * Plane observation frames — what each plane can actually SEE today.
 * Seeded to today's honest reality: only `network` is deployed.
 * ------------------------------------------------------------------ */

export interface PlaneFrame {
  plane: EnforcementPlane;
  deployed: boolean;
  /** Facet paths this plane can observe (used to decide unenforcedFacets). */
  observes: string[];
  /** Handler ids this plane can execute. */
  handlers: string[];
  /** Transports that BYPASS this plane for a given resource type — drives degraded. */
  bypass: (clause: IntentClause) => string | null;
}

/**
 * The network plane: a TLS-terminating proxy. It sees destination host/path/
 * method and the request BODY (content classes, uploads, JSON args, an amount
 * in a payment body). It can transform bodies. It cannot see a real file path,
 * a git ref, a Postgres wire statement, or an IAM call — those never appear on
 * the wire as such.
 */
const NETWORK: PlaneFrame = {
  plane: "network",
  deployed: true,
  observes: [
    "destination.host", "destination.category", "resource.match", "action",
    "data.classes", "data.fields",
  ],
  // ONLY the handlers the runtime actually executes today (runtime/src/transform.ts).
  // The registry defines more (http.allowed_methods, payment.max_amount, mcp.*),
  // but until an adapter runs them a clause naming them fails closed to BLOCK at
  // compile — so listing them here as executable would over-claim. Keep this in
  // sync with the runtime's implemented handlers.
  handlers: [...NETWORK_RUNTIME.handlers],
  bypass: (c) => {
    // Body-observable clauses are enforceable on HTTP, bypassable on other transports.
    const t = c.resource.type;
    if (t === "mcp_tool") return "local stdio MCP transport is outside current coverage (only MCP over HTTP is observed)";
    if (t === "db_statement" || t === "table" || t === "database") return "a direct database socket (e.g. Postgres wire) is outside current coverage (only SQL sent over HTTP is observed)";
    if (t === "payment_transaction") return "the authoritative settlement is a resource-plane property; only the submitted request amount is observed";
    return null;
  },
};

const ENDPOINT: PlaneFrame = {
  plane: "endpoint", deployed: false,
  observes: ["subject.process", "resource.path", "resource.ref", "file.path", "git.branch", "exec.argv"],
  handlers: ["filesystem.allowed_paths", "filesystem.operations", "git.force_push"],
  bypass: () => null,
};
const GATEWAY: PlaneFrame = {
  plane: "gateway", deployed: false,
  observes: ["sql.statement", "resource.ref", "api.endpoint", "mcp.tool", "mcp.args", "iam.action"],
  handlers: ["sql.max_rows", "sql.allowed_columns", "sql.blocked_statements", "mcp.allowed_tools", "mcp.argument_constraints", "api.allowed_endpoints", "http.allowed_methods", "payment.max_amount"],
  bypass: () => null,
};
const RESOURCE: PlaneFrame = {
  plane: "resource", deployed: false,
  observes: ["*"], handlers: ["*"], bypass: () => null,
};

export const PLANE_FRAMES: PlaneFrame[] = [NETWORK, ENDPOINT, GATEWAY, RESOURCE];

/** The canonical set of wire fields — sourced from the Runtime Capability
 *  Registry so this file cannot drift from what the daemon actually emits. */
export const RUNTIME_OBSERVED_FIELDS = NETWORK_RUNTIME.fields;

/** Which resource types the network plane can meaningfully act on from the wire. */
const NETWORK_RESOURCE_TYPES = new Set([
  "endpoint", "api", "mcp_tool", "payment_transaction", "saas_object", "account", "any",
  // db_statement/table appear only when SQL rides HTTP → degraded, handled in bypass()
  "db_statement", "table", "database",
]);

/**
 * Verbs that move content ACROSS a boundary. These are observable on the wire
 * whatever the payload happens to be — a CSV uploaded to a web AI is network
 * traffic, not a filesystem event.
 */
const TRANSMISSION_VERBS = new Set<string>(["disclose", "connect", "invoke", "transact", "query", "list"]);

/**
 * Verbs that act on an object IN PLACE on the machine. With no destination,
 * these are OS-level events the network never sees.
 */
const LOCAL_VERBS = new Set<string>(["read", "write", "delete", "execute", "push", "merge", "configure"]);

/** Resource kinds that are objects on a machine / in a repo. */
const LOCAL_OBJECTS = new Set<string>(["file", "folder", "repo", "branch"]);
/** Resource kinds brokered by a data/cloud gateway. */
const GATEWAY_OBJECTS = new Set<string>(["iam_role", "cloud_resource", "column", "schema", "dataset", "database", "table", "db_statement"]);

/**
 * Which plane OWNS this clause — derived from the (ACTION, DESTINATION,
 * RESOURCE) triple, never from resource.type alone.
 *
 * The distinction that matters, and the bug this replaces: a *.csv clause is
 * not automatically a filesystem concern. Two genuinely different cases share
 * the same resource type:
 *
 *   upload customers.csv to a web AI   → content crosses the network  → network
 *   agent rewrites /project/data.csv   → in-place OS mutation          → endpoint
 *
 * Deciding on resource.type alone collapsed both into "endpoint", which both
 * under-claimed (the upload IS enforceable today) and would have over-claimed
 * if reversed (the network plane cannot rewrite a local file).
 *
 * Returning null means "not owned by a future plane" — the caller then tries
 * the network plane, which decides for itself what it can observe.
 */
function ownedByFuturePlane(clause: IntentClause): EnforcementPlane | null {
  const verb = clause.action.verbs?.[0];
  const d = clause.destination;
  const hasDestination = Boolean(d && (d.any || d.host?.length || d.category?.length || d.service?.length || d.trust || d.namedSet || d.match));

  // 1. A stated destination, or a transmission verb, means content leaves the
  //    machine. That is wire traffic regardless of the object's type — so do
  //    NOT hand it to a future plane. Let the network branch judge it.
  if (hasDestination) return null;
  if (verb && TRANSMISSION_VERBS.has(verb)) return null;

  const t = clause.resource.type ?? "any";
  const hasPath = Boolean(clause.resource.path?.include?.length || clause.resource.path?.exclude?.length);
  const repoRef = (clause.resource.ref ?? []).some((r) => /^repo:/.test(r) || /#(main|master|dev|release)/.test(r));

  // 2. An in-place action on a machine/repo object, with nothing crossing the
  //    network, is an endpoint concept — the OS is the only place it is visible.
  const localVerb = !verb || LOCAL_VERBS.has(verb);
  if (localVerb && (LOCAL_OBJECTS.has(t) || hasPath || repoRef)) return "endpoint";

  // 3. Data/cloud objects are brokered by the gateway.
  if (GATEWAY_OBJECTS.has(t)) return "gateway";

  return null;
}

/* ------------------------------------------------------------------ *
 * Compiling the network-observable predicate for a clause.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Destination resolution — names → hosts, via the Destination Registry.
 * ------------------------------------------------------------------ */

export { resolveDestination, destinationUnresolved, type DestinationResolution } from "./resolve-dest";
import { resolveDestination, destinationUnresolved } from "./resolve-dest";

function pushPred(out: Predicate[], p: PredicateSet | undefined): void {
  if (!p) return;
  if (Array.isArray(p)) out.push(...p);
  else out.push(p);
}

/* ------------------------------------------------------------------ *
 * The network predicate — only fields the runtime populates, only content
 * kinds the classifier emits, only hosts that resolved. Anything else is
 * reported so binding can be honest about it.
 * ------------------------------------------------------------------ */

export interface PredicateBuild {
  pred: Predicate[] | null;
  /** Semantic data classes with no runtime content kind. */
  unobservableClasses: string[];
  /** Destination names that did not resolve. */
  unresolvedDestinations: string[];
  /** Filename predicates were available but deliberately not made a required
   *  conjunct, because the clause is content-based and a rename must not
   *  defeat it. */
  filenameNotBoundary: boolean;
}

export function buildNetworkPredicate(clause: IntentClause): PredicateBuild {
  const out: Predicate[] = [];
  const build: PredicateBuild = { pred: null, unobservableClasses: [], unresolvedDestinations: [], filenameNotBoundary: false };

  // Destination — exact hosts, or the complement of exact hosts.
  const dest = resolveDestination(clause);
  if (dest.hosts.length) out.push({ field: "tool_input.host", op: "regex", value: hostInRegex(dest.hosts) });
  if (dest.notHosts.length) out.push({ field: "tool_input.host", op: "regex", value: hostNotInRegex(dest.notHosts) });
  build.unresolvedDestinations = dest.unresolved;

  // Resource attribute predicates (host/method already in wire terms).
  pushPred(out, clause.resource.match);

  // Content — bridge fine-grained semantic classes to the classifier's coarse
  // kinds. A class with no bridge is UNOBSERVABLE and is reported, never
  // silently mapped to something else.
  // Observability is decided by the DETECTOR REGISTRY, not a fixed table: a
  // class is observable iff a registered detector produces its family. The
  // family is also the runtime content-kind to match on. Register a detector →
  // this starts emitting a predicate, with no edit here.
  const classes = clause.data?.classes ?? [];
  const bridged = observableKinds(classes, classFamily);
  // Several kinds are DISJUNCTIVE: "PII and credentials must never be sent"
  // means either one. Emitting one predicate per kind would AND them, so a
  // request would need ALL of them to match. One OR-regex over the runtime's
  // comma-joined content_kinds list. (For BLOCK/REVIEW/CONSTRAIN this is the
  // stricter reading; for ALLOW it is what the admin meant.)
  if (bridged.kinds.length === 1) out.push({ field: "tool_input.content_kinds", op: "contains", value: bridged.kinds[0] });
  else if (bridged.kinds.length > 1) out.push({ field: "tool_input.content_kinds", op: "regex", value: `(^|,)(${bridged.kinds.join("|")})(,|$)` });
  build.unobservableClasses = bridged.unobservable;

  // Filenames are SUPPORTING evidence, not the security boundary. For a
  // content-based clause (any data class named), the content kind is the pin
  // and filenames are NOT required — otherwise renaming secret.yaml to
  // holiday.txt would defeat the rule. For a clause with no content class (a
  // plain "these file types may be uploaded" permission), filenames legitimately
  // scope it.
  const globs = clause.resource.path?.include ?? [];
  if (globs.length && classes.length === 0) {
    // "PDF, CSV and XLSX may be uploaded" — ANY of them, not all at once. One
    // OR-regex over the runtime's comma-joined filename list; per-glob
    // predicates would AND together and no single upload could ever match.
    const alts: string[] = [];
    for (const g of globs) {
      const name = g.split("/").pop() ?? g;
      const ext = /\.[A-Za-z0-9]+\*?$/.exec(name)?.[0]?.replace(/\*$/, "");
      if (ext) alts.push(ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[A-Za-z0-9]*");
      else if (/^[.\w-]+$/.test(name)) alts.push(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    if (alts.length === 1) out.push({ field: "tool_input.filenames", op: "regex", value: `${alts[0]}(,|$)` });
    else if (alts.length > 1) out.push({ field: "tool_input.filenames", op: "regex", value: `(${alts.join("|")})(,|$)` });
  } else if (globs.length && classes.length > 0) {
    build.filenameNotBoundary = true;
  }

  // Explicit authored conditions (amount > 500, etc.) — MATCH predicates.
  pushPred(out, clause.conditions?.requires);

  build.pred = out.length ? out : null;
  return build;
}

/** Backwards-compatible: the bare predicate list. */
export function networkPredicate(clause: IntentClause): Predicate[] | null {
  return buildNetworkPredicate(clause).pred;
}

/* ------------------------------------------------------------------ *
 * effectiveDecision — degradation only ever moves toward BLOCK.
 * ------------------------------------------------------------------ */

/**
 * A CONSTRAIN clause whose handlers cannot be executed by the bound plane must
 * NOT forward the request intact — it falls to BLOCK. This generalizes
 * policy-core's `decisionFor()` and transform.ts's fail-closed rule to every
 * handler, not just tokenization.
 */
function effectiveDecisionFor(clause: IntentClause, plane: PlaneFrame): Decision {
  if (clause.decision !== "CONSTRAIN") return clause.decision;
  const handlers = clause.constraint?.handlers ?? [];
  // Executable = the plane implements it AND it has a target to act on. A
  // data.transform with no fields/classes would transform nothing; treating it
  // as executable here while the compiler fails it closed would make the UI
  // say CONSTRAIN and the runtime do BLOCK. Both layers must agree.
  const anyExecutable = handlers.some((h) => {
    if (!(plane.handlers.includes("*") || plane.handlers.includes(h.handler))) return false;
    if (h.handler === "data.transform") {
      const p = h.params as { fields?: unknown; classes?: unknown };
      // A named field/column can be masked whatever its class. A class-only mask
      // is executable ONLY for classes the runtime tokenizer can actually MASK —
      // the PII value types (email/phone/card/…). A class the runtime can only
      // DETECT, not mask (financial, phi, legal, a secret), is NOT maskable:
      // transform.ts drops it and fails closed. Detection ≠ transformation, so
      // the compiler must not read a mask over an unmaskable class as CONSTRAIN
      // while the runtime BLOCKs it. Both layers now agree.
      const hasFields = Array.isArray(p.fields) && p.fields.length > 0;
      const classes = Array.isArray(p.classes) ? (p.classes as string[]) : [];
      const anyMaskable = classes.some((c) => bridgeClass(c) === "pii");
      return hasFields || anyMaskable;
    }
    return true;
  });
  return anyExecutable ? "CONSTRAIN" : "BLOCK";
}

/* ------------------------------------------------------------------ *
 * resolveBinding — the entry point.
 * ------------------------------------------------------------------ */

/**
 * Resolve one clause against the deployed planes. Pure — returns a fresh
 * binding, never touches the clause.
 */
/** A genuine catch-all: any subject, any action, any resource, no facets. This
 *  is the fail-open default rule (usually an ALLOW at the lowest priority), and
 *  it is the ONE clause that legitimately matches everything. */
export function isCatchAll(c: IntentClause): boolean {
  return Boolean(c.subject.any && (c.action.any || !c.action.verbs?.length) && (c.resource.any || c.resource.type === "any")
    && !c.destination && !c.data && !c.scope && !c.conditions);
}

/**
 * Resolve a clause to its enforcement binding.
 *
 * Status is DERIVED from the Capability Registry, not hand-written. The clause
 * declares requirements; the deployed + planned planes declare capabilities;
 * deriveStatus produces the verdict. This function then turns that verdict into
 * an EnforcementBinding and compiles the network predicate. Adding a detector,
 * an identity provider, or a plane changes the outcome with NO edit here.
 *
 * `opts.routeEnforced` reflects whether the system proxy is actually on. When
 * it is off, `route.proxy_enforced` is not provided and route-dependent
 * coverage is reported honestly.
 */
export function resolveBinding(
  clause: IntentClause,
  _deployed: Set<EnforcementPlane> = new Set(["network"]),
  opts: { routeEnforced?: boolean } = {},
): EnforcementBinding {
  const reqs = requirements(clause);
  const planes = [networkCapabilities({ routeEnforced: opts.routeEnforced }), ...futurePlaneCapabilities()];
  const verdict = deriveStatus(reqs, planes);

  // Compile the network-observable predicate (only meaningful on the network plane).
  const build = buildNetworkPredicate(clause);
  const predAll = build.pred;
  const pred = predAll?.filter((p) => RUNTIME_OBSERVED_FIELDS.has(p.field)) ?? null;

  // The honest effective decision. For a clause that is NOT enforced/degraded on
  // the network today the declared decision stands (nothing is being applied
  // yet). Only a network-ENFORCED CONSTRAIN whose handler the network cannot
  // execute falls closed to BLOCK, so the UI never shows CONSTRAIN while the
  // runtime would BLOCK.
  const effNet = effectiveDecisionFor(clause, NETWORK);

  // ── Per-VALUE reality checks (distinct from capability KINDS above) ──
  // The capability model says "the network CAN observe hosts". These checks say
  // "but THIS clause's destination did not resolve" / "these specific classes
  // have no detector" — value-level facts that downgrade an otherwise-enforced
  // clause without ever silently widening it.
  const dest = resolveDestination(clause);
  const destStatedUnresolved = dest.stated && dest.hosts.length === 0 && dest.notHosts.length === 0;
  const valueGaps: string[] = [];
  let downgraded: "degraded" | "understood_only" | null = null;

  let destDrivenPlane = false;
  if (destStatedUnresolved) {
    const named = clause.destination?.namedSet ?? clause.destination?.group ?? dest.unresolved[0] ?? "the destination";
    const otherPin = (build.pred ?? []).some((p) => p.field !== "tool_input.host");
    if (otherPin) { downgraded = "degraded"; valueGaps.push(`the destination “${named}” has no addresses, so where the request went is NOT enforced — only the content/filename conditions are. Define “${named}” in the Destination Registry to close this.`); }
    else { downgraded = "understood_only"; destDrivenPlane = true; valueGaps.push(`“${named}” names a set the runtime has no addresses for — define which hosts it contains to enforce it.`); }
  }
  const declaredClasses = clause.data?.classes ?? [];
  const someObservable = (build.pred ?? []).some((p) => p.field === "tool_input.content_kinds");
  if (declaredClasses.length && !someObservable) {
    // The data class IS the security point and NONE of it is observable — a
    // host-only match would be over-broad, so this is not enforced today.
    downgraded = "understood_only";
    valueGaps.push(`${build.unobservableClasses.join(", ") || declaredClasses.join(", ")} — no registered detector recognises this; the intent is retained, not enforced`);
  } else if (build.unobservableClasses.length && someObservable) {
    downgraded = downgraded === "understood_only" ? "understood_only" : "degraded";
    valueGaps.push(`${build.unobservableClasses.join(", ")} — no registered detector recognises this, so only the observable classes are enforced`);
  }
  // A destination that PARTIALLY resolved (some members unknown to the registry)
  // is enforced on the known hosts but silently misses the unknown ones.
  if (!destStatedUnresolved && dest.unresolved.length) {
    downgraded = downgraded === "understood_only" ? "understood_only" : "degraded";
    valueGaps.push(`destination ${dest.unresolved.join(", ")} not in the registry — not part of the enforced set`);
  }
  // A network clause another transport can bypass (SQL over a raw socket, a
  // non-proxied payment rail, stdio MCP) is enforced on the observed route only.
  const bypass = NETWORK.bypass(clause);
  if (bypass && verdict.status === "enforced" && !downgraded) { downgraded = "degraded"; valueGaps.push(bypass); }

  // Apply the downgrade, but only DOWN the lattice, never up.
  if (downgraded && (verdict.status === "enforced" || verdict.status === "degraded")) {
    verdict.status = downgraded === "understood_only" ? "understood_only" : "degraded";
    if (destDrivenPlane) verdict.plannedPlane = "network"; // a destination gap is a network concern
  }

  // Enforced needs something to MATCH on. A clause that ended up "enforced"
  // with no compiled predicate can only be the genuine catch-all ALLOW (which
  // matches everything by design). Any other empty-predicate clause — a BLOCK
  // with no observable pin, say — cannot actually fire and is understood_only.
  let emptyPredGap = false;
  if (verdict.status === "enforced" && (!pred || !pred.length) && !(isCatchAll(clause) && clause.decision === "ALLOW")) {
    verdict.status = "understood_only";
    emptyPredGap = true;   // nothing observable pins this clause → the resource is the gap
  }

  const plane = (verdict.status === "pending" ? null : verdict.status === "enforced" || verdict.status === "degraded" ? (verdict.boundPlane ?? verdict.plannedPlane) : (verdict.plannedPlane ?? verdict.plane)) as EnforcementPlane | null;
  const enforceable = verdict.status === "enforced" || verdict.status === "degraded";

  // Build the human rationale + coverage gap FROM the verdict — one code path.
  const gapParts: string[] = [...new Set([...valueGaps, ...verdict.notProven.map((r) => gapText(r, clause))])];
  // A degraded network clause is also bypassable by non-proxied transports.
  if (verdict.status === "degraded" && plane === "network") {
    const bypass = NETWORK.bypass(clause);
    if (bypass) gapParts.push(bypass);
  }
  const missingText = verdict.missingButPlanned.map((r) => r.purpose).join("; ");
  const pendingText = verdict.pending.map((r) => `${r.capability} (${r.purpose})`).join("; ");

  let rationale: string;
  if (verdict.status === "enforced") {
    rationale = plane === "network"
      ? `the TLS-terminating proxy observes ${describeObservable(clause)} and enforces this before egress`
      : `every capability this needs is available on the ${plane} plane`;
  } else if (verdict.status === "degraded") {
    rationale = `enforced on the traffic Wrapbox observes; ${gapParts.join("; ")}`;
  } else if (verdict.status === "pending") {
    rationale = `no plane can host ${pendingText} — understood, surfaced, never coerced to allow or block`;
  } else { // understood_only
    rationale = plane && plane !== "network"
      ? `${describeResource(clause) || missingText || "this clause"} needs the ${plane} plane, which is not deployed yet — the intent is retained and enforces the day that plane ships`
      : `${missingText || describeResource(clause) || "this clause"} — not observable by the deployed runtime today; the intent is retained, not enforced`;
  }

  const notes: string[] = [];
  if (build.filenameNotBoundary) notes.push("file type is supporting evidence only — the content classes are the pin, so renaming a file does not defeat this rule");

  return {
    plane,
    capability: enforceable && plane === "network" ? capabilityFor(clause) : null,
    status: verdict.status,
    ...(enforceable && plane === "network" && pred?.length ? { match: pred } : {}),
    effectiveDecision: (verdict.status === "enforced" || verdict.status === "degraded") && plane === "network" ? effNet : clause.decision,
    live: verdict.status === "enforced" || verdict.status === "degraded" ? plane === "network" : false,
    ...((() => { const f = unenforcedLabels(clause, verdict, build, destStatedUnresolved, !destStatedUnresolved && dest.unresolved.length > 0, emptyPredGap); return f.length ? { unenforcedFacets: f } : {}; })()),
    ...(gapParts.length ? { coverageGap: gapParts.join("; ") } : {}),
    rationale: rationale + (notes.length ? ` · ${notes.join(" · ")}` : ""),
  };
}

/** The semantic labels for what is NOT enforced, matching how the facet reads
 *  to a human: a condition names its field, a resource names its path, an
 *  unobservable class names data.classes. */
function unenforcedLabels(clause: IntentClause, verdict: StatusVerdict, build: PredicateBuild, destUnresolved: boolean, partialDest: boolean, emptyPredGap: boolean): string[] {
  const out = new Set<string>();
  for (const r of [...verdict.notProven, ...verdict.missingButPlanned, ...verdict.pending]) {
    if (r.facet === "condition") out.add(r.capability.replace(/^observe\./, ""));
    else if (r.facet === "resource") out.add(["file", "folder", "repo", "branch"].includes(clause.resource.type ?? "") ? "resource.path" : "resource");
    else if (r.facet === "data") out.add("data.classes");
    else out.add(r.facet);
  }
  // A subject scoped to an identity the runtime cannot prove is ALWAYS surfaced
  // as unenforced — even on an otherwise-enforced protection, the subject
  // limitation is real (it applies more broadly than written).
  const s = clause.subject;
  if ((s.group?.length || s.user?.length || s.device?.length || s.workload?.length || s.agentClass?.includes("human")) && subjectUnprovable(clause)) out.add("subject");
  if (destUnresolved || partialDest) out.add("destination");
  if (emptyPredGap) out.add("resource");
  if ((clause.data?.classes?.length ?? 0) > 0 && build.unobservableClasses.length) out.add("data.classes");
  return [...out];
}

/** Is this clause's subject scope one the deployed runtime cannot verify? */
function subjectUnprovable(clause: IntentClause): boolean {
  const s = clause.subject;
  // device/workload ARE provable via enrollment; user/group/human are not.
  return Boolean(s.user?.length || s.group?.length || s.agentClass?.includes("human"));
}

/** Human text for one unmet requirement, specific to its facet. */
function gapText(r: { facet: string; purpose: string; capability: string }, clause: IntentClause): string {
  if (r.facet === "subject") {
    const who = r.purpose.replace(/^limit to /, "");
    return `the subject (${who}) cannot be verified by the runtime (no trusted identity on this plane), so this ${clause.decision === "ALLOW" ? "permission applies to all traffic from the device, not only to " + who : "applies to all subjects on this device — enforced more broadly than written, never more narrowly"}`;
  }
  if (r.facet === "destination") {
    return `the destination did not resolve to addresses, so where the request went is NOT enforced — ${r.purpose}`;
  }
  if (r.facet === "data") {
    return `${r.purpose} — no registered detector can recognise this, so only the observable classes are enforced`;
  }
  return r.purpose;
}

function capabilityFor(clause: IntentClause): string {
  if (clause.decision === "CONSTRAIN" && clause.constraint?.handlers.some((h) => h.handler === "data.transform")) return "network.egress.body_transform";
  if (clause.decision === "CONSTRAIN") return "network.egress.request_gate";
  return "network.egress.gate";
}

function describeResource(clause: IntentClause): string {
  const t = clause.resource.type ?? "resource";
  const ref = clause.resource.ref?.[0];
  return ref ? `${t} ${ref}` : t;
}

function describeObservable(clause: IntentClause): string {
  const bits: string[] = [];
  if (clause.destination) bits.push("the destination");
  if (clause.data?.classes?.length) bits.push(`body content (${clause.data.classes.join(", ")})`);
  if (clause.resource.match) bits.push("the request attributes");
  return bits.join(" and ") || "the request";
}

/** Re-resolve every clause's binding in place-free fashion — returns new clauses. */
export function resolveContract(clauses: IntentClause[], deployed?: Set<EnforcementPlane>): IntentClause[] {
  return clauses.map((c) => ({ ...c, binding: resolveBinding(c, deployed) }));
}
