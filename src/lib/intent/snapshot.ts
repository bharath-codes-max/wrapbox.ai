/**
 * The runtime snapshot the compiler judges coverage against.
 *
 * In production the control plane serves the latest `wrapboxd capabilities`
 * snapshot a device sent with its heartbeat (GET /v1/capabilities); the UI
 * loads it and calls setRuntimeSnapshot(). With nothing loaded, the compiler
 * uses a DEFAULT that mirrors a freshly installed daemon: built-in detectors
 * and Tier-0 parsers available, every optional plugin/sidecar UNAVAILABLE.
 * Defaulting to "less" is the honest direction — a clause is never reported
 * enforced because the compiler assumed a sidecar it has not seen.
 */

import { BUILTIN_DETECTORS, BUILTIN_EXTRACTORS, registryPins, type RuntimeSnapshot } from "@wrapbox/registry";

/** Detectors the daemon ships with and that need no configuration. */
const BUILTIN_AVAILABLE = new Set([
  "wrapbox.pattern.pii", "wrapbox.secrets", "wrapbox.credential_file", "wrapbox.code.heuristic",
  "wrapbox.financial", "wrapbox.phi", "wrapbox.legal", "wrapbox.confidential", "wrapbox.label.mip",
]);

export function defaultSnapshot(): RuntimeSnapshot {
  return {
    plane: "network",
    deployed: true,
    detectors: BUILTIN_DETECTORS.map((d) => ({
      id: d.id, version: d.version, available: BUILTIN_AVAILABLE.has(d.id),
      ...(BUILTIN_AVAILABLE.has(d.id) ? {} : { reason: d.tenantConfig ? `needs tenant configuration: ${d.tenantConfig}` : "plugin not loaded" }),
      emits: d.emits,
    })),
    extractors: BUILTIN_EXTRACTORS.map((e) => ({
      id: e.id, version: e.version, available: e.tier === "in_process", ...(e.tier === "in_process" ? {} : { reason: "sidecar/helper not configured" }),
      formats: e.formats as string[], canTransform: e.canTransform,
    })),
    transforms: [
      { handler: "REVERSIBLE_TOKENIZE", formats: ["text", "csv", "tsv", "json"], types: ["PII", "PCI", "GOV_ID", "FINANCIAL.ACCOUNT", "CUSTOMER", "HR.EMPLOYEE_ID", "PHI.MRN", "CUSTOM"] },
      { handler: "REDACT", formats: ["text", "csv", "tsv", "json"], types: ["PII", "PCI", "GOV_ID", "FINANCIAL.ACCOUNT", "CUSTOMER", "HR.EMPLOYEE_ID", "PHI.MRN", "CUSTOM"] },
      { handler: "MASK", formats: ["text", "csv", "tsv", "json"], types: ["PCI", "PII.CONTACT.PHONE", "FINANCIAL.ACCOUNT", "GOV_ID"] },
      { handler: "HASH", formats: ["text", "csv", "tsv", "json"], types: ["PII", "PCI", "GOV_ID", "FINANCIAL.ACCOUNT", "CUSTOMER", "HR.EMPLOYEE_ID", "PHI.MRN", "CUSTOM"] },
      { handler: "DROP_FIELD", formats: ["csv", "tsv", "json"], types: ["*"] },
      { handler: "LIMIT", formats: ["text", "csv", "tsv", "json"], types: ["*"] },
    ],
    observes: [
      "tool_name", "tool_input.host", "tool_input.port", "tool_input.path", "tool_input.method",
      "tool_input.content_kinds", "tool_input.findings", "tool_input.filenames", "tool_input.bytes", "tool_input.has_file_upload",
      "tool_input.agent", "tool_input.device_id", "tool_input.uninspected",
      "tool_input.destination_class", "tool_input.service", "tool_input.findings_v2", "tool_input.finding_types",
      "tool_input.inspection", "tool_input.uninspectable_state", "tool_input.carrier", "tool_input.extractor",
    ],
    identity: [
      { capability: "identity.device", proven: true }, { capability: "identity.workload", proven: true },
      { capability: "identity.user", proven: false }, { capability: "identity.group", proven: false },
    ],
    transport: { ports: [443], plaintextHttp: false, websocket: "fail_closed", neverDecrypt: ["PERSONAL_EXEMPT", "INFRA_EXEMPT"] },
    registryVersions: registryPins(),
  };
}

let current: RuntimeSnapshot | null = null;
let source: "default" | "device" = "default";

export function runtimeSnapshot(): RuntimeSnapshot { return current ?? defaultSnapshot(); }
export function runtimeSnapshotSource(): "default" | "device" { return source; }
export function setRuntimeSnapshot(s: RuntimeSnapshot | null): void { current = s; source = s ? "device" : "default"; }
