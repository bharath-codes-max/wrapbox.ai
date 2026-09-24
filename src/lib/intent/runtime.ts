/**
 * The compiler's view of the deployed network runtime.
 *
 * Nothing here is a hand-kept list any more. Fields, content vocabulary and
 * detector availability come from the runtime SNAPSHOT (`wrapboxd
 * capabilities`, relayed by the control plane) and the shared registries;
 * the class bridge is the Data Type Registry's alias index. A capability
 * that the deployed runtime does not report is not provided — the compiler
 * cannot claim what it has not been told.
 */

import { dataTypes, TRANSFORM_HANDLERS, type RuntimeSnapshot } from "@wrapbox/registry";
import type { EnforcementPlane } from "./schema";
import { availableEmissions } from "./detectors";
import { provableIdentities } from "./identity";
import { runtimeSnapshot } from "./snapshot";
import type { Capability, PlaneCapabilities, PlaneName } from "./capabilities";

export interface RuntimeCapabilities {
  plane: EnforcementPlane;
  deployed: boolean;
  fields: ReadonlySet<string>;
  contentKinds: ReadonlySet<string>;
  handlers: ReadonlySet<string>;
  verifiesSubjectIdentity: boolean;
  attributesAgent: boolean;
  observedTransports: readonly string[];
}

function fieldsFrom(s: RuntimeSnapshot): Set<string> { return new Set(s.observes); }

/** The network runtime as currently reported. Re-evaluated on every call so a
 *  freshly loaded device snapshot takes effect immediately. */
export function networkRuntime(): RuntimeCapabilities {
  const s = runtimeSnapshot();
  return {
    plane: "network",
    deployed: s.deployed,
    fields: fieldsFrom(s),
    contentKinds: new Set([...new Set(dataTypes().all().map((d) => d.legacyKind).filter((k): k is string => !!k))]),
    handlers: new Set(["data.transform"]),
    verifiesSubjectIdentity: s.identity.some((i) => i.capability === "identity.user" && i.proven),
    attributesAgent: s.observes.includes("tool_input.agent"),
    observedTransports: [`HTTPS on TCP ${s.transport.ports.join("/")} via the device proxy${s.transport.plaintextHttp ? " + plain HTTP" : ""}`],
  };
}

/** Kept as a stable name for existing imports; always reflects the current snapshot. */
export const NETWORK_RUNTIME: RuntimeCapabilities = new Proxy({} as RuntimeCapabilities, {
  get: (_t, prop) => (networkRuntime() as unknown as Record<string | symbol, unknown>)[prop],
});

export const ENDPOINT_RUNTIME: RuntimeCapabilities = {
  plane: "endpoint", deployed: false,
  fields: new Set(["process.identity", "file.path", "repo", "git.branch", "exec.argv"]),
  contentKinds: new Set(["secret", "source_code", "pii", "credential_file"]),
  handlers: new Set(["filesystem.allowed_paths", "filesystem.operations", "git.force_push"]),
  verifiesSubjectIdentity: true, attributesAgent: true,
  observedTransports: ["local filesystem", "process exec"],
};

export const GATEWAY_RUNTIME: RuntimeCapabilities = {
  plane: "gateway", deployed: false,
  fields: new Set(["sql.statement", "api.endpoint", "mcp.tool", "mcp.args", "iam.action", "payment.amount"]),
  contentKinds: new Set(),
  handlers: new Set(["sql.max_rows", "sql.allowed_columns", "sql.blocked_statements", "mcp.allowed_tools", "mcp.argument_constraints", "api.allowed_endpoints", "http.allowed_methods", "payment.max_amount"]),
  verifiesSubjectIdentity: true, attributesAgent: true,
  observedTransports: ["brokered API/DB/cloud calls"],
};

export const DEPLOYED_PLANES = new Set<EnforcementPlane>(["network"]);

/* ------------------------------------------------------------------ *
 * The semantic → registry bridge. ONE implementation: the registry's alias
 * index. A phrase that resolves to nothing is unobservable; it is never
 * defaulted to "pii".
 * ------------------------------------------------------------------ */

/** Registry id for a phrase or id, or null. */
export function resolveTypeId(cls: string): string | null {
  const r = dataTypes().resolve(cls);
  return r ? r.id : null;
}

/** The coarse runtime kind (wire compat) a class reduces to, or null if unresolvable. */
export function bridgeClass(cls: string): string | null {
  const id = resolveTypeId(cls);
  return id ? dataTypes().legacyKind(id) : null;
}

export function bridgeClasses(classes: string[]): { kinds: string[]; unobservable: string[] } {
  const kinds = new Set<string>();
  const unobservable: string[] = [];
  for (const c of classes) {
    const k = bridgeClass(c);
    if (k) kinds.add(k); else unobservable.push(c);
  }
  return { kinds: [...kinds], unobservable };
}

/* ------------------------------------------------------------------ *
 * Plane capability self-description — derived from the snapshot.
 * ------------------------------------------------------------------ */

export function networkCapabilities(opts: { routeEnforced?: boolean } = {}): PlaneCapabilities {
  const s = runtimeSnapshot();
  const provides = new Set<Capability>();
  provides.add("route.any");
  provides.add("route.observed");
  if (opts.routeEnforced !== false) provides.add("route.proxy_enforced");
  if (s.observes.includes("tool_input.host")) provides.add("destination.host");
  if (s.observes.includes("tool_input.destination_class")) provides.add("destination.class");

  // Content: exactly what an AVAILABLE detector emits, with its confidence.
  for (const e of availableEmissions()) provides.add(`content.${e.type}:${e.confidence}`);
  // Parsers: formats an available extractor reads.
  for (const x of s.extractors) if (x.available) for (const f of x.formats) provides.add(`parse.${f}`);
  // Transforms the runtime executes, per handler and type prefix.
  for (const t of s.transforms) for (const ty of t.types) provides.add(`transform.${t.handler}.${ty}`);
  provides.add("transform.data.transform");   // legacy handler name (mapped to the registry handlers above)

  for (const cap of provableIdentities()) provides.add(cap);
  for (const i of s.identity) if (i.proven) provides.add(i.capability);
  provides.add("review.hold");
  for (const f of s.observes) provides.add(`observe.${f}`);
  return { plane: "network", deployed: s.deployed, provides };
}

/** The future planes, declared so their capabilities are known (→ understood_only)
 *  but marked NOT deployed. */
export function futurePlaneCapabilities(): PlaneCapabilities[] {
  const mk = (plane: PlaneName, caps: string[]): PlaneCapabilities => ({ plane, deployed: false, provides: new Set<Capability>(caps) });
  return [
    mk("endpoint", ["identity.user", "identity.group", "identity.device", "observe.file.path", "observe.repo", "observe.git.branch", "transform.filesystem.allowed_paths", "transform.filesystem.operations", "transform.git.force_push", "route.proxy_enforced", "route.observed", "destination.host"]),
    mk("gateway", ["observe.sql.statement", "observe.mcp.tool", "observe.iam.action", "transform.sql.max_rows", "transform.sql.allowed_columns", "transform.sql.blocked_statements", "transform.mcp.allowed_tools", "transform.payment.max_amount", "destination.host", "route.observed"]),
    // The resource plane is where every REGISTERED-but-undetected data type is
    // plannable: a clause naming one is UNDERSTOOD_ONLY (a detector could be
    // registered) rather than PENDING. Register a detector → the SAME clause is
    // enforced on the network with no change here.
    mk("resource", ["identity.user", "identity.group", "route.proxy_enforced", "route.observed", "destination.host", "provenance.company", "provenance.customer", "provenance.tenant", "provenance.employee", "provenance.patient", ...dataTypes().ids().map((t) => `content.${t}:high`)]),
  ];
}

export { TRANSFORM_HANDLERS };
