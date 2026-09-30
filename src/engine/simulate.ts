// ============================================================================
// Simulator — turns a Scenario into a SimulationEvent via the Core Brain,
// applying transforms (with Token Vault entries), building the evidence chain
// and the pipeline trace the Simulation Lab renders step by step.
// ============================================================================

import { decide, mcpToolName, type ActionRequest } from "./brain";
import type { Scenario } from "./scenarios";
import type {
  AgentStop, AgentTaint, Decision, DetectorFinding, Environment, EvidenceRecord, IntentContract, InspectionResult,
  ResultSeal, SimulationEvent, StandingPermission, TaskEnvelope, TransformStep, VaultToken,
} from "../model/types";
import { detectorFor, destById, mcpServerById, planeLabel } from "../model/registries";
import { agentById, deviceForAction, resourceById, supplierById, userById } from "../model/org";
import type { KernelState } from "./kernel";

let tokenCounter = 0;
export function setTokenCounter(n: number) { tokenCounter = n; }
export function getTokenCounter() { return tokenCounter; }

function nextToken(dataClass: string): string {
  tokenCounter += 1;
  const family = dataClass.split(".").pop() ?? "DATA";
  return `${family}_TOKEN_${String(tokenCounter).padStart(3, "0")}`;
}

export function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function buildInspection(sc: Scenario): InspectionResult | undefined {
  if (sc.uninspectable) {
    return { inspectable: false, reason: sc.uninspectable.reason, findings: [] };
  }
  if (!sc.findings || sc.findings.length === 0) {
    if (sc.payload !== undefined) {
      return { inspectable: true, parser: "text/plain", findings: [] };
    }
    return undefined;
  }
  const findings: DetectorFinding[] = sc.findings.map((f) => {
    const det = detectorFor(f.dataClass);
    return {
      dataClass: f.dataClass,
      detector: det?.id ?? "generic-v1",
      detectorVersion: det?.version ?? "1.0.0",
      confidence: f.dataClass.startsWith("CREDENTIAL.") ? 1.0 : f.dataClass === "PII.NAME" ? 0.94 : 0.99,
      sample: f.sample,
      count: f.count,
    };
  });
  const parser = sc.fileName?.endsWith(".csv") ? "csv-parser-v2"
    : sc.fileName?.endsWith(".yaml") ? "yaml-parser-v1"
    : sc.fileName?.endsWith(".json") ? "json-parser-v1"
    : sc.fileName ? "text-parser-v1" : "inline-text";
  return { inspectable: true, parser, findings };
}

// Apply a transform to the payload; returns transformed payload + steps + tokens.
function applyTransform(
  sc: Scenario,
  kind: string,
  classes: string[],
  eventId: string
): { after: string; steps: TransformStep[]; tokens: VaultToken[] } {
  const steps: TransformStep[] = [];
  const tokens: VaultToken[] = [];
  let after = sc.payload ?? "";

  const patterns: Record<string, RegExp> = {
    "PII.EMAIL": /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "PII.PHONE": /\+1 \d{3} \d{3} \d{4}/g,
    "CUSTOM.CUSTOMER_ID": /VRD-CUST-\d{4}/g,
    "FINANCIAL.ACCOUNT": /ACCT-\d{8}/g,
    "HR.COMPENSATION": /\$\d[\d,]*/g,
    "HEALTH.PHI": /MRN-\d+/g,
  };

  for (const cls of classes) {
    const re = patterns[cls];
    if (!re) continue;
    after = after.replace(re, (m) => {
      if (kind === "REVERSIBLE_TOKENIZE") {
        const tok = nextToken(cls);
        steps.push({ kind: "REVERSIBLE_TOKENIZE", dataClass: cls, before: m, after: tok, tokenId: tok });
        tokens.push({
          id: tok, dataClass: cls, createdAt: Date.now(),
          scope: "veridian-internal",
          expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
          restorable: true, eventId,
        });
        return tok;
      }
      if (kind === "REDACT") {
        const red = `[REDACTED:${cls.split(".").pop()}]`;
        steps.push({ kind: "REDACT", dataClass: cls, before: m, after: red });
        return red;
      }
      const masked = m.slice(0, 2) + "•".repeat(Math.max(0, m.length - 4)) + m.slice(-2);
      steps.push({ kind: "MASK", dataClass: cls, before: m, after: masked });
      return masked;
    });
  }
  return { after, steps, tokens };
}

export interface SimOutcome {
  event: SimulationEvent;
  tokens: VaultToken[];
}

let seq = 0;
export function setSeq(n: number) { seq = n; }
export function getSeq() { return seq; }

export function runScenario(
  sc: Scenario,
  contracts: IntentContract[],
  prevHash: string,
  opts?: {
    breakGlass?: { resource: string; environment: Environment }; timestamp?: number; kernel?: KernelState;
    envelope?: TaskEnvelope; standing?: StandingPermission[];
    stops?: AgentStop[]; // agents stopped everywhere (kill switch)
    taint?: AgentTaint;  // untrusted content this agent read recently
  }
): SimOutcome {
  seq += 1;
  const id = `evt-${String(seq).padStart(5, "0")}`;
  const inspection = buildInspection(sc);

  const req: ActionRequest = {
    plane: sc.plane,
    action: sc.action,
    actionRaw: sc.actionRaw,
    agent: sc.agent,
    user: sc.user,
    resource: sc.resource,
    environment: sc.environment,
    destinationClass: sc.destinationClass,
    inspection,
    context: {
      environment: sc.environment,
      resourceSensitivity: sc.sensitivity,
      privileged: sc.privileged ?? false,
      businessHours: true,
    },
    blastRadius: sc.blast
      ? { ...sc.blast }
      : undefined,
    breakGlass: opts?.breakGlass,
    kernel: opts?.kernel,
    envelope: opts?.envelope,
    standing: opts?.standing,
    now: opts?.timestamp ?? Date.now(),
    stops: opts?.stops,
    mcp: sc.mcp,
    delegation: sc.delegation,
    taint: opts?.taint && opts.taint.agent === sc.agent ? opts.taint : undefined,
    claims: sc.claims,
  };

  const result = decide(req, contracts);

  let transformation: TransformStep[] | undefined;
  let payloadAfter: string | undefined;
  let tokens: VaultToken[] = [];
  if (result.decision === "CONSTRAIN" && result.transform && sc.payload) {
    const t = applyTransform(sc, result.transform, result.transformClasses, id);
    transformation = t.steps;
    payloadAfter = t.after;
    tokens = t.tokens;
  }

  const userN = userById(sc.user)?.name ?? sc.user;
  const agentN = agentById(sc.agent)?.name ?? sc.agent;
  const resN = resourceById(sc.resource)?.name ?? sc.resource;
  const destN = sc.destination ? destById(sc.destination)?.label ?? sc.destination : undefined;

  const supplier = supplierById(agentById(sc.agent)?.operator);
  const chain: EvidenceRecord["chain"] = [
    { label: "User", detail: userN },
    ...(sc.delegation && sc.delegation.length > 0
      ? [{ label: "Delegated via", detail: [...sc.delegation.map((h) => `${agentById(h.agent)?.name ?? h.agent} (${h.asked})`), agentN].join(" → ") }]
      : []),
    { label: "Agent", detail: supplier ? `${agentN} — operated by ${supplier.name} (supplier)` : agentN },
    ...(sc.application ? [{ label: "Tool", detail: sc.application }] : []),
    { label: "Action", detail: `${sc.action}${sc.actionRaw ? ` — ${sc.actionRaw}` : ""}` },
    ...(sc.mcp ? [{ label: "MCP tool call", detail: `${mcpToolName(sc.mcp)}(${Object.entries(sc.mcp.args).map(([k, v]) => `${k}: ${v}`).join(", ")}) · ${mcpServerById(sc.mcp.server)?.label ?? sc.mcp.server}` }] : []),
    { label: "Resource", detail: resN },
    ...(req.taint ? [{ label: "Read before this", detail: `Untrusted: ${req.taint.label}` }] : []),
    ...(sc.untrustedRead ? [{ label: "Untrusted content read", detail: sc.untrustedRead.label }] : []),
    ...(inspection && inspection.inspectable && inspection.findings.length > 0
      ? [{ label: "Findings", detail: inspection.findings.map((f) => `${f.dataClass}×${f.count}`).join(", ") }]
      : []),
    ...(inspection && !inspection.inspectable
      ? [{ label: "Inspection", detail: `UNINSPECTABLE — ${inspection.reason}` }]
      : []),
    ...(destN ? [{ label: "Destination", detail: `${destN} (${sc.destinationClass})` }] : []),
    ...(result.safetyRules.length > 0
      ? [{ label: "Safety Kernel", detail: result.safetyRules.map((s) => s.name).join(", ") }]
      : []),
    ...(result.safetyObserved.length > 0
      ? [{ label: "Safety Kernel (observing)", detail: `Would have blocked: ${result.safetyObserved.map((s) => s.name).join(", ")} — not enforced yet` }]
      : []),
    ...(result.matchedContracts.length > 0
      ? [{ label: "Rules matched", detail: `${result.matchedContracts.length} Intent Contract rule(s)` }]
      : []),
    ...(result.outputCheck ? [{ label: "Output check", detail: result.outputCheck.claims.map((c) => `${c.field}: agent says ${c.claimed}${c.sealed !== undefined ? `, sealed ${c.sealed}` : ", nothing sealed"} — ${c.ok ? "matches" : "does not match"}`).join(" · ") }] : []),
    { label: "Decided by", detail: result.decidedBy.label },
    { label: "Decision", detail: result.decision },
    ...(transformation && transformation.length > 0
      ? [{ label: "Transform", detail: `${transformation.length} value(s) ${transformation[0].kind.toLowerCase().replaceAll("_", " ")}d` }]
      : []),
    { label: "Enforcement", detail: planeLabel(sc.plane) },
  ];

  const ts = opts?.timestamp ?? Date.now();
  // The seal covers the facts of the decision (who, which agent, what, where, what
  // was decided and by which layer, what left) plus the previous seal — change any
  // of them and this record, and every one after it, stops matching.
  const device = deviceForAction(sc.agent, sc.user);
  // Newer facts are sealed only when present, so older records' seals are unchanged.
  const extra = [
    ...(sc.mcp ? [`mcp:${mcpToolName(sc.mcp)}:${JSON.stringify(sc.mcp.args)}`] : []),
    ...(sc.delegation?.length ? [`via:${sc.delegation.map((h) => h.agent).join(">")}`] : []),
    ...(supplier ? [`operator:${supplier.id}`] : []),
    ...(result.outputCheck ? [`output:${result.outputCheck.status}`] : []),
  ];
  const hash = simpleHash(JSON.stringify([
    prevHash, id, ts, sc.user, device, sc.agent, sc.plane, sc.action, sc.actionRaw ?? "", sc.resource, sc.environment,
    sc.destination ?? "", result.decision, result.decidedBy.label, payloadAfter ?? sc.payload ?? "", ...extra,
  ]));
  // The system of record's answer is sealed when the action actually ran.
  const executed = result.decision === "ALLOW" || result.decision === "CONSTRAIN";
  const resultSeal: ResultSeal | undefined = sc.resultSeal && executed
    ? { ...sc.resultSeal, hash: simpleHash(`${sc.resultSeal.source}|${sc.resultSeal.field}|${sc.resultSeal.value}`) }
    : undefined;

  const event: SimulationEvent = {
    id,
    seq,
    timestamp: ts,
    scenario: sc.id,
    user: sc.user,
    // The action happens on the person's own laptop (identity: user + their device + agent).
    device,
    agent: sc.agent,
    application: sc.application,
    plane: sc.plane,
    action: sc.action,
    actionRaw: sc.actionRaw,
    resource: sc.resource,
    environment: sc.environment,
    destination: sc.destination,
    destinationClass: sc.destinationClass,
    dataClasses: inspection?.findings.map((f) => f.dataClass) ?? [],
    inspection,
    matchedContracts: result.matchedContracts,
    safetyRules: result.safetyRules,
    safetyObserved: result.safetyObserved.length ? result.safetyObserved : undefined,
    decidedBy: result.decidedBy,
    context: req.context,
    blastRadius: req.blastRadius,
    capabilityState: inspection && !inspection.inspectable ? "UNINSPECTABLE" : "ENFORCED",
    decision: result.decision,
    decisionReasons: result.reasons,
    safeAlternative: result.safeAlternative,
    transformation,
    payloadBefore: sc.payload,
    payloadAfter,
    reviewState:
      result.decision === "REVIEW"
        ? {
            status: "pending",
            expiresAt: ts + 4 * 3600 * 1000,
            safeAlternative: result.safeAlternative,
          }
        : undefined,
    status:
      result.decision === "BLOCK" ? "blocked"
      : result.decision === "REVIEW" ? "pending_review"
      : result.decision === "CONSTRAIN" ? "transformed"
      : "completed",
    risk: result.risk,
    // Stamped only when the override actually changed the outcome.
    breakGlass: result.decidedBy.layer === "breakglass" ? true : undefined,
    evidence: { eventId: id, hash, prevHash, chain },
    mcp: sc.mcp,
    delegation: sc.delegation,
    operator: supplier?.id,
    taint: req.taint,
    outputCheck: result.outputCheck,
    untrustedRead: sc.untrustedRead,
    resultSeal,
  };

  return { event, tokens };
}

// Pipeline trace for animated Simulation Lab rendering.
export interface PipelineRuleItem {
  text: string;
  source: string; // contract name, or "Safety Kernel"
  effect: Decision;
  decided: boolean; // true for the rule that produced the final decision
}

export interface PipelineStage {
  key: string;
  label: string;
  detail: string;
  tone: "neutral" | "info" | "good" | "warn" | "bad";
  items?: PipelineRuleItem[]; // every rule the Core Brain checked (brain stage only)
}

export function pipelineFor(sc: Scenario, ev: SimulationEvent): PipelineStage[] {
  const stages: PipelineStage[] = [];
  const agentN = agentById(sc.agent)?.name ?? sc.agent;
  const destN = sc.destination ? destById(sc.destination)?.label : undefined;

  stages.push({
    key: "origin",
    label: sc.plane === "NETWORK" ? "Browser prepares request"
      : sc.plane === "ENDPOINT" ? (sc.mcp ? "Agent calls a local MCP tool" : "Agent issues local action")
      : sc.plane === "BROWSER" ? "Browser agent acts on a page"
      : sc.plane === "HOSTED" ? "Hosted agent calls a tool"
      : sc.mcp ? "Agent calls an MCP tool" : "Agent calls gateway",
    detail: sc.actionRaw ?? `${agentN} → ${sc.action}`,
    tone: "neutral",
  });
  if (sc.delegation && sc.delegation.length > 0) {
    stages.push({
      key: "delegation",
      label: "Delegation chain",
      detail: `${[...sc.delegation.map((h) => agentById(h.agent)?.name ?? h.agent), agentN].join(" → ")} · every agent in the chain is checked`,
      tone: "info",
    });
  }
  stages.push({
    key: "intercept",
    label:
      sc.plane === "NETWORK" ? "Wrapbox Network plane intercepts traffic"
      : sc.plane === "ENDPOINT" ? (sc.mcp ? "Wrapbox endpoint shim holds the stdio tool call" : "Wrapbox Endpoint plane holds the action")
      : sc.plane === "BROWSER" ? "Wrapbox browser extension holds the page action"
      : sc.plane === "HOSTED" ? "Wrapbox REQUEST interceptor holds the tool call (AgentCore Gateway)"
      : sc.mcp ? "Wrapbox MCP gateway holds tools/call" : "Wrapbox Gateway receives the operation",
    detail: "Action normalized before anything executes",
    tone: "info",
  });
  if (sc.action !== "EXECUTE" || sc.findings) {
    stages.push({
      key: "normalize",
      label: "Action normalization",
      detail: `${sc.actionRaw ?? sc.action} → ${sc.action}`,
      tone: "info",
    });
  }
  if (sc.mcp) {
    stages.push({
      key: "mcp",
      label: `MCP tools/call · ${mcpServerById(sc.mcp.server)?.registered ? "registered server" : "UNREGISTERED server"}`,
      detail: `${mcpToolName(sc.mcp)} · arguments ${Object.entries(sc.mcp.args).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
      tone: sc.mcp.registered ? "info" : "warn",
    });
  }
  const sup = supplierById(agentById(sc.agent)?.operator);
  if (sup) {
    stages.push({ key: "supplier", label: "Supplier agent", detail: `Operated by ${sup.name} · contract until ${sup.contractEnds} · scope: ${sup.scopeActions.join("/")} on ${sup.scopeResources.map((r) => resourceById(r)?.name ?? r).join(", ")}`, tone: "info" });
  }
  if (ev.taint) {
    stages.push({ key: "taint", label: "Untrusted content read earlier", detail: `${ev.taint.label} — this agent is under closer watch for ${Math.max(0, Math.round((ev.taint.expiresAt - ev.timestamp) / 60000))} more min`, tone: "warn" });
  }
  if (ev.untrustedRead) {
    stages.push({ key: "untrusted", label: "Untrusted content", detail: `${ev.untrustedRead.label} — reading is allowed; the agent's next risky action will need a person`, tone: "warn" });
  }
  if (ev.outputCheck) {
    stages.push({
      key: "output",
      label: `Output check: ${ev.outputCheck.status}`,
      detail: ev.outputCheck.claims.map((c) => `${c.field}: agent says ${c.claimed}${c.sealed !== undefined ? ` · sealed ${c.sealed} (${c.source})` : " · nothing sealed to compare"}`).join(" · "),
      tone: ev.outputCheck.status === "MATCH" ? "good" : "warn",
    });
  }
  if (ev.destinationClass) {
    stages.push({
      key: "dest",
      label: "Destination classification",
      detail: `${destN ?? "endpoint"} → ${ev.destinationClass}`,
      tone: ev.destinationClass === "UNKNOWN_EXTERNAL" || ev.destinationClass === "UNAPPROVED_AI" ? "warn" : "info",
    });
  }
  if (ev.inspection) {
    if (!ev.inspection.inspectable) {
      stages.push({ key: "inspect", label: "Content inspection", detail: `UNINSPECTABLE — ${ev.inspection.reason}`, tone: "warn" });
    } else if (ev.inspection.findings.length > 0) {
      stages.push({
        key: "inspect",
        label: `Content inspection (${ev.inspection.parser})`,
        detail: ev.inspection.findings.map((f) => `${f.dataClass} ×${f.count} (${f.detector}, ${(f.confidence * 100).toFixed(0)}%)`).join(" · "),
        tone: "warn",
      });
    } else {
      stages.push({ key: "inspect", label: "Content inspection", detail: "No sensitive findings", tone: "good" });
    }
  }
  if (ev.blastRadius) {
    stages.push({ key: "blast", label: "Blast-radius assessment", detail: ev.blastRadius.label, tone: ev.blastRadius.severity === "low" ? "info" : "warn" });
  }
  // Every rule the brain checked, with the one that decided marked.
  const d = ev.decidedBy;
  const items: PipelineRuleItem[] = [
    ...ev.matchedContracts.map((m) => ({
      text: m.clauseText,
      source: m.contractName,
      effect: m.effect ?? "ALLOW",
      decided: d?.layer === "contract" && d.clauseId === m.clauseId,
    })),
    ...ev.safetyRules.map((r) => ({
      text: r.name,
      source: "Safety Kernel",
      effect: "BLOCK" as Decision,
      decided: d?.layer === "safety" && d.ruleId === r.ruleId,
    })),
    ...(ev.safetyObserved ?? []).map((r) => ({
      text: `${r.name} — would have blocked (observing, not enforced yet)`,
      source: "Safety Kernel · new rule in observe mode",
      effect: "BLOCK" as Decision,
      decided: false,
    })),
  ];
  const ruleCount = items.length;
  stages.push({
    key: "brain",
    label: "Core Brain evaluation",
    detail:
      ruleCount === 0
        ? "No Intent Contract rule or safety rule applies to this action"
        : `Checked ${ruleCount} matching rule${ruleCount === 1 ? "" : "s"} — the strictest one wins`,
    tone: "info",
    items: ruleCount > 0 ? items : undefined,
  });
  stages.push({
    key: "decision",
    label: `Decision: ${ev.decision}`,
    detail: d ? `Decided by ${d.label}` : ev.decisionReasons[0] ?? "",
    tone: ev.decision === "ALLOW" ? "good" : ev.decision === "CONSTRAIN" ? "info" : ev.decision === "REVIEW" ? "warn" : "bad",
  });
  if (ev.transformation && ev.transformation.length > 0) {
    stages.push({
      key: "transform",
      label: `Transform applied: ${ev.transformation[0].kind}`,
      detail: ev.transformation.slice(0, 3).map((t) => `${t.before} → ${t.after}`).join(" · ") + (ev.transformation.length > 3 ? ` +${ev.transformation.length - 3} more` : ""),
      tone: "info",
    });
  }
  stages.push({
    key: "outcome",
    label:
      ev.decision === "BLOCK" ? "Blocked before execution"
      : ev.decision === "REVIEW" ? "Parked pending review"
      : ev.decision === "CONSTRAIN" ? "Safe payload continues to destination"
      : "Action proceeds",
    detail:
      ev.decision === "BLOCK"
        ? (ev.plane === "NETWORK" || ev.plane === "BROWSER" ? "Destination did NOT receive the data" : "The action never executed")
        : ev.decision === "REVIEW" ? "Waiting in Review Center; independent work continues"
        : ev.decision === "CONSTRAIN" ? "Original values never left the device"
        : "Executed within policy",
    tone: ev.decision === "ALLOW" || ev.decision === "CONSTRAIN" ? "good" : ev.decision === "REVIEW" ? "warn" : "bad",
  });
  stages.push({
    key: "evidence",
    label: "Evidence recorded",
    detail: `${ev.id} · chain hash ${ev.evidence.hash}${ev.resultSeal ? ` · result sealed: ${ev.resultSeal.field} = ${ev.resultSeal.value} (${ev.resultSeal.hash})` : ""}`,
    tone: "neutral",
  });
  return stages;
}
