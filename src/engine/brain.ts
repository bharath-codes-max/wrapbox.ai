// ============================================================================
// Core Brain — the single deterministic decision engine.
// Every plane (Endpoint / Network / Gateway / Browser / Hosted) calls decide()
// with a normalized ActionRequest. Precedence:
//   agent stopped (kill switch) — nothing overrides it
//   > explicit enterprise forbid (BLOCK clause)
//   > safety invariant (Safety Kernel)
//   > supplier contract scope (supplier-operated agents)
//   > enterprise constrain / review
//   > blast-radius governor
//   > context escalation
//   > injection-aware escalation (agent just read untrusted content)
//   > output check (agent's claims vs results sealed at the gateway)
//   > task envelope / standing permission
//   > enterprise permit / default
// Agent-to-agent delegation: every agent in the chain is decided too and the
// strictest answer wins, so authority can never grow along the chain.
// UNINSPECTABLE content with an applicable fail-closed protected clause fails
// closed — inability to inspect is never "clean".
// ============================================================================

import type {
  ActionVerb, AgentStop, AgentTaint, BlastRadius, ContractClause, Decision, DelegationHop, DestinationClass,
  DecidedBy, Environment, EventContext, IntentContract, InspectionResult, MatchedClause, McpCall, OutputCheck,
  SafetyRuleHit, StandingPermission, TaskEnvelope, TransformKind,
} from "../model/types";
import { BASELINE_KERNEL, kernelHits, type KernelFacts, type KernelState } from "./kernel";
import { ORG, agentById, resourceById, supplierActive, supplierById, userById } from "../model/org";
import { mcpServerById } from "../model/registries";

export interface ActionRequest {
  plane: "ENDPOINT" | "NETWORK" | "GATEWAY" | "BROWSER" | "HOSTED";
  action: ActionVerb;
  actionRaw?: string;
  agent: string;
  user: string;
  resource: string;
  environment: Environment;
  destinationClass?: DestinationClass;
  inspection?: InspectionResult; // content inspection result if content involved
  context: EventContext;
  blastRadius?: BlastRadius;
  envelope?: TaskEnvelope | null;
  breakGlass?: { resource: string; environment: Environment }; // active emergency override scope
  kernel?: KernelState; // installed Safety Kernel pack (defaults to the baseline)
  standing?: StandingPermission[]; // agents' everyday authority (not used inside a task)
  now?: number; // decision time (observe windows)
  stops?: AgentStop[]; // agents stopped everywhere (kill switch)
  mcp?: McpCall; // the MCP tools/call, when the action is one
  delegation?: DelegationHop[]; // agents upstream of req.agent, originating agent first
  taint?: AgentTaint; // untrusted content this agent read recently
  claims?: { field: string; claimed: string; sealed?: string; source?: string }[]; // output check
}

export interface BrainResult {
  decision: Decision;
  reasons: string[];
  matchedContracts: MatchedClause[];
  safetyRules: SafetyRuleHit[];
  safetyObserved: SafetyRuleHit[]; // observe-mode kernel rules that would have fired
  decidedBy: DecidedBy;
  transform?: TransformKind;
  transformClasses: string[];
  safeAlternative?: string;
  risk: "low" | "moderate" | "high" | "critical";
  outputCheck?: OutputCheck;
  /** Per-agent decisions along a delegation chain (originating agent first). */
  chain?: { agent: string; decision: Decision; decidedBy: DecidedBy }[];
}

/** How far an agent may delegate before a person has to look at the chain. */
export const MAX_DELEGATION_HOPS = 3;
/** How long reading untrusted content keeps an agent under closer watch. */
export const INJECTION_WINDOW_MIN = 30;

/** Verbs that can move data out, destroy, change authority or reach production. */
export function isRiskyAction(action: ActionVerb, environment: Environment): boolean {
  if (["NETWORK_SEND", "DATA_EXPORT", "DELETE", "DEPLOY", "PERMISSION_CHANGE", "SECURITY_CHANGE", "SECRET_ACCESS"].includes(action)) return true;
  return action === "WRITE" && !["development", "test", "local"].includes(environment);
}

const SENSITIVE_FOR_SUPPLIER = (c: string) =>
  c.startsWith("PII.") || c.startsWith("FINANCIAL.") || c.startsWith("PCI.") || c.startsWith("HEALTH.") || c === "CUSTOM.CUSTOMER_ID";

// ---------------------------------------------------------------------------
// Safety Kernel — the Wrapbox-managed, versioned rule pack lives in kernel.ts.
// Enforcing rules change the decision; observing rules (just installed from
// an update) are recorded as "would have blocked" only.
// ---------------------------------------------------------------------------

function kernelFacts(req: ActionRequest): KernelFacts {
  return {
    action: req.action,
    actionRaw: req.actionRaw,
    environment: req.environment,
    destinationClass: req.destinationClass,
    dataClasses: req.inspection?.findings.map((f) => f.dataClass) ?? [],
    sensitivity: req.context.resourceSensitivity,
    rows: req.blastRadius?.rows,
    severity: req.blastRadius?.severity,
  };
}

// ---------------------------------------------------------------------------
// Blast-Radius Governor — quantitative thresholds (blueprint §26).
// ---------------------------------------------------------------------------

export const BLAST_LIMITS = {
  files: 25,
  rows: 500,
  exportRows: 500, // above → review; ≥100k → safety kernel mass export
  spendUsd: 20,
  recipients: 20,
};

function blastGovernor(req: ActionRequest): { escalate: Decision | null; reason?: string } {
  const b = req.blastRadius;
  if (!b) return { escalate: null };
  if (b.files !== undefined && b.files > BLAST_LIMITS.files) {
    return { escalate: "REVIEW", reason: `File-change budget exceeded: ${b.files} > ${BLAST_LIMITS.files} files` };
  }
  if (b.rows !== undefined && req.action === "DATA_EXPORT" && b.rows > BLAST_LIMITS.exportRows) {
    return {
      escalate: b.rows >= 100_000 ? "BLOCK" : "REVIEW",
      reason: `Row export exceeds budget: ${fmt(b.rows)} > ${BLAST_LIMITS.exportRows} rows`,
    };
  }
  if (b.rows !== undefined && req.action === "READ" && b.rows > BLAST_LIMITS.rows) {
    return { escalate: "REVIEW", reason: `Row read exceeds budget: ${fmt(b.rows)} > ${BLAST_LIMITS.rows} rows` };
  }
  if (b.spendUsd !== undefined && b.spendUsd > BLAST_LIMITS.spendUsd) {
    return { escalate: "REVIEW", reason: `Money / spend exceeds budget: $${fmt(b.spendUsd)} > $${BLAST_LIMITS.spendUsd}` };
  }
  if (b.recipients !== undefined && b.recipients > BLAST_LIMITS.recipients) {
    return {
      escalate: b.recipients >= 1000 ? "BLOCK" : "REVIEW",
      reason: `Recipient count exceeds budget: ${fmt(b.recipients)} > ${BLAST_LIMITS.recipients}`,
    };
  }
  return { escalate: null };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Contract matching
// ---------------------------------------------------------------------------

/** The qualified name rules use for an MCP tool: "<server short>.<tool>". */
export function mcpToolName(m: McpCall): string {
  return `${mcpServerById(m.server)?.short ?? m.server}.${m.tool}`;
}

function mcpMatches(rule: NonNullable<ContractClause["mcp"]>, m: McpCall | undefined): boolean {
  if (!m) return false;
  if (rule.registered !== undefined && rule.registered !== m.registered) return false;
  if (rule.tools && rule.tools.length > 0 && !rule.tools.some((t) => t === m.tool || t === mcpToolName(m))) return false;
  for (const [key, pattern] of Object.entries(rule.args ?? {})) {
    const v = m.args[key];
    if (v === undefined) return false;
    let re: RegExp;
    try { re = new RegExp(pattern); } catch { return false; }
    if (!re.test(v)) return false;
  }
  return true;
}

function clauseMatches(cl: ContractClause, req: ActionRequest, classes: string[]): boolean {
  if (cl.mcp && !mcpMatches(cl.mcp, req.mcp)) return false;
  if (cl.actions !== "ANY" && !cl.actions.includes(req.action)) return false;
  if (cl.environments && !cl.environments.includes(req.environment)) return false;
  if (cl.destinations !== "ANY") {
    if (!req.destinationClass) {
      // Destination-scoped clauses only apply to flows that have a destination
      if (req.action === "NETWORK_SEND" || req.action === "DATA_EXPORT") return false;
      // Endpoint clauses (e.g. secret read) list destinations "ANY" normally;
      // a destination-scoped clause without a destination in request: no match
      return false;
    }
    if (!cl.destinations.includes(req.destinationClass)) return false;
  }
  if (cl.dataClasses.length > 0) {
    if (!classes.some((c) => cl.dataClasses.includes(c))) return false;
  }
  return true;
}

// Does a protected (fail-closed) clause *potentially* apply if we cannot
// inspect content? Match everything except data classes.
function protectedClausePotentiallyApplies(cl: ContractClause, req: ActionRequest): boolean {
  if (!cl.failClosed || cl.dataClasses.length === 0) return false;
  if (cl.mcp && !mcpMatches(cl.mcp, req.mcp)) return false;
  if (cl.actions !== "ANY" && !cl.actions.includes(req.action)) return false;
  if (cl.environments && !cl.environments.includes(req.environment)) return false;
  if (cl.destinations !== "ANY") {
    if (!req.destinationClass) return false;
    if (!cl.destinations.includes(req.destinationClass)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// decide() — the single decision function.
// ---------------------------------------------------------------------------

const DECISION_RANK: Record<Decision, number> = { ALLOW: 0, CONSTRAIN: 1, REVIEW: 2, BLOCK: 3 };

const nameOf = (agent: string) => agentById(agent)?.name ?? agent;

export function decide(req: ActionRequest, contracts: IntentContract[]): BrainResult {
  // 0. Kill switch: a stopped agent is refused on every plane — before any rule,
  //    and nothing (rules, approvals, break-glass) lifts it except a resume.
  const stopped = (agent: string) => (req.stops ?? []).find((x) => x.active && x.agent === agent);
  const stopHit = [req.agent, ...(req.delegation ?? []).map((h) => h.agent)].map((a) => ({ a, st: stopped(a) })).find((x) => x.st);
  if (stopHit) {
    const who = userById(stopHit.st!.by)?.name ?? stopHit.st!.by;
    const viaChain = stopHit.a !== req.agent ? ` (it is in this request's delegation chain)` : "";
    const label = `Kill switch — ${nameOf(stopHit.a)} was stopped everywhere by ${who}${viaChain}`;
    return {
      decision: "BLOCK", reasons: [`${label}: "${stopHit.st!.reason}". Every action by this agent is refused until someone resumes it.`],
      matchedContracts: [], safetyRules: [], safetyObserved: [], transformClasses: [],
      decidedBy: { layer: "killswitch", label }, risk: "high",
      safeAlternative: "Resume the agent from Agent Inventory once the incident is understood; the stop and the resume are both recorded.",
    };
  }

  const own = decideOne(req, contracts);
  let result = own;

  // Delegation: decide the same action as if each upstream agent did it itself.
  // The strictest answer wins — a helper can never do more than whoever asked.
  const hops = req.delegation ?? [];
  if (hops.length > 0) {
    const chain = hops.map((h) => {
      const r = decideOne({ ...req, agent: h.agent, delegation: undefined, taint: req.taint?.agent === h.agent ? req.taint : undefined, claims: undefined }, contracts);
      return { agent: h.agent, decision: r.decision, decidedBy: r.decidedBy, reasons: r.reasons };
    });
    const unregistered = hops.find((h) => { const a = agentById(h.agent); return !a || a.discovered; });
    const strictest = chain.reduce((w, c) => (DECISION_RANK[c.decision] > DECISION_RANK[w.decision] ? c : w), { agent: req.agent, decision: own.decision, decidedBy: own.decidedBy, reasons: [] as string[] });
    const reasons = [...own.reasons];
    let decision = own.decision;
    let decidedBy = own.decidedBy;
    const path = [...hops.map((h) => nameOf(h.agent)), nameOf(req.agent)].join(" → ");
    reasons.push(`Delegation chain: ${path} — every agent in the chain was checked.`);
    if (unregistered) {
      decision = "BLOCK";
      decidedBy = { layer: "delegation", label: `Delegation — ${nameOf(unregistered.agent)} in the chain is not a registered agent` };
      reasons.push(`Delegation: ${nameOf(unregistered.agent)} is unregistered; an unknown agent cannot pass authority along a chain.`);
    } else if (strictest.agent !== req.agent && DECISION_RANK[strictest.decision] > DECISION_RANK[decision]) {
      decision = strictest.decision;
      decidedBy = { layer: "delegation", label: `Delegation — ${nameOf(strictest.agent)} asked ${nameOf(req.agent)}, but ${nameOf(strictest.agent)} itself would get ${strictest.decision}: ${strictest.decidedBy.label}` };
      reasons.push(`Delegation: authority cannot grow along the chain — ${nameOf(strictest.agent)} would get ${strictest.decision} for this action itself.`);
    }
    if (hops.length > MAX_DELEGATION_HOPS && DECISION_RANK[decision] < DECISION_RANK.REVIEW) {
      decision = "REVIEW";
      decidedBy = { layer: "delegation", label: `Delegation — ${hops.length + 1} agents deep; chains longer than ${MAX_DELEGATION_HOPS + 1} need a person` };
      reasons.push(`Delegation: the chain is ${hops.length + 1} agents deep (limit ${MAX_DELEGATION_HOPS + 1}).`);
    }
    result = {
      ...own, decision, decidedBy, reasons,
      chain: [...chain.map((c) => ({ agent: c.agent, decision: c.decision, decidedBy: c.decidedBy })), { agent: req.agent, decision: own.decision, decidedBy: own.decidedBy }],
      risk: riskOf(req, decision, own.safetyRules.length > 0),
      transform: decision === "CONSTRAIN" ? own.transform : undefined,
      safeAlternative: decision === own.decision ? own.safeAlternative : suggestAlternative(req),
    };
  }

  // Break-glass override: only inside its chosen scope (one resource in one
  // environment), only for REVIEW/BLOCK from company rules, limits or
  // authority — never a Safety Kernel hit, a supplier's contract, an unknown
  // agent in a chain, or a stopped agent (handled above).
  const bg = req.breakGlass;
  if (bg && (result.decision === "REVIEW" || result.decision === "BLOCK")) {
    const inScope = bg.resource === req.resource && bg.environment === req.environment;
    const liftable = result.safetyRules.length === 0 && !["supplier", "delegation", "uninspectable"].includes(result.decidedBy.layer)
      && !agentById(req.agent)?.operator;
    if (inScope && liftable) {
      return {
        ...result, decision: "ALLOW", decidedBy: { layer: "breakglass", label: "Break-glass emergency override" },
        reasons: [...result.reasons, "BREAK-GLASS override: executed under emergency authority for this scope; recorded and time-limited."],
      };
    } else if (inScope) {
      return {
        ...result,
        reasons: [...result.reasons, result.safetyRules.length > 0
          ? "Break-glass is active for this scope, but the Safety Kernel never yields to an override."
          : "Break-glass is active for this scope, but it never overrides a supplier's contract or an unregistered agent."],
      };
    }
  }
  return result;
}

/** One agent's decision on one action — everything except the kill switch,
 *  delegation and break-glass, which decide() applies around it. */
function decideOne(req: ActionRequest, contracts: IntentContract[]): BrainResult {
  const reasons: string[] = [];
  const matched: MatchedClause[] = [];
  const classes = req.inspection?.inspectable
    ? req.inspection.findings.map((f) => f.dataClass)
    : [];

  const active = contracts.filter((c) => c.status === "ACTIVE");

  // 0. Break-glass: scoped emergency override downgrades REVIEW/BLOCK → ALLOW
  //    with loud evidence, applied at the END so reasons still show.

  // 1. UNINSPECTABLE + applicable fail-closed protected clause → fail closed.
  if (req.inspection && !req.inspection.inspectable) {
    const applicable = active.flatMap((c) =>
      c.clauses.filter((cl) => protectedClausePotentiallyApplies(cl, req)).map((cl) => ({ c, cl }))
    );
    if (applicable.length > 0) {
      for (const { c, cl } of applicable) {
        matched.push({ contractId: c.id, contractName: c.name, clauseId: cl.id, clauseText: cl.text, effect: cl.effect });
      }
      reasons.push(
        `Content is UNINSPECTABLE (${req.inspection.reason ?? "unknown format"}) and a protected requirement applies — failing closed.`
      );
      return finish(req, {
        decision: "BLOCK", reasons, matchedContracts: matched, safetyRules: [], safetyObserved: [],
        decidedBy: { layer: "uninspectable", label: `Fail closed — content could not be inspected (${req.inspection.reason ?? "unknown format"})` },
        transformClasses: [], risk: "high",
        safeAlternative: "Provide the content in an inspectable format, or request a scoped exception.",
      });
    }
    reasons.push(`Content is UNINSPECTABLE (${req.inspection.reason ?? "unknown"}); no protected clause applies to this flow.`);
  }

  // 2. Collect matched clauses.
  let contractDecision: Decision = "ALLOW";
  let transform: TransformKind | undefined;
  let transformClasses: string[] = [];
  let safeAlternative: string | undefined;

  for (const c of active) {
    for (const cl of c.clauses) {
      if (!clauseMatches(cl, req, classes)) continue;
      matched.push({ contractId: c.id, contractName: c.name, clauseId: cl.id, clauseText: cl.text, effect: cl.effect });
      if (DECISION_RANK[cl.effect] > DECISION_RANK[contractDecision]) {
        contractDecision = cl.effect;
      }
      if (cl.effect === "CONSTRAIN" && cl.transform) {
        transform = cl.transform;
        transformClasses = [...new Set([...transformClasses, ...cl.dataClasses.filter((dc) => classes.includes(dc))])];
      }
      if (cl.effect === "BLOCK") {
        reasons.push(`Enterprise forbid: "${cl.text}" (${c.name})`);
      } else if (cl.effect === "REVIEW") {
        reasons.push(`Enterprise review requirement: "${cl.text}" (${c.name})`);
      } else if (cl.effect === "CONSTRAIN") {
        reasons.push(`Enterprise constraint: "${cl.text}" (${c.name})`);
      }
    }
  }

  // Which contract clause produced contractDecision: the first matched clause
  // carrying the highest-ranked effect (matching the max() above).
  const topClause = matched.find((m) => m.effect === contractDecision);
  let decidedBy: DecidedBy = topClause
    ? { layer: "contract", clauseId: topClause.clauseId, label: `"${topClause.clauseText}" (${topClause.contractName})` }
    : { layer: "default", label: "No rule restricts this action" };

  // 3. Safety Kernel.
  const { enforced: safety, observed: safetyObserved } = kernelHits(kernelFacts(req), req.kernel ?? BASELINE_KERNEL, req.now ?? Date.now());
  for (const s of safety) reasons.push(`Safety Kernel: ${s.name} — ${s.description}`);
  for (const s of safetyObserved) reasons.push(`Safety Kernel (observing, not enforced yet): ${s.name} would have blocked this.`);

  // 4. Combine per precedence: explicit forbid > safety invariant > constrain > review.
  //    An explicit enterprise BLOCK keeps the credit when both apply.
  let decision: Decision = contractDecision;
  if (safety.length > 0 && decision !== "BLOCK") {
    decision = "BLOCK";
    decidedBy = { layer: "safety", ruleId: safety[0].ruleId, label: `Safety Kernel — ${safety[0].name}` };
  }

  // 4b. Supplier-operated agent: its contract is its authority. No active
  //     contract, or anything outside the contracted scope, is refused.
  const agentDef = agentById(req.agent);
  const supplier = supplierById(agentDef?.operator);
  if (supplier && decision !== "BLOCK") {
    const resName = resourceById(req.resource)?.name ?? req.resource;
    const why = !supplierActive(supplier, req.now ?? Date.now())
      ? `the contract with ${supplier.name} ended ${supplier.contractEnds}; its agents hold no authority`
      : !supplier.scopeResources.includes(req.resource)
        ? `${resName} is outside the contract with ${supplier.name}`
        : !supplier.scopeActions.includes(req.action)
          ? `${req.action} is outside the contract with ${supplier.name} (${supplier.scopeActions.join(", ")} only)`
          : !supplier.dpa && classes.some(SENSITIVE_FOR_SUPPLIER)
            ? `${supplier.name} has no data processing agreement for personal or financial data`
            : undefined;
    if (why) {
      decision = "BLOCK";
      decidedBy = { layer: "supplier", label: `Supplier agent — ${why}` };
      reasons.push(`Supplier agent (${supplier.name}): ${why}.`);
    } else {
      reasons.push(`Supplier agent (${supplier.name}): within its contracted scope.`);
    }
  }

  // 5. Blast-Radius Governor (cannot downgrade, only escalate).
  const blast = blastGovernor(req);
  if (blast.escalate && DECISION_RANK[blast.escalate] > DECISION_RANK[decision]) {
    decision = blast.escalate;
    decidedBy = { layer: "blast", label: `Blast-Radius Governor — ${blast.reason}` };
    reasons.push(`Blast-Radius Governor: ${blast.reason}`);
  } else if (blast.reason) {
    reasons.push(`Blast-Radius Governor noted: ${blast.reason}`);
  }

  // 6. Context escalation: privileged/production sensitivity raises risk;
  //    destructive verbs in production without explicit clause still review.
  if (
    decision === "ALLOW" &&
    req.environment === "production" &&
    (req.action === "DELETE" || req.action === "DEPLOY" || req.action === "PERMISSION_CHANGE")
  ) {
    decision = "REVIEW";
    decidedBy = { layer: "context", label: `Context Engine — ${req.action} in production requires authorization` };
    reasons.push(
      `Context Engine: ${req.action} in production against ${req.context.resourceSensitivity} resource requires authorization.`
    );
  }

  // 6b. Injection-aware: this agent read untrusted content moments ago, so its
  //     next risky action waits for a person — whatever it says it is doing.
  const t = req.taint;
  if (t && t.agent === req.agent && (req.now ?? Date.now()) < t.expiresAt && isRiskyAction(req.action, req.environment)
      && DECISION_RANK[decision] < DECISION_RANK.REVIEW) {
    const mins = Math.max(0, Math.round(((req.now ?? Date.now()) - t.at) / 60000));
    decision = "REVIEW";
    decidedBy = { layer: "injection", label: `Injection-aware — ${nameOf(req.agent)} read untrusted content (${t.label}) ${mins} min ago; its next risky action needs a person` };
    reasons.push(`Injection-aware: ${nameOf(req.agent)} read ${t.label} ${mins} min ago. Content it read may be steering it, so ${req.action} waits for a person.`);
  }

  // 6c. Output check: what the agent claims must match the result Wrapbox
  //     sealed at the gateway when the real system answered.
  let outputCheck: OutputCheck | undefined;
  if (req.claims && req.claims.length > 0) {
    const norm = (v: string) => v.replace(/[\s,]/g, "").toLowerCase();
    const claims = req.claims.map((c) => ({ ...c, ok: c.sealed !== undefined && norm(c.sealed) === norm(c.claimed) }));
    const bad = claims.find((c) => c.sealed !== undefined && !c.ok);
    const unverifiable = claims.find((c) => c.sealed === undefined);
    outputCheck = { status: bad ? "MISMATCH" : unverifiable ? "UNVERIFIABLE" : "MATCH", claims };
    if ((bad || unverifiable) && DECISION_RANK[decision] < DECISION_RANK.REVIEW) {
      decision = "REVIEW";
      decidedBy = bad
        ? { layer: "output", label: `Output check — the agent says ${bad.field} = ${bad.claimed}, but ${bad.source ?? "the system of record"} returned ${bad.sealed}` }
        : { layer: "output", label: `Output check — nothing sealed to verify ${unverifiable!.field} = ${unverifiable!.claimed} against` };
    }
    for (const c of claims) {
      reasons.push(c.sealed === undefined
        ? `Output check: ${c.field} = ${c.claimed} could not be verified (no sealed result).`
        : c.ok ? `Output check: ${c.field} = ${c.claimed} matches the sealed result from ${c.source}.`
          : `Output check: ${c.field} = ${c.claimed} does NOT match the sealed result from ${c.source} (${c.sealed}).`);
    }
  }

  // 7. Task Envelope: outside-envelope actions escalate.
  if (req.envelope && req.envelope.status === "active") {
    const env = req.envelope;
    const resName = resourceById(req.resource)?.name ?? req.resource;
    // A scoped approval earlier in this task widens the envelope for that
    // resource + environment only, and only for this task.
    const granted = (env.grants ?? []).some((g) => g.resource === req.resource && g.environment === req.environment);
    const expired = (req.now ?? Date.now()) > env.startedAt + env.durationMin * 60_000;
    const resourceAllowed = granted || env.allowedResources.some((r) => req.resource.includes(r) || r.includes(req.resource));
    const actionAllowed = granted || env.allowedActions.includes(req.action);
    const forbidden = !granted && env.forbidden.some((f) => req.resource.toLowerCase().includes(f.toLowerCase()) || req.environment === f);
    if (granted) reasons.push(`Task Envelope: a scoped approval earlier in "${env.title}" covers ${resName} in ${req.environment}.`);
    if (expired && DECISION_RANK[decision] < DECISION_RANK.REVIEW) {
      decision = "REVIEW";
      decidedBy = { layer: "envelope", label: `Task Envelope — the ${env.durationMin}-minute window for "${env.title}" has expired` };
      reasons.push(`Task Envelope: the ${env.durationMin}-minute window has expired — re-authorization required.`);
    }
    if (forbidden) {
      if (DECISION_RANK[decision] < DECISION_RANK.REVIEW) {
        decision = "REVIEW";
        decidedBy = { layer: "envelope", label: `Task Envelope — ${resName} (${req.environment}) is outside this task's permission slip` };
      }
      if (DECISION_RANK[decision] < DECISION_RANK.BLOCK) {
        reasons.push(`Task Envelope: ${resName} in ${req.environment} is outside the permission slip for "${env.title}".`);
      }
    } else if (!resourceAllowed || !actionAllowed) {
      if (decision === "ALLOW") {
        decision = "REVIEW";
        decidedBy = { layer: "envelope", label: `Task Envelope — ${req.action} on ${resName} is outside this task's permission slip` };
        reasons.push(`Task Envelope: ${req.action} on ${resName} is outside the permission slip for "${env.title}" — needs a yes.`);
      }
    }
    if (env.filesUsed >= env.fileBudget && req.action === "WRITE" && decision === "ALLOW") {
      decision = "REVIEW";
      decidedBy = { layer: "envelope", label: `Task Envelope — file budget (${env.fileBudget}) exhausted` };
      reasons.push(`Task Envelope: file-change budget (${env.fileBudget}) exhausted — re-authorization required.`);
    }
  }

  // 7b. Standing permission — an agent's everyday authority on a system.
  //     Inside a task the envelope is the authority, so this is skipped there.
  if (!req.envelope && req.standing) {
    const perm = req.standing.find((p) => p.agent === req.agent && p.resource === req.resource);
    if (perm && DECISION_RANK[decision] < DECISION_RANK.REVIEW) {
      const resName = resourceById(req.resource)?.name ?? req.resource;
      const lapsed = perm.status !== "active" || perm.expiresAt <= (req.now ?? Date.now());
      const deny = perm.denies.find((d) =>
        (!d.actions || d.actions.includes(req.action)) &&
        (!d.environments || d.environments.includes(req.environment)) &&
        (!d.rawPattern || new RegExp(d.rawPattern).test(req.actionRaw ?? "")));
      const outside = !perm.actions.includes(req.action) || (perm.environments !== undefined && !perm.environments.includes(req.environment));
      const overRows = perm.maxRows !== undefined && req.action === "READ" && (req.blastRadius?.rows ?? 0) > perm.maxRows;
      const why = lapsed
        ? `the standing permission on ${resName} was ${perm.status === "revoked" ? "revoked" : "expired"} — no everyday authority left`
        : deny ? `the standing permission on ${resName} says "may not: ${deny.label}"`
        : outside ? `${req.action} in ${req.environment} is outside the standing permission on ${resName}`
        : overRows ? `${(req.blastRadius?.rows ?? 0).toLocaleString("en-US")} rows is above the standing limit of ${perm.maxRows} rows per query on ${resName}`
        : undefined;
      if (why) {
        decision = "REVIEW";
        decidedBy = { layer: "standing", label: `Standing permission — ${why}` };
        reasons.push(`Standing permission: ${why}.`);
      }
    }
  }

  // 8. Default allow reason.
  if (decision === "ALLOW" && reasons.length === 0) {
    reasons.push(
      matched.length > 0
        ? "Permitted by enterprise policy; no safety invariant or limit triggered."
        : "No policy or safety invariant restricts this action; within normal working scope."
    );
  }
  if (decision === "CONSTRAIN" && transform) {
    safeAlternative = `Automatic ${transform.replaceAll("_", " ").toLowerCase()} lets the work continue safely without review.`;
  }
  if (decision === "REVIEW") {
    safeAlternative = suggestAlternative(req);
  }
  if (decision === "BLOCK" && !safeAlternative) {
    safeAlternative = suggestAlternative(req);
  }
  // The newer layers know the precise safe path.
  if (decidedBy.layer === "output" && outputCheck) {
    const bad = outputCheck.claims.find((c) => c.sealed !== undefined && !c.ok);
    safeAlternative = bad
      ? `Safer alternative: correct ${bad.field} to the sealed value (${bad.sealed}) and send again — it then passes on its own.`
      : "Safer alternative: run the action the claim refers to first, so its result is sealed, then send again.";
  } else if (decidedBy.layer === "injection") {
    safeAlternative = "Safer alternative: the person who asked confirms this action is really theirs, or re-runs it after the watch window.";
  } else if (decidedBy.layer === "supplier" && supplier) {
    safeAlternative = `Safer alternative: ${userById(supplier.sponsor)?.name ?? "the sponsor"} asks for a contract change with ${supplier.name}, or a ${ORG.short} agent does this instead.`;
  }

  return finish(req, {
    decision, reasons, matchedContracts: matched, safetyRules: safety, safetyObserved, decidedBy,
    transform: decision === "CONSTRAIN" ? transform : undefined, transformClasses, safeAlternative,
    risk: riskOf(req, decision, safety.length > 0),
    outputCheck,
  });
}

function suggestAlternative(req: ActionRequest): string {
  switch (req.action) {
    case "DELETE":
      return req.environment === "production"
        ? "Safer alternative: soft-delete with retention, or run against staging first."
        : "Safer alternative: move to trash / snapshot before delete.";
    case "WRITE": {
      // The safer path depends on WHAT is being written: money, code, data or a record.
      const kind = resourceById(req.resource)?.kind;
      if ((req.blastRadius?.spendUsd ?? 0) > 0)
        return "Safer alternative: ask the budget owner to approve this one payment — the agent's own spending limit stays as it is.";
      if (kind === "repo" || /\bgit\b/.test(req.actionRaw ?? ""))
        return "Safer alternative: push to a new feature branch and open a pull request.";
      if (kind === "database")
        return "Safer alternative: run the change on staging first, or ship it as a reviewed migration.";
      return req.environment === "production"
        ? "Safer alternative: make the change outside production first, then request a scoped, time-limited approval."
        : "Safer alternative: request a scoped, time-limited approval in Review Center.";
    }
    case "DATA_EXPORT":
      return "Safer alternative: export an aggregated or row-limited sample (≤500 rows).";
    case "DEPLOY":
      return "Safer alternative: deploy to staging and request a scoped production window.";
    case "PERMISSION_CHANGE":
      return "Safer alternative: grant a narrowly scoped role with expiry instead of admin.";
    case "SECRET_ACCESS":
      return "Safer alternative: continue without the secret, or request a scoped exception.";
    default:
      return "Request a scoped, time-limited approval in Review Center.";
  }
}

function riskOf(req: ActionRequest, decision: Decision, safetyHit: boolean): "low" | "moderate" | "high" | "critical" {
  if (safetyHit) return "critical";
  if (decision === "BLOCK") return "high";
  if (decision === "REVIEW") return req.environment === "production" ? "high" : "moderate";
  if (decision === "CONSTRAIN") return "moderate";
  return "low";
}

function finish(_req: ActionRequest, r: BrainResult): BrainResult {
  return r;
}
