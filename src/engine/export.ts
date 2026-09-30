// ============================================================================
// Decision export — every decision record, in formats SIEMs already ingest.
//
//   OCSF 1.3.0 (schema.ocsf.io): the class follows where the action happened —
//     laptop file actions   → File System Activity (1001)
//     laptop process / cmd  → Process Activity (1007)
//     network & browser     → HTTP Activity (4002)
//     gateway & hosted      → API Activity (6003)
//   File System, Process and HTTP Activity carry the Security Control profile
//   (action_id Allowed/Denied + disposition_id). API Activity does not support
//   that profile, so there the outcome is status_id/status_detail. Wrapbox's own
//   fields (decision, rule, approver, seal) travel in `unmapped.wrapbox`.
//
//   OTLP/JSON logs (opentelemetry.io/docs/specs/otlp): lowerCamelCase keys,
//   64-bit integers (timeUnixNano) as decimal strings, enums as integers; the
//   body is the plain-language record, attributes carry the fields. POST to
//   <collector>/v1/logs with Content-Type: application/json.
//
// Pure functions: the Evidence page downloads their output as a file. Live
// streaming to a SIEM (e.g. Splunk HEC) is not built in this prototype.
// ============================================================================

import type { Decision, SimulationEvent } from "../model/types";
import { ORG, agentById, deviceById, resourceById, supplierById, userById } from "../model/org";
import { destById, mcpServerById } from "../model/registries";

export const OCSF_VERSION = "1.3.0";
const PRODUCT = { name: "Wrapbox", vendor_name: "Wrapbox", version: "prototype" };

const SEVERITY: Record<SimulationEvent["risk"], { id: number; name: string; otel: number; otelText: string }> = {
  low: { id: 2, name: "Low", otel: 9, otelText: "INFO" },
  moderate: { id: 3, name: "Medium", otel: 10, otelText: "INFO2" },
  high: { id: 4, name: "High", otel: 13, otelText: "WARN" },
  critical: { id: 5, name: "Critical", otel: 17, otelText: "ERROR" },
};

/** Did the action actually run (directly, constrained, or after an approval)? */
export function executed(e: SimulationEvent): boolean {
  if (e.decision === "ALLOW" || e.decision === "CONSTRAIN") return true;
  const r = e.reviewState?.status;
  return r === "approved" || r === "approved_scoped" || r === "constrained";
}

/** Security Control profile: action + disposition from the decision and its review. */
function disposition(e: SimulationEvent): { action_id: number; action: string; disposition_id: number; disposition: string } {
  const r = e.reviewState?.status;
  if (e.decision === "REVIEW") {
    if (r === "approved" || r === "approved_scoped") return { action_id: 1, action: "Allowed", disposition_id: 8, disposition: "Approved" };
    if (r === "constrained") return { action_id: 1, action: "Allowed", disposition_id: 99, disposition: "Constrained after review" };
    if (r === "denied" || r === "expired") return { action_id: 2, action: "Denied", disposition_id: 2, disposition: "Blocked" };
    return { action_id: 2, action: "Denied", disposition_id: 14, disposition: "Delayed" };
  }
  if (e.decision === "BLOCK") return { action_id: 2, action: "Denied", disposition_id: 2, disposition: "Blocked" };
  if (e.decision === "CONSTRAIN") return { action_id: 1, action: "Allowed", disposition_id: 99, disposition: "Constrained (payload transformed)" };
  return { action_id: 1, action: "Allowed", disposition_id: 1, disposition: "Allowed" };
}

function sentence(e: SimulationEvent): string {
  const who = userById(e.user)?.name ?? e.user;
  const agent = agentById(e.agent)?.name ?? e.agent;
  const res = resourceById(e.resource)?.name ?? e.resource;
  return `${agent} (for ${who}) ${e.action} ${e.actionRaw ? `"${e.actionRaw}" ` : ""}on ${res} in ${e.environment} → ${e.decision}${e.decidedBy ? ` — ${e.decidedBy.label}` : ""}`;
}

/** Wrapbox's own record: everything a reviewer or auditor needs, in one object. */
function wrapboxFields(e: SimulationEvent) {
  const sup = supplierById(e.operator);
  return {
    event_id: e.id,
    decision: e.decision as Decision,
    decided_by: e.decidedBy?.label,
    decided_by_layer: e.decidedBy?.layer,
    rules_matched: e.matchedContracts.map((m) => ({ contract: m.contractName, clause_id: m.clauseId, text: m.clauseText, effect: m.effect })),
    safety_kernel: e.safetyRules.map((r) => r.ruleId),
    reasons: e.decisionReasons,
    plane: e.plane,
    environment: e.environment,
    resource: resourceById(e.resource)?.name ?? e.resource,
    data_classes: e.dataClasses,
    destination: e.destination ? destById(e.destination)?.host ?? e.destination : undefined,
    destination_class: e.destinationClass,
    blast_radius: e.blastRadius?.label,
    transform: e.transformation?.length ? { kind: e.transformation[0].kind, values: e.transformation.length } : undefined,
    review: e.reviewState ? { status: e.reviewState.status, approver: e.reviewState.approver ?? undefined, reviewer: e.reviewState.reviewer ? userById(e.reviewState.reviewer)?.name ?? e.reviewState.reviewer : undefined } : undefined,
    mcp: e.mcp ? { server: mcpServerById(e.mcp.server)?.label ?? e.mcp.server, tool: e.mcp.tool, arguments: e.mcp.args, registered: e.mcp.registered } : undefined,
    delegation: e.delegation?.length ? [...e.delegation.map((h) => agentById(h.agent)?.name ?? h.agent), agentById(e.agent)?.name ?? e.agent] : undefined,
    operator: sup ? sup.name : undefined,
    untrusted_input: e.taint ? e.taint.label : undefined,
    output_check: e.outputCheck,
    task_id: e.taskId,
    break_glass: e.breakGlass || undefined,
    seal: { hash: e.evidence.hash, prev_hash: e.evidence.prevHash, note: "FNV-style chain hash — tamper-evident, not a cryptographic signature" },
  };
}

function actor(e: SimulationEvent) {
  const u = userById(e.user);
  const a = agentById(e.agent);
  return {
    user: { uid: e.user, name: u?.name ?? e.user, email_addr: u?.email },
    app_name: a?.name ?? e.agent,
    ...(e.delegation?.length ? { invoked_by: e.delegation.map((h) => agentById(h.agent)?.name ?? h.agent).join(" → ") } : {}),
  };
}

function device(e: SimulationEvent) {
  const d = deviceById(e.device);
  const hosted = agentById(e.agent)?.location && agentById(e.agent)?.location !== "laptop";
  return { type_id: hosted ? 6 : 3, type: hosted ? "Virtual" : "Laptop", uid: e.device, name: d?.name ?? e.device, hostname: d?.name ?? e.device };
}

/** One decision record as an OCSF 1.3.0 event. */
export function toOcsf(e: SimulationEvent): Record<string, unknown> {
  const sev = SEVERITY[e.risk];
  const base = {
    time: e.timestamp,
    severity_id: sev.id,
    severity: sev.name,
    message: sentence(e),
    actor: actor(e),
    unmapped: { wrapbox: wrapboxFields(e) },
  };
  const ok = executed(e);
  const plane = e.plane;
  const isProcess = plane === "ENDPOINT" && (e.action === "EXECUTE" || e.action === "SECURITY_CHANGE");
  if (plane === "ENDPOINT" && isProcess) {
    const activity = { id: 1, name: "Launch" };
    return {
      ...base, ...disposition(e),
      metadata: { version: OCSF_VERSION, product: PRODUCT, uid: e.id, profiles: ["security_control"] },
      category_uid: 1, category_name: "System Activity", class_uid: 1007, class_name: "Process Activity",
      activity_id: activity.id, activity_name: activity.name, type_uid: 1007 * 100 + activity.id,
      device: device(e),
      process: { name: (e.actionRaw ?? e.action).split(/\s+/)[0], cmd_line: e.actionRaw ?? e.action },
    };
  }
  if (plane === "ENDPOINT") {
    const activity = e.action === "READ" || e.action === "SECRET_ACCESS" ? { id: 2, name: "Read" }
      : e.action === "WRITE" ? { id: 3, name: "Update" }
      : e.action === "DELETE" ? { id: 4, name: "Delete" }
      : { id: 99, name: "Other" };
    const path = e.mcp?.args.path ?? resourceById(e.resource)?.name ?? e.resource;
    return {
      ...base, ...disposition(e),
      metadata: { version: OCSF_VERSION, product: PRODUCT, uid: e.id, profiles: ["security_control"] },
      category_uid: 1, category_name: "System Activity", class_uid: 1001, class_name: "File System Activity",
      activity_id: activity.id, activity_name: activity.name, type_uid: 1001 * 100 + activity.id,
      device: device(e),
      file: { name: path.split("/").pop() || path, path, type_id: 1, type: "Regular File" },
    };
  }
  if (plane === "NETWORK" || plane === "BROWSER") {
    const reads = e.action === "READ";
    const activity = reads ? { id: 3, name: "Get" } : { id: 6, name: "Post" };
    const host = e.destination ? destById(e.destination)?.host ?? e.destination : "unknown";
    return {
      ...base, ...disposition(e),
      metadata: { version: OCSF_VERSION, product: PRODUCT, uid: e.id, profiles: ["security_control"] },
      category_uid: 4, category_name: "Network Activity", class_uid: 4002, class_name: "HTTP Activity",
      activity_id: activity.id, activity_name: activity.name, type_uid: 4002 * 100 + activity.id,
      device: device(e),
      src_endpoint: { hostname: device(e).hostname },
      dst_endpoint: { hostname: host },
      http_request: { http_method: reads ? "GET" : "POST", url: { hostname: host, path: "/" } },
      // What the client got back: Wrapbox answers 403 when it refused or is holding the request.
      http_response: { code: ok ? 200 : 403 },
    };
  }
  // GATEWAY / HOSTED — API Activity (no Security Control profile on this class).
  const activity = e.action === "READ" || e.action === "DATA_EXPORT" ? { id: 2, name: "Read" }
    : e.action === "DELETE" ? { id: 4, name: "Delete" }
    : e.action === "WRITE" || e.action === "DEPLOY" || e.action === "PERMISSION_CHANGE" || e.action === "SECURITY_CHANGE" ? { id: 3, name: "Update" }
    : { id: 99, name: "Other" };
  const kind = resourceById(e.resource)?.kind;
  // The service provider behind the gateway call (OCSF cloud.provider).
  const VENDOR: Record<string, string> = { "GitHub MCP": "GitHub", "Stripe API": "Stripe", "Support SaaS API": "Salesforce", "AWS API": "AWS", "AgentCore Gateway": "AWS" };
  const provider = plane === "HOSTED" || kind === "cloud" ? "AWS"
    : VENDOR[e.application ?? ""] ?? (kind === "database" ? `${ORG.short} (self-hosted PostgreSQL)` : e.application ?? "Unknown");
  return {
    ...base,
    metadata: { version: OCSF_VERSION, product: PRODUCT, uid: e.id },
    category_uid: 6, category_name: "Application Activity", class_uid: 6003, class_name: "API Activity",
    activity_id: activity.id, activity_name: activity.name, type_uid: 6003 * 100 + activity.id,
    api: { operation: e.mcp ? `tools/call ${e.mcp.tool}` : e.actionRaw ?? e.action, service: { name: e.application ?? "gateway" } },
    cloud: { provider },
    src_endpoint: { hostname: device(e).hostname },
    status_id: ok ? 1 : 2,
    status: ok ? "Success" : "Failure",
    status_detail: `Wrapbox ${e.decision}${e.reviewState ? ` · review ${e.reviewState.status}` : ""}`,
  };
}

export function toOcsfBatch(events: SimulationEvent[]): Record<string, unknown>[] {
  return events.map(toOcsf);
}

type AnyValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };
const str = (key: string, v: string | undefined): { key: string; value: AnyValue }[] => (v === undefined || v === "" ? [] : [{ key, value: { stringValue: v } }]);

/** Decision records as one OTLP/JSON ExportLogsServiceRequest. */
export function toOtlpLogs(events: SimulationEvent[]): Record<string, unknown> {
  return {
    resourceLogs: [{
      resource: { attributes: [...str("service.name", "wrapbox"), ...str("service.version", "prototype")] },
      scopeLogs: [{
        scope: { name: "wrapbox.decisions", version: "1.0.0" },
        logRecords: events.map((e) => {
          const nanos = (BigInt(e.timestamp) * 1_000_000n).toString();
          const sev = SEVERITY[e.risk];
          return {
            timeUnixNano: nanos,
            observedTimeUnixNano: nanos,
            severityNumber: sev.otel,
            severityText: sev.otelText,
            body: { stringValue: sentence(e) },
            attributes: [
              ...str("wrapbox.event_id", e.id),
              ...str("wrapbox.decision", e.decision),
              ...str("wrapbox.decided_by", e.decidedBy?.label),
              ...str("wrapbox.decided_by.layer", e.decidedBy?.layer),
              ...str("wrapbox.plane", e.plane),
              ...str("wrapbox.action", e.action),
              ...str("wrapbox.action.raw", e.actionRaw),
              ...str("wrapbox.resource", resourceById(e.resource)?.name ?? e.resource),
              ...str("wrapbox.environment", e.environment),
              ...str("wrapbox.data_classes", e.dataClasses.join(",")),
              ...str("wrapbox.destination", e.destination ? destById(e.destination)?.host : undefined),
              ...str("wrapbox.destination.class", e.destinationClass),
              ...str("wrapbox.review.status", e.reviewState?.status),
              ...str("wrapbox.review.approver", e.reviewState?.approver),
              ...str("wrapbox.operator", supplierById(e.operator)?.name),
              ...str("wrapbox.delegated_via", e.delegation?.map((h) => h.agent).join(">")),
              ...str("wrapbox.output_check", e.outputCheck?.status),
              ...str("wrapbox.seal", e.evidence.hash),
              ...str("user.id", e.user),
              ...str("gen_ai.agent.id", e.agent),
              ...str("gen_ai.agent.name", agentById(e.agent)?.name),
              ...str("gen_ai.tool.name", e.mcp?.tool),
            ],
          };
        }),
      }],
    }],
  };
}
