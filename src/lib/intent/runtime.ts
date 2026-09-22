/**
 * The canonical Runtime Capability / Observation Registry.
 *
 * ONE place that states, truthfully, what the deployed runtime can see and do.
 * The compiler may understand far richer concepts than the runtime can act on;
 * this registry is the gate between the two. Before any clause is reported
 * ENFORCED, every predicate it needs must be producible from `fields`, every
 * data class it names must bridge to a `contentKinds` the classifier actually
 * emits, every handler must be in `handlers`, and any subject scoping must be
 * verifiable — or the clause is honestly downgraded.
 *
 * Keep this in lockstep with:
 *   runtime/src/proxy.ts      decideEgress()   → fields on the ToolCall
 *   runtime/src/classify.ts   ContentKind       → contentKinds
 *   runtime/src/transform.ts                    → handlers
 *
 * The values below are what the runtime does TODAY. Adding a capability here
 * without implementing it in the runtime is exactly the lie this file exists
 * to make impossible — so do not.
 */

import type { EnforcementPlane } from "./schema";

export interface RuntimeCapabilities {
  plane: EnforcementPlane;
  deployed: boolean;
  /** Fields the runtime populates on every evaluated request. A predicate on
   *  any other field evaluates against undefined and can never match. */
  fields: ReadonlySet<string>;
  /** Coarse content kinds the classifier emits. Fine-grained semantic classes
   *  must bridge to one of these to be observable. */
  contentKinds: ReadonlySet<string>;
  /** Constraint handlers the runtime actually executes. A handler that only
   *  exists in the schema registry is NOT executable. */
  handlers: ReadonlySet<string>;
  /** Does the runtime receive trusted user/group/device identity? If not, a
   *  subject-scoped clause cannot have its subject portion enforced. */
  verifiesSubjectIdentity: boolean;
  /** Does the runtime attribute the calling process/agent (tool_input.agent)? */
  attributesAgent: boolean;
  /** Routes this plane observes; anything else is a bypass. */
  observedTransports: readonly string[];
}

export const NETWORK_RUNTIME: RuntimeCapabilities = {
  plane: "network",
  deployed: true,
  fields: new Set([
    "tool_name",
    "tool_input.host", "tool_input.path", "tool_input.method",
    "tool_input.content_kinds", "tool_input.findings", "tool_input.filenames",
    "tool_input.bytes", "tool_input.has_file_upload", "tool_input.agent", "tool_input.uninspected",
  ]),
  contentKinds: new Set(["secret", "source_code", "pii", "credential_file"]),
  handlers: new Set(["data.transform"]),
  verifiesSubjectIdentity: false,
  attributesAgent: true,
  observedTransports: ["HTTPS via the device proxy"],
};

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

export const RUNTIMES: Record<EnforcementPlane, RuntimeCapabilities> = {
  network: NETWORK_RUNTIME,
  endpoint: ENDPOINT_RUNTIME,
  gateway: GATEWAY_RUNTIME,
  resource: { plane: "resource", deployed: false, fields: new Set(["*"]), contentKinds: new Set(["*"]), handlers: new Set(["*"]), verifiesSubjectIdentity: true, attributesAgent: true, observedTransports: ["at the resource"] },
};

export const DEPLOYED_PLANES = new Set<EnforcementPlane>(
  (Object.values(RUNTIMES) as RuntimeCapabilities[]).filter((r) => r.deployed).map((r) => r.plane),
);

/* ------------------------------------------------------------------ *
 * The semantic → runtime class bridge.
 *
 * The parser may name EMAIL, PHONE, API_KEY, PRIVATE_KEY, SOURCE_CODE… The
 * classifier emits four coarse kinds. This is the ONE explicit mapping between
 * them. A class with no bridge is UNOBSERVABLE — it is returned as null, and
 * the resolver must not claim it enforced. It is never defaulted to "pii":
 * that silently turned "financial data" into a PII rule.
 * ------------------------------------------------------------------ */

const CLASS_BRIDGE: Record<string, string> = {
  // → pii
  pii: "pii", email: "pii", email_address: "pii", email_addresses: "pii", phone: "pii", phone_number: "pii",
  phone_numbers: "pii", card: "pii", credit_card: "pii", card_number: "pii", pan: "pii", ssn: "pii",
  social_security: "pii", aadhaar: "pii", name: "pii", address: "pii", dob: "pii", date_of_birth: "pii",
  customer_pii: "pii", personal_data: "pii", personal_information: "pii", account_number: "pii", customer_data: "pii",
  // → secret
  secret: "secret", secrets: "secret", credential: "secret", credentials: "secret", api_key: "secret",
  api_keys: "secret", apikey: "secret", password: "secret", passwords: "secret", token: "secret",
  auth_token: "secret", authentication_token: "secret", access_token: "secret", bearer_token: "secret",
  private_key: "secret", private_keys: "secret", client_secret: "secret", client_secrets: "secret",
  aws_key: "secret", jwt: "secret", key: "secret",
  // → source_code
  source_code: "source_code", source: "source_code", code: "source_code", sourcecode: "source_code",
  // → credential_file
  credential_file: "credential_file", env_file: "credential_file", dotenv: "credential_file",
  pem: "credential_file", keyfile: "credential_file", kubeconfig: "credential_file",
};

/** Bridge one semantic class to a runtime content kind, or null if the runtime
 *  cannot observe it. Never guesses. */
export function bridgeClass(cls: string): string | null {
  const k = cls.toLowerCase().replace(/[\s-]+/g, "_").trim();
  return Object.hasOwn(CLASS_BRIDGE, k) ? CLASS_BRIDGE[k] : null;
}

/** Split a clause's classes into observable (bridged) and unobservable. */
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
 * Plane capability self-description (§20).
 *
 * The compiler must not keep a second hard-coded list of what the runtime can
 * do. This function DERIVES a plane's capability set from the same registries
 * the daemon uses — detectors, identity providers, handlers, observed fields —
 * so there is one source of truth and no drift. In production the daemon would
 * return this over a /capabilities endpoint; in-repo we compute it from the
 * shared registries. `routeEnforced` reflects whether the system proxy is
 * actually on (only then is a scoped network rule route-covered).
 * ------------------------------------------------------------------ */

import { detectableFamilies } from "./detectors";
import { provableIdentities } from "./identity";
import type { Capability, PlaneCapabilities, PlaneName } from "./capabilities";

export function networkCapabilities(opts: { routeEnforced?: boolean } = {}): PlaneCapabilities {
  const provides = new Set<Capability>();
  provides.add("route.any");
  provides.add("route.observed");                                   // the proxy observes requests it sees
  if (opts.routeEnforced !== false) provides.add("route.proxy_enforced");
  provides.add("destination.host");                                 // observes tool_input.host

  // Content families: exactly what a registered detector can produce.
  for (const fam of detectableFamilies()) provides.add(`content.${fam}`);

  // Identity: exactly what a deployed provider can prove.
  for (const cap of provableIdentities()) provides.add(cap);

  // Transform handlers the runtime executes today.
  for (const h of NETWORK_RUNTIME.handlers) provides.add(`transform.${h}`);

  // Review: the daemon holds the socket and awaits an approval.
  provides.add("review.hold");

  // Observable authored-condition fields.
  for (const f of NETWORK_RUNTIME.fields) provides.add(`observe.${f}`);

  return { plane: "network", deployed: true, provides };
}

/** The future planes, declared so their capabilities are known (→ understood_only)
 *  but marked NOT deployed. This is what makes a repo/SQL/IAM clause resolve to
 *  understood_only mechanically rather than via a hand-written branch. */
export function futurePlaneCapabilities(): PlaneCapabilities[] {
  const mk = (plane: PlaneName, caps: string[], detectorFamilies: string[] = []): PlaneCapabilities => ({
    plane, deployed: false,
    provides: new Set<Capability>([...caps, ...detectorFamilies.map((f) => `content.${f}`)]),
  });
  return [
    mk("endpoint", ["identity.user", "identity.group", "identity.device", "observe.file.path", "observe.repo", "observe.git.branch", "transform.filesystem.allowed_paths", "transform.filesystem.operations", "transform.git.force_push", "route.proxy_enforced", "route.observed", "destination.host"], ["pii", "secret", "source_code", "credential_file"]),
    mk("gateway", ["observe.sql.statement", "observe.mcp.tool", "observe.iam.action", "transform.sql.max_rows", "transform.sql.allowed_columns", "transform.sql.blocked_statements", "transform.mcp.allowed_tools", "transform.payment.max_amount", "destination.host", "route.observed"]),
    // The resource plane is the natural home for future content intelligence:
    // it declares the enterprise data FAMILIES that are real and defensible but
    // have no detector yet (financial, PHI, PCI, legal, IP) and data ownership.
    // A clause needing one of these resolves to UNDERSTOOD_ONLY (a plane could
    // host it) rather than PENDING (nothing ever could). Register a real
    // detector and the SAME clause becomes enforced with no code change here.
    mk("resource", ["identity.user", "identity.group", "route.proxy_enforced", "route.observed", "destination.host",
                    "provenance.company", "provenance.customer", "provenance.tenant"],
       ["financial", "phi", "pci", "legal", "ip", "confidential", "regulated", "export_controlled", "employee_data", "customer_data"]),
  ];
}
