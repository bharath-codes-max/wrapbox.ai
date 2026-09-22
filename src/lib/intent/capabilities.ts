/**
 * The Capability Registry — the scalability spine.
 *
 * Status (ENFORCED / DEGRADED / UNDERSTOOD_ONLY / PENDING) is DERIVED, never
 * hand-written. The old resolver had ~10 bespoke branches ("if FINANCIAL is
 * unbridged → understood_only", "if the subject is scoped → degraded"). Every
 * new concept needed another branch, which is exactly what does not scale.
 *
 * Instead:
 *
 *   a clause  ──requirements()──▶  RequiredCapability[]   (what it NEEDS)
 *   a fleet   ──provided by planes─▶ Set<Capability>       (what EXISTS today)
 *   deriveStatus(required, available, deployed)  ──▶  a mechanical verdict
 *
 * To make FINANCIAL enforceable tomorrow you register a `content.financial`
 * detector; the requirement for it starts being satisfied and every existing
 * contract's status improves on recompilation. No change here, in the parser,
 * or in Describe. That is acceptance criterion §27.
 *
 * A capability id is a dotted string in ONE namespace so it reads the same in
 * the compiler, the runtime self-description, and Evidence (OTel-style, §10).
 */

import type { IntentClause } from "./schema";
import { detectorsForClass } from "./detectors";
import { identityCanProve } from "./identity";
import { resolveDestination } from "./resolve-dest";
import { bridgeClass } from "./runtime";

/** A capability the enforcement fleet may or may not provide. Open namespace. */
export type Capability = string;

/**
 * One thing a clause needs in order to be enforced.
 *
 *  securityRelevant  — if this is unmet the clause CANNOT be called enforced.
 *                      An unmet non-security requirement is a note, not a gap.
 *  optional          — a nice-to-have signal (e.g. a tighter identity level);
 *                      never blocks ENFORCED on its own.
 */
export interface RequiredCapability {
  capability: Capability;
  /** What this requirement is FOR, shown in Evidence and the UI. */
  purpose: string;
  securityRelevant: boolean;
  optional?: boolean;
  /** The clause facet this came from, so a gap can name the facet. */
  facet: "subject" | "destination" | "data" | "transform" | "review" | "route" | "resource" | "condition";
  /** The plane that WOULD serve this requirement. */
  servedBy: PlaneName;
}

/* ------------------------------------------------------------------ *
 * requirements() — lower a clause to the capabilities it needs.
 *
 * This is the ONLY place a clause is turned into requirements, and it contains
 * NO status logic and NO per-concept exceptions. It asks the sub-registries
 * (detectors, identity, destinations) what would be needed; whether those are
 * available is decided later, mechanically, by deriveStatus.
 * ------------------------------------------------------------------ */

export function requirements(clause: IntentClause): RequiredCapability[] {
  const reqs: RequiredCapability[] = [];
  const R = (capability: string, purpose: string, facet: RequiredCapability["facet"], servedBy: PlaneName, securityRelevant = true) =>
    reqs.push({ capability, purpose, securityRelevant, facet, servedBy });

  // A catch-all needs nothing observable — it is the default rule.
  if (clause.subject.any && (clause.action.any || !clause.action.verbs?.length)
      && (clause.resource.any || clause.resource.type === "any")
      && !clause.destination && !clause.data && !clause.scope && !clause.conditions) {
    R("route.any", "default rule for traffic matching nothing else", "route", "network", false);
    return reqs;
  }

  // SUBJECT — identity we can PROVE. Agent-class (browser/cli) rides process
  // attribution the network HAS; only a human/user/group/device claim is hard.
  const s = clause.subject;
  const human = s.agentClass?.includes("human");
  const idSec = clause.decision === "ALLOW";   // a permission scoped to an
  // unverifiable subject WIDENS if unmet; a protection only over-covers, so
  // its subject requirement is a note, not a security gap.
  if (s.user?.length) R("identity.user", `limit to user ${s.user.join("/")}`, "subject", "endpoint", idSec);
  if (s.group?.length || human) R("identity.group", `limit to ${s.group?.join("/") ?? "human users"}`, "subject", "endpoint", idSec);
  if (s.device?.length) R("identity.device", `limit to device ${s.device.join("/")}`, "subject", "endpoint", idSec);
  if (s.workload?.length) R("identity.workload", `limit to workload ${s.workload.join("/")}`, "subject", "endpoint", idSec);

  // DESTINATION — the KIND question: can the plane observe request hosts? The
  // network can (destination.host). Whether THIS destination's value resolved
  // is a per-value check applied after status (resolveBinding).
  const dest = resolveDestination(clause);
  const hasDestination = dest.stated;
  if (hasDestination) R("destination.host", "restrict where the request may go", "destination", "network");

  // RESOURCE — a local/gateway object is only observable on its owning plane,
  // BUT only when the action acts on it IN PLACE. A file/repo being uploaded or
  // sent to a destination is a network PAYLOAD (pinned by destination+content),
  // not a local filesystem event — so the resource requirement is emitted only
  // for a local, non-transmission action with no destination.
  const t = clause.resource.type ?? "any";
  // A resource is a NETWORK payload iff it is being sent to a destination; with
  // no destination it is a LOCAL operation on its owning plane. The verb does
  // not decide this — "query a table" with no destination is a local DB read.
  const localAct = !hasDestination;
  const contentPinned = (clause.data?.classes?.length ?? 0) > 0;  // content is the pin, not the path
  if (localAct && !contentPinned && ["file", "folder", "repo", "branch"].includes(t)) R("observe.resource.path", `see the ${t} path/ref`, "resource", "endpoint");
  // A local database operation: a READ/QUERY can ride an HTTP data API
  // (network-observable in principle), while a mutation (write/delete/DDL) is a
  // direct database action brokered by the gateway.
  else if (localAct && ["table", "database", "db_statement", "schema", "column", "dataset"].includes(t)) {
    const rv = clause.action.verbs?.[0] ?? "";
    R("observe.resource.sql", `see the ${t}`, "resource", rv === "query" ? "network" : "gateway");
  }
  else if (["iam_role", "cloud_resource"].includes(t)) R("observe.resource.iam", `see the ${t}`, "resource", "gateway");
  // A payment has an authoritative-settlement property no observed request proves.
  else if (localAct && ["payment_transaction", "payment_method"].includes(t)) R("observe.resource.payment", `authoritatively settle the ${t}`, "resource", "network");
  else if (localAct && t === "mcp_tool") R("observe.resource.mcp", "parse the MCP tool + arguments", "resource", "network");

  // DATA — each class needs a DETECTOR for its family. detectableFamilies()
  // answers; a known-but-undetected family (financial) is planned → understood_only;
  // an unknown family is served by nobody → pending.
  for (const cls of clause.data?.classes ?? []) R(`content.${classFamily(cls)}`, `recognise ${cls}`, "data", "network");
  if (clause.data?.owner) R(`provenance.${String(clause.data.owner).toLowerCase()}`, `prove the data belongs to ${clause.data.owner}`, "data", "network");

  // TRANSFORM — a CONSTRAIN handler must be EXECUTABLE.
  if (clause.decision === "CONSTRAIN") for (const h of clause.constraint?.handlers ?? []) R(`transform.${h.handler}`, `apply ${h.handler}`, "transform", handlerPlane(h.handler));

  // REVIEW — hold-and-approve. The network daemon has it.
  if (clause.decision === "REVIEW") R("review.hold", "hold the request until a human decides", "review", "network");

  // CONDITIONS — an authored predicate needs its field observed.
  for (const pr of predsOf(clause.conditions?.requires)) {
    const observed = NETWORK_OBSERVED.has(pr.field);
    R(`observe.${pr.field}`, `evaluate ${pr.field}`, "condition", "network", true);
    void observed;
  }

  // ROUTE — non-security signal that the request traverses a path we control.
  R("route.observed", "the request must traverse a path Wrapbox controls", "route", "network", false);
  return reqs;
}

/** Which plane executes a given constraint handler. */
function handlerPlane(handler: string): PlaneName {
  if (handler.startsWith("data.")) return "network";
  if (handler.startsWith("http.") || handler.startsWith("api.")) return "network";
  if (handler.startsWith("filesystem.") || handler.startsWith("git.")) return "endpoint";
  if (handler.startsWith("payment.")) return "network";
  if (handler.startsWith("sql.") || handler.startsWith("mcp.")) return "gateway";
  return "network";
}

/** Fields the deployed network runtime populates (mirrors runtime.ts). */
const NETWORK_OBSERVED = new Set<string>([
  "tool_name", "tool_input.host", "tool_input.path", "tool_input.method",
  "tool_input.content_kinds", "tool_input.findings", "tool_input.filenames",
  "tool_input.bytes", "tool_input.has_file_upload", "tool_input.agent",
]);

/** Map a fine-grained semantic class to its detector FAMILY (the capability
 *  a detector registers). Families are open — a new one is just a new string. */
export function classFamily(cls: string): string {
  const c = cls.toLowerCase().replace(/[\s-]+/g, "_").trim();
  // First the runtime-observable families, via the same synonym table the
  // classifier honours (email/customer_pii/… → pii, credentials/secrets → secret,
  // cards → pii because the deterministic detector emits pii for card numbers).
  const bridged = bridgeClass(c);
  if (bridged) return bridged;
  // Then enterprise families that are real but not yet detected.
  const EXT: Record<string, string> = {
    financial: "financial", revenue: "financial", finance: "financial",
    phi: "phi", health: "phi", medical: "phi", patient: "phi",
    pci: "pci", card_data: "pci",
    legal: "legal", contract: "legal", nda: "legal",
    ip: "ip", intellectual_property: "ip", trade_secret: "ip",
    confidential: "confidential", restricted: "confidential", internal_only: "confidential",
    regulated: "regulated", export_controlled: "export_controlled",
    employee_data: "employee_data", customer_data: "pii", m_and_a: "m_and_a", merger_acquisition: "m_and_a",
  };
  return Object.hasOwn(EXT, c) ? EXT[c] : c; // unknown → its own family (→ pending)
}


/* ------------------------------------------------------------------ *
 * deriveStatus — the mechanical verdict. NO per-concept branches.
 * ------------------------------------------------------------------ */

export type PlaneName = "network" | "endpoint" | "gateway" | "resource";
export type Status = "enforced" | "degraded" | "understood_only" | "pending";

export interface PlaneCapabilities {
  plane: PlaneName;
  deployed: boolean;
  /** The capability ids this plane provides RIGHT NOW. */
  provides: Set<Capability>;
}

export interface StatusVerdict {
  status: Status;
  plane: PlaneName | null;
  met: RequiredCapability[];
  /** Security-relevant reqs a deployed plane cannot meet but is on-route for → degraded. */
  notProven: RequiredCapability[];
  /** Security-relevant reqs a NON-deployed plane could serve → understood_only. */
  missingButPlanned: RequiredCapability[];
  /** Reqs no plane could ever serve → pending. */
  pending: RequiredCapability[];
  boundPlane: PlaneName | null;
  plannedPlane: PlaneName | null;
}

/** Known enterprise data families we acknowledge as real and defensible, so a
 *  clause needing one is understood_only (a detector could exist) rather than
 *  pending. Open — add a family string and existing contracts improve when its
 *  detector registers. */
const KNOWN_FAMILIES = new Set<string>([
  "pii", "secret", "source_code", "credential_file",
  "financial", "phi", "pci", "legal", "ip", "confidential", "regulated",
  "export_controlled", "employee_data", "customer_data", "health", "m_and_a",
]);

/**
 * Is a capability KNOWN-BUT-UNBUILT (some plane or future detector could serve
 * it) as opposed to genuinely unknown? Uses prefixes so dynamic ids
 * (provenance.<owner>, transform.<handler>, observe.<field>) are handled
 * without enumerating them.
 */
function isPlanned(cap: Capability): boolean {
  if (cap.startsWith("content.")) return true;   // any named data class is a plannable detector
  if (cap.startsWith("provenance.")) return true;                 // provenance detectors are planned
  if (cap.startsWith("observe.resource.")) return true;           // endpoint/gateway resource observation
  if (cap.startsWith("observe.tool_input.")) return true;         // richer body-field extraction is planned
  if (cap.startsWith("observe.")) return true;                    // future signals generally
  if (cap.startsWith("identity.")) return true;                   // IdP/MDM integrations
  if (cap.startsWith("transform.")) return isKnownHandler(cap.slice("transform.".length));
  if (cap.startsWith("destination.")) return true;
  if (cap.startsWith("route.")) return true;
  return false;
}

/** Handlers the schema registry knows (executable now or on a future plane).
 *  An unknown handler is genuinely unknown → pending. */
function isKnownHandler(handler: string): boolean {
  return KNOWN_HANDLERS.has(handler);
}
const KNOWN_HANDLERS = new Set<string>([
  "data.transform", "http.allowed_methods", "api.allowed_endpoints",
  "sql.max_rows", "sql.allowed_columns", "sql.blocked_statements",
  "mcp.allowed_tools", "mcp.argument_constraints", "payment.max_amount",
  "filesystem.allowed_paths", "filesystem.operations", "git.force_push",
]);

/**
 * The mechanical verdict. `deployed` is the set of capabilities the deployed
 * fleet provides right now (the network plane's self-description). Everything
 * else is decided by isPlanned(). No per-concept branches.
 */
export function deriveStatus(reqs: RequiredCapability[], deployedPlanes: PlaneCapabilities[]): StatusVerdict {
  const security = reqs.filter((r) => r.securityRelevant && !r.optional);
  const net = deployedPlanes.find((p) => p.deployed);
  const deployed = net?.provides ?? new Set<Capability>();

  // Trivially enforced: nothing security-relevant to prove.
  if (security.length === 0) {
    return { status: "enforced", plane: net?.plane ?? "network", met: [], notProven: [], missingButPlanned: [], pending: [], boundPlane: net?.plane ?? "network", plannedPlane: null };
  }

  const met = security.filter((r) => deployed.has(r.capability));
  const unmet = security.filter((r) => !deployed.has(r.capability));
  const pending = unmet.filter((r) => !isPlanned(r.capability));
  const planned = unmet.filter((r) => isPlanned(r.capability));

  // A resource the deployed plane cannot observe DOMINATES: you cannot enforce a
  // rule about an object you cannot see, whatever incidental mechanisms exist.
  const resourceGap = unmet.find((r) => r.facet === "resource");
  if (pending.length === 0 && resourceGap) {
    return { status: "understood_only", plane: resourceGap.servedBy, met: [], notProven: [], missingButPlanned: planned, pending: [], boundPlane: null, plannedPlane: resourceGap.servedBy };
  }

  // "On route" means the deployed plane meets a PINNING facet (what identifies
  // which request), not merely a mechanism like review.hold.
  const PIN: RequiredCapability["facet"][] = ["destination", "data", "condition", "resource"];
  const onRoute = met.some((r) => PIN.includes(r.facet)) || (met.length > 0 && unmet.every((r) => !PIN.includes(r.facet)));

  const notProven = onRoute ? planned : [];
  const missingButPlanned = onRoute ? [] : planned;
  const dominant = (planned.find((r) => PIN.includes(r.facet)) ?? planned[0] ?? pending[0]);
  const plannedPlane = dominant?.servedBy ?? null;

  let status: Status;
  if (pending.length) status = "pending";
  else if (unmet.length === 0) status = "enforced";
  else if (onRoute) status = "degraded";
  else status = "understood_only";

  const boundPlane: PlaneName | null = (status === "enforced" || status === "degraded") ? (net?.plane ?? "network") : null;
  const plane = status === "pending" ? null : (boundPlane ?? plannedPlane);
  return { status, plane, met, notProven, missingButPlanned, pending, boundPlane, plannedPlane };
}

interface P { field: string; op: string; value: unknown }
function predsOf(x: unknown): P[] {
  if (!x) return [];
  return (Array.isArray(x) ? x : [x]) as P[];
}
