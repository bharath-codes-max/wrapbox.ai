// ============================================================================
// Wrapbox Real Prototype — canonical model types
// One SimulationEvent shape feeds every surface: Simulation Lab, Control Room,
// Live Actions, Agents, Review Center, Evidence, Coverage, Trust Graph.
// ============================================================================

export type Decision = "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK";
// ENDPOINT / NETWORK / GATEWAY cover the laptop, its traffic and integrations;
// BROWSER (managed browser extension) and HOSTED (hosted agent platforms such
// as AWS Bedrock AgentCore Gateway) extend the same decisions to agents that
// never run on a governed laptop.
export type Plane = "ENDPOINT" | "NETWORK" | "GATEWAY" | "BROWSER" | "HOSTED";

export type ActionVerb =
  | "READ"
  | "WRITE"
  | "DELETE"
  | "EXECUTE"
  | "NETWORK_SEND"
  | "SECRET_ACCESS"
  | "PERMISSION_CHANGE"
  | "SECURITY_CHANGE"
  | "DEPLOY"
  | "DATA_EXPORT";

export type Environment = "development" | "test" | "staging" | "production" | "local";

export type DestinationClass =
  | "APPROVED_AI"
  | "UNAPPROVED_AI"
  | "APPROVED_SAAS"
  | "INTERNAL"
  | "PARTNER"
  | "GENERIC_EXTERNAL"
  | "UNKNOWN_EXTERNAL";

export type CoverageStatus =
  | "ENFORCED"
  | "DEGRADED"
  | "UNDERSTOOD_ONLY"
  | "PENDING"
  | "UNINSPECTABLE";

export type TransformKind =
  | "REDACT"
  | "MASK"
  | "REVERSIBLE_TOKENIZE"
  | "HASH"
  | "DROP_FIELD"
  | "GENERALIZE"
  | "DATE_SHIFT"
  | "FORMAT_PRESERVING"
  | "LIMIT"
  | "REWRITE";

export interface DetectorFinding {
  dataClass: string; // e.g. "PII.EMAIL"
  detector: string; // e.g. "pii-email-v2"
  detectorVersion: string;
  confidence: number;
  sample?: string; // masked sample of what matched (never raw secrets)
  count: number;
}

export interface InspectionResult {
  inspectable: boolean;
  reason?: string; // when uninspectable: "AES-encrypted archive", etc.
  parser?: string;
  findings: DetectorFinding[];
}

export interface TransformStep {
  kind: TransformKind;
  dataClass: string;
  before: string;
  after: string;
  tokenId?: string;
}

export interface BlastRadius {
  files?: number;
  rows?: number;
  recipients?: number;
  spendUsd?: number;
  records?: number;
  dependencies?: string[];
  label: string; // human-readable summary
  severity: "low" | "moderate" | "high" | "critical";
}

export interface EventContext {
  environment: Environment;
  resourceSensitivity: "disposable" | "internal" | "sensitive" | "customer-impacting";
  privileged: boolean;
  businessHours: boolean;
  notes?: string[];
}

export interface MatchedClause {
  contractId: string;
  contractName: string;
  clauseId: string;
  clauseText: string;
  effect?: Decision; // what this clause demands (absent on events recorded before this field existed)
}

/** Which layer of the Core Brain produced the final decision. */
export interface DecidedBy {
  layer: "killswitch" | "contract" | "safety" | "supplier" | "delegation" | "blast" | "context" | "injection" | "output" | "envelope" | "standing" | "uninspectable" | "breakglass" | "default";
  clauseId?: string; // set when layer === "contract"
  ruleId?: string; // set when layer === "safety"
  label: string; // human-readable, e.g. the clause text or rule name
}

export interface SafetyRuleHit {
  ruleId: string;
  name: string;
  description: string;
}

export interface ReviewState {
  status: "pending" | "approved" | "approved_scoped" | "constrained" | "denied" | "expired";
  reviewer?: string;
  note?: string;
  scope?: string;
  decidedAt?: number;
  expiresAt: number;
  bundleId?: string;
  safeAlternative?: string;
  approver?: string; // who is asked to decide (user id)
}

export interface EvidenceRecord {
  eventId: string;
  hash: string; // simulated tamper-evident chain hash
  prevHash: string;
  chain: { label: string; detail: string }[]; // causal chain nodes
}

export interface SimulationEvent {
  id: string;
  seq: number;
  timestamp: number;
  scenario?: string; // scenario id when produced by Simulation Lab
  user: string; // user id
  device: string; // device id
  agent: string; // agent id
  application?: string; // e.g. browser, terminal
  plane: Plane;
  action: ActionVerb;
  actionRaw?: string; // e.g. "rm -rf tmp/", "os.remove()", "git push --force"
  resource: string; // resource id or path
  environment: Environment;
  destination?: string; // destination id
  destinationClass?: DestinationClass;
  dataClasses: string[];
  inspection?: InspectionResult;
  matchedContracts: MatchedClause[];
  safetyRules: SafetyRuleHit[];
  safetyObserved?: SafetyRuleHit[]; // kernel rules in observe mode that would have fired
  decidedBy?: DecidedBy;
  context: EventContext;
  blastRadius?: BlastRadius;
  capabilityState: CoverageStatus; // enforcement capability at this point
  decision: Decision;
  decisionReasons: string[];
  safeAlternative?: string;
  transformation?: TransformStep[];
  payloadBefore?: string;
  payloadAfter?: string;
  reviewState?: ReviewState;
  taskId?: string;
  stepIndex?: number;
  dependsOn?: number[];
  status: "completed" | "blocked" | "parked" | "pending_review" | "transformed" | "in_progress";
  risk: "low" | "moderate" | "high" | "critical";
  evidence: EvidenceRecord;
  breakGlass?: boolean;
  /** MCP tools/call as the gateway saw it (tool name + arguments). */
  mcp?: McpCall;
  /** Agent-to-agent delegation: who asked whom, starting from the originating agent. */
  delegation?: DelegationHop[];
  /** Supplier that operates the agent, when it isn't Veridian's own. */
  operator?: string;
  /** Untrusted content the agent read shortly before this action (injection-aware decisions). */
  taint?: AgentTaint;
  /** Claims in the agent's output checked against results sealed at the gateway. */
  outputCheck?: OutputCheck;
  /** Untrusted content this action itself read (sets a taint on the agent). */
  untrustedRead?: { kind: UntrustedKind; label: string };
  /** A result sealed at the gateway when this action ran (for later output checks). */
  resultSeal?: ResultSeal;
}

export interface McpCall {
  server: string;          // MCP server id (see MCP_SERVERS)
  registered: boolean;     // registered with the gateway, or merely discovered
  transport: "remote" | "stdio";
  tool: string;            // params.name of tools/call
  args: Record<string, string>; // params.arguments (string-valued in this prototype)
}

export interface DelegationHop {
  agent: string;           // agent id
  asked: string;           // plain words: what this agent asked the next one to do
}

export type UntrustedKind = "web" | "email" | "issue" | "document";

export interface AgentTaint {
  agent: string;
  kind: UntrustedKind;
  label: string;           // e.g. "GitHub issue #482 (external contributor)"
  eventId: string;         // the read that set it
  at: number;
  expiresAt: number;
}

export interface ResultSeal {
  source: string;          // e.g. "Stripe API · refund re_3QxR2"
  field: string;           // e.g. "refund.amount"
  value: string;           // e.g. "$18.00"
  hash: string;            // seal over source + field + value
}

export interface OutputCheck {
  status: "MATCH" | "MISMATCH" | "UNVERIFIABLE";
  claims: { field: string; claimed: string; sealed?: string; source?: string; ok: boolean }[];
}

/** One stop of an agent everywhere (kill switch). */
export interface AgentStop {
  id: string;
  agent: string;
  by: string;              // who stopped it
  reason: string;
  at: number;
  active: boolean;
  resumedBy?: string;
  resumedAt?: number;
}

// ---------------------------------------------------------------------------
// Intent Contracts
// ---------------------------------------------------------------------------

export interface ContractClause {
  id: string;
  text: string; // natural-language clause
  dataClasses: string[];
  destinations: DestinationClass[] | "ANY";
  actions: ActionVerb[] | "ANY";
  environments?: Environment[];
  effect: Decision; // what this clause demands when matched
  transform?: TransformKind;
  requiredCapabilities: string[]; // capability registry ids
  failClosed: boolean;
  /** Per-tool MCP control: which server/tool, and argument patterns (regex). */
  mcp?: { tools?: string[]; registered?: boolean; args?: Record<string, string> };
}

export interface IntentContract {
  id: string;
  name: string;
  author: string;
  createdAt: number;
  version: number;
  status: "ACTIVE" | "DRAFT" | "DEACTIVATED";
  sourceText: string; // the natural-language contract
  clauses: ContractClause[];
  // Snapshot only. Screens must read engine/coverage.ts contractCoverage(),
  // which derives it live from the clauses' required capabilities.
  coverage: CoverageStatus;
}

// ---------------------------------------------------------------------------
// Tasks / envelopes / permits
// ---------------------------------------------------------------------------

export interface TaskEnvelope {
  taskId: string;
  title: string; // "Fix checkout"
  agent: string;
  user: string;
  allowedResources: string[];
  allowedActions: ActionVerb[];
  environment: Environment;
  forbidden: string[];
  durationMin: number;
  startedAt: number;
  fileBudget: number;
  filesUsed: number;
  status: "active" | "completed" | "parked" | "stopped" | "expired";
  steps: TaskStep[];
  jobId?: string; // which team job this run came from
  team?: string;
  approver?: string; // who decides this job's risky steps (never the requester)
  approverRole?: string;
  templateName?: string; // envelope template, e.g. "Finance · reporting"
  // Extra scope a reviewer granted with "Approve scoped" — valid for this task only.
  grants?: { resource: string; environment: Environment; grantedBy: string; at: number }[];
}

export interface TaskStep {
  index: number;
  label: string;
  action: ActionVerb;
  resource: string;
  dependsOn: number[];
  state: "pending" | "running" | "done" | "parked" | "blocked" | "waiting_dependency" | "skipped";
  decision?: Decision;
  eventId?: string;
}

/** An agent's everyday authority on one system, outside any task. While
 *  active, in-scope work flows; its limits and "may not" list are enforced;
 *  once revoked or expired, that agent's work there needs a human yes. */
export interface StandingPermission {
  id: string;
  agent: string;
  resource: string; // resource id it covers
  scope: string; // plain-language summary
  actions: ActionVerb[]; // what it covers
  environments?: Environment[]; // where (absent = any)
  maxRows?: number; // per-query read limit
  denies: { label: string; actions?: ActionVerb[]; environments?: Environment[]; rawPattern?: string }[];
  allowed: string[]; // display text
  forbidden: string[]; // display text
  expiresAt: number;
  maxFilesPerTask: number;
  grantedBy: string;
  status: "active" | "expired" | "revoked";
}

export interface BreakGlassSession {
  id: string;
  requester: string;
  reason: string;
  scope: string; // plain-language label of the scope
  scopeResource?: string; // the ONLY resource it covers (absent on old saves = covers nothing)
  scopeEnvironment?: Environment;
  notified?: string[]; // user ids told when it started
  durationMin: number;
  startedAt: number;
  active: boolean;
}

export interface VaultToken {
  id: string;
  dataClass: string;
  createdAt: number;
  scope: string;
  expiresAt: number;
  restorable: boolean;
  eventId: string;
}

/** One attempt to turn a token back into its original value. */
export interface RestoreRecord {
  id: string;
  tokenId: string;
  requester: string; // who asked, e.g. "Priya Menon (inside Veridian)" or "claude.ai"
  inside: boolean; // inside the company's authorized scope?
  allowed: boolean;
  reason: string;
  at: number;
}

/** What accepting a recommendation would do. It never widens authority and
 *  never switches anything on by itself. */
export type AutopilotProposal =
  | { kind: "draft"; name: string; sourceText: string; clauses: ContractClause[] }
  | { kind: "narrow-standing"; standingId: string; from: string; to: string; maxRows: number };

export interface AutopilotRecommendation {
  id: string;
  observation: string;
  recommendation: string;
  basedOnEvents: number;
  status: "open" | "accepted" | "modified" | "dismissed";
  proposes?: AutopilotProposal;
  result?: string; // what accepting / modifying actually did
  contractId?: string; // draft created from it, if any
}
