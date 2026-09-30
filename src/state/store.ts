// ============================================================================
// App store — single source of truth. Every screen derives from this state;
// no screen keeps its own copy of events, reviews, contracts or tokens.
// Persists to localStorage (Reset Demo Data restores the seed).
// ============================================================================

import { useSyncExternalStore } from "react";
import type {
  AgentStop, AgentTaint, AutopilotRecommendation, BreakGlassSession, IntentContract, SimulationEvent,
  StandingPermission, TaskEnvelope, VaultToken, Decision, RestoreRecord, Environment,
} from "../model/types";
import { DEMO_CONTRACTS, MCP_TOOL_CONTRACT, SEED_CONTRACTS } from "../model/contracts";
import { ORG, USERS, AGENTS, deviceForAction, userById } from "../model/org";
import { ROLLOUT, type AgentKind } from "../model/rollout";
import { canActivate, contractCoverage } from "../engine/coverage";
import { BASELINE_KERNEL, enforceRule, installRelease, pendingRelease, type KernelState } from "../engine/kernel";
import { SCENARIOS, jobById, scenarioById, type Scenario } from "../engine/scenarios";
import { runScenario, setSeq, getSeq, setTokenCounter, getTokenCounter } from "../engine/simulate";
import { decide, INJECTION_WINDOW_MIN } from "../engine/brain";

// ---------------------------------------------------------------------------
// Workspaces + onboarding
// "demo" = Veridian Systems, three months in (seeded history).
// "fresh" = day one: no history, no contracts, nothing connected — the admin
// onboarding wizard builds it, and every page reflects what they did.
// Each workspace persists under its own key, so neither overwrites the other.
// ---------------------------------------------------------------------------
export type Workspace = "demo" | "fresh";
export type Region = "us" | "eu" | "in";
export type Idp = "" | "Google Workspace" | "Microsoft Entra ID" | "Okta";

export interface OrgProfile {
  company: string;
  domain: string;
  region: Region;
  idp: Idp;
  keyThumb?: string;   // thumbprint of the workspace signing key (real ECDSA P-256, generated in the browser)
  createdAt?: number;
}

export interface AlertPrefs { slack: boolean; teams: boolean; email: boolean; passkey: boolean; escalateMin: 5 | 15 | 30 }

export interface OnboardingState {
  adminDone: boolean;
  employeeDone: boolean;
  categories: AgentKind[];  // agent kinds the admin chose to govern (Step 2)
  connected: string[];      // ROLLOUT target ids rolled out (Step 4 — simulated)
  alerts: AlertPrefs;       // where approvers get asked (Step 5)
  invited: string[];        // user ids synced from the directory / invited (Step 6)
  selfTests: string[];      // event ids produced by the go-live self-tests (Step 7)
  employee: { accepted: boolean; passkey: boolean; installed: boolean; tries: string[] };
}

export interface AppState {
  workspace: Workspace;
  org: OrgProfile;
  onboarding: OnboardingState;
  events: SimulationEvent[];
  contracts: IntentContract[];
  tasks: TaskEnvelope[];
  tokens: VaultToken[];
  restorations: RestoreRecord[]; // audit log of every token restore attempt
  standing: StandingPermission[];
  breakGlass: BreakGlassSession[];
  autopilot: AutopilotRecommendation[];
  lastHash: string;
  demoStep: number; // -1 = demo mode off
  kernel: KernelState; // installed Wrapbox Safety Kernel pack
  stops: AgentStop[]; // kill switch: agents stopped everywhere (history kept)
  taints: AgentTaint[]; // agents that recently read untrusted content
}

const STORAGE_KEY = "wrapbox-real-prototype-v1"; // demo workspace (unchanged key — existing data survives)
const FRESH_KEY = "wrapbox-real-prototype-fresh-v1";
const WS_KEY = "wrapbox-real-prototype-workspace";
const keyFor = (ws: Workspace) => (ws === "fresh" ? FRESH_KEY : STORAGE_KEY);

const ALL_KINDS: AgentKind[] = [...new Set(AGENTS.map((a) => a.kind))];
const DEFAULT_ALERTS: AlertPrefs = { slack: true, teams: false, email: true, passkey: true, escalateMin: 15 };
const DEMO_ORG: OrgProfile = { company: ORG.name, domain: ORG.domain, region: "us", idp: "Okta" };

/** Veridian has been live for months: onboarding is complete and everything is connected. */
function demoOnboarding(): OnboardingState {
  return {
    adminDone: true, employeeDone: true, categories: ALL_KINDS, connected: ROLLOUT.map((t) => t.id),
    alerts: DEFAULT_ALERTS, invited: USERS.map((u) => u.id), selfTests: [],
    employee: { accepted: true, passkey: true, installed: true, tries: [] },
  };
}
function freshOnboarding(): OnboardingState {
  return {
    adminDone: false, employeeDone: false, categories: [], connected: [],
    alerts: DEFAULT_ALERTS, invited: ["u-priya"], selfTests: [],
    employee: { accepted: false, passkey: false, installed: false, tries: [] },
  };
}

function currentWorkspace(): Workspace {
  try { return localStorage.getItem(WS_KEY) === "fresh" ? "fresh" : "demo"; } catch { return "demo"; }
}

// ---------------------------------------------------------------------------
// Seed generation — a believable few days of history, produced through the
// real engine (never hand-written decisions).
// ---------------------------------------------------------------------------

function seedState(): AppState {
  setSeq(0);
  setTokenCounter(0);
  const contracts = structuredClone(DEMO_CONTRACTS) as IntentContract[];
  const events: SimulationEvent[] = [];
  const tokens: VaultToken[] = [];
  let lastHash = "genesis0";

  const h = 3600 * 1000;
  const now = Date.now();
  // History: scenario id + how long ago. Ordered oldest → newest.
  const history: [string, number][] = [
    ["ep-read-src", 52 * h], ["ep-run-tests", 51.5 * h], ["gw-push-feature", 50 * h],
    ["net-code-approved", 47 * h], ["net-pii-approved", 44 * h], ["ep-read-env", 40 * h],
    ["gw-select-50", 36 * h], ["ep-del-tmp", 33 * h], ["net-cred-approved", 28 * h],
    ["ctx-del-testdb", 26 * h], ["gw-force-main", 22 * h], ["sk-privkey-exfil", 18 * h],
    ["net-code-unapproved", 14 * h], ["gw-export-500k", 10 * h], ["net-encrypted", 7 * h],
    ["gw-iam-admin", 5 * h], ["net-unknown-dest", 3 * h], ["ep-read-src", 1.2 * h],
    ["gw-select-50", 0.6 * h], ["ep-run-tests", 0.3 * h],
  ];
  for (const [sid, ago] of history) {
    const sc = scenarioById(sid)!;
    const out = runScenario(sc, contracts, lastHash, { timestamp: now - ago, standing: standingSeed(now) });
    events.push(out.event);
    tokens.push(...out.tokens);
    lastHash = out.event.evidence.hash;
  }
  // Resolve a couple of old reviews so history looks lived-in.
  const oldForce = events.find((e) => e.scenario === "gw-force-main");
  if (oldForce?.reviewState) {
    oldForce.reviewState = {
      ...oldForce.reviewState,
      status: "denied",
      reviewer: "u-alex",
      note: "Rewrite history on main is not acceptable; open a revert PR instead.",
      decidedAt: now - 21 * h,
    };
    oldForce.status = "blocked";
  }
  const oldExport = events.find((e) => e.scenario === "net-code-unapproved");
  if (oldExport?.reviewState) {
    oldExport.reviewState = {
      ...oldExport.reviewState,
      status: "approved_scoped",
      reviewer: "u-maya",
      scope: "This file only, this destination, valid 4h",
      decidedAt: now - 13 * h,
    };
    oldExport.status = "completed";
  }

  const standing: StandingPermission[] = standingSeed(now);

  const autopilot: AutopilotRecommendation[] = autopilotSeed();

  return {
    workspace: "demo",
    org: DEMO_ORG,
    onboarding: demoOnboarding(),
    events,
    contracts,
    tasks: [],
    tokens,
    restorations: [],
    standing,
    breakGlass: [],
    autopilot,
    lastHash,
    demoStep: -1,
    kernel: BASELINE_KERNEL,
    stops: [],
    taints: [],
  };
}

/** Day one: nothing has happened yet. No history, no contracts, no standing
 *  permissions, no Autopilot suggestions (those need history). The baseline
 *  Safety Kernel is on from the first second — it needs no setup. */
function freshState(): AppState {
  setSeq(0);
  setTokenCounter(0);
  return {
    workspace: "fresh",
    org: { ...DEMO_ORG, idp: "" },
    onboarding: freshOnboarding(),
    events: [],
    contracts: [],
    tasks: [],
    tokens: [],
    restorations: [],
    standing: [],
    breakGlass: [],
    autopilot: [],
    lastHash: "genesis0",
    demoStep: -1,
    kernel: BASELINE_KERNEL,
    stops: [],
    taints: [],
  };
}

/** Agents' everyday authority. Structured so the brain can enforce it. */
export function standingSeed(now = Date.now()): StandingPermission[] {
  const d = 24 * 3600 * 1000;
  return [
    {
      id: "sp-001",
      agent: "a-claude-code",
      resource: "r-checkout",
      scope: "repository checkout-service",
      actions: ["READ", "WRITE", "EXECUTE"],
      environments: ["development"],
      denies: [
        { label: "push to main", actions: ["WRITE"], environments: ["production"] },
        { label: "anything in production", environments: ["production"] },
      ],
      allowed: ["read, edit and commit on feature branches", "run tests"],
      forbidden: ["push to main", "anything in production"],
      expiresAt: now + 5 * d,
      maxFilesPerTask: 25,
      grantedBy: "u-alex",
      status: "active",
    },
    {
      id: "sp-002",
      agent: "a-support",
      resource: "r-customer-db",
      scope: "customer-db (read-only)",
      actions: ["READ"],
      maxRows: 500,
      denies: [
        { label: "writes or deletes", actions: ["WRITE", "DELETE"] },
        { label: "bulk export", actions: ["DATA_EXPORT"] },
        { label: "schema changes", actions: ["PERMISSION_CHANGE", "SECURITY_CHANGE"] },
      ],
      allowed: ["read-only lookups (SELECT)", "ticket lookups"],
      forbidden: ["writes or deletes", "bulk export", "schema changes"],
      expiresAt: now + 12 * d,
      maxFilesPerTask: 0,
      grantedBy: "u-priya",
      status: "active",
    },
  ];
}

// Policy Autopilot recommendations — each says exactly what accepting does.
function autopilotSeed(): AutopilotRecommendation[] {
  return [
    {
      id: "ap-001",
      observation: "93% of code-agent pushes over 30 days target feature branches; force pushes to main were reviewed or denied every time.",
      recommendation: "Require engineering review for any push to main by a coding agent.",
      basedOnEvents: 412,
      status: "open",
      proposes: {
        kind: "draft",
        name: "Autopilot · Protect main branch",
        sourceText: "Pushes to main by coding agents require engineering review.",
        clauses: [{
          id: "cl-ap1-1", text: "Pushes to main by coding agents require engineering review",
          dataClasses: ["SOURCE_CODE"], destinations: "ANY", actions: ["WRITE"], environments: ["production"],
          effect: "REVIEW", requiredCapabilities: ["cap-gw-github"], failClosed: true,
        }],
      },
    },
    {
      id: "ap-002",
      observation: "Support Agent queries have never exceeded 120 rows in normal operation.",
      recommendation: "Lower Support Agent's standing row budget from 500 to 200 rows per query.",
      basedOnEvents: 1873,
      status: "open",
      proposes: { kind: "narrow-standing", standingId: "sp-002", from: "SELECT ≤500 rows per query", to: "SELECT ≤200 rows per query", maxRows: 200 },
    },
    {
      id: "ap-003",
      observation: "An unknown MCP server (tcp/7823) on Finance-Laptop-07 attempted 3 external transfers in 48h.",
      recommendation: "Block every transfer to unknown destinations — this also cuts off the unknown MCP agent.",
      basedOnEvents: 3,
      status: "open",
      proposes: {
        kind: "draft",
        name: "Autopilot · Block unknown destinations",
        sourceText: "Sending any data to unknown destinations is blocked.",
        clauses: [{
          id: "cl-ap3-1", text: "Sending any data to unknown destinations is blocked",
          dataClasses: [], destinations: ["UNKNOWN_EXTERNAL"], actions: ["NETWORK_SEND", "DATA_EXPORT"],
          effect: "BLOCK", requiredCapabilities: ["cap-net-https"], failClosed: true,
        }],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Store plumbing
// ---------------------------------------------------------------------------

let state: AppState = load();
const listeners = new Set<() => void>();

function load(ws: Workspace = currentWorkspace()): AppState {
  try {
    const raw = localStorage.getItem(keyFor(ws));
    if (raw) {
      const parsed = JSON.parse(raw) as AppState & { _seq?: number; _tok?: number };
      setSeq(parsed._seq ?? parsed.events.length);
      // Never restore below the highest token id already issued.
      const maxIssued = Math.max(0, ...parsed.tokens.map((t) => Number(t.id.match(/_(\d+)$/)?.[1] ?? 0)));
      setTokenCounter(Math.max(parsed._tok ?? 0, maxIssued));
      // Older saved events took the laptop from the agent; re-attach each one to
      // the person's own device so user + device always agree.
      const events = parsed.events.map((e) => {
        const d = deviceForAction(e.agent, e.user);
        let out = e.device !== d ? { ...e, device: d } : e;
        // Events saved before "decided by" existed: infer it from what was
        // recorded (a clause carrying the final effect, else a safety rule).
        if (!out.decidedBy) {
          const effectOf = (clauseId: string) =>
            parsed.contracts.flatMap((c) => c.clauses).find((cl) => cl.id === clauseId)?.effect;
          const matched = out.matchedContracts.map((m) => ({ ...m, effect: m.effect ?? effectOf(m.clauseId) }));
          out = { ...out, matchedContracts: matched };
          const clause = matched.find((m) => m.effect === out.decision);
          out = {
            ...out,
            decidedBy: clause
              ? { layer: "contract", clauseId: clause.clauseId, label: `"${clause.clauseText}" (${clause.contractName})` }
              : out.safetyRules.length > 0 && out.decision === "BLOCK"
                ? { layer: "safety", ruleId: out.safetyRules[0].ruleId, label: `Safety Kernel — ${out.safetyRules[0].name}` }
                : { layer: "default", label: out.decisionReasons[0] ?? "No rule restricts this action" },
          };
        }
        return out;
      });
      const baseOnboarding = ws === "fresh" ? freshOnboarding() : demoOnboarding();
      // The demo company's MCP tool policy arrived after some browsers saved state.
      const contracts = ws === "demo" && !parsed.contracts.some((c) => c.id === MCP_TOOL_CONTRACT.id)
        ? [...parsed.contracts, structuredClone(MCP_TOOL_CONTRACT)]
        : parsed.contracts;
      return { ...parsed, contracts, stops: parsed.stops ?? [], taints: parsed.taints ?? [], workspace: ws, org: parsed.org ?? (ws === "fresh" ? { ...DEMO_ORG, idp: "" } : DEMO_ORG), onboarding: { ...baseOnboarding, ...parsed.onboarding, employee: { ...baseOnboarding.employee, ...parsed.onboarding?.employee } }, events, kernel: parsed.kernel ?? BASELINE_KERNEL, restorations: parsed.restorations ?? [], standing: parsed.standing?.every((p) => p.resource) ? parsed.standing : standingSeed().map((seed) => ({ ...seed, status: parsed.standing?.find((x) => x.id === seed.id)?.status ?? seed.status })), autopilot: autopilotSeed().map((seed) => ({ ...seed, ...(parsed.autopilot ?? []).find((x) => x.id === seed.id), proposes: seed.proposes, recommendation: seed.recommendation })), demoStep: -1 }; // demo mode never persists across reloads
    }
  } catch {
    /* corrupted state → reseed */
  }
  return ws === "fresh" ? freshState() : seedState();
}

function persist() {
  try {
    localStorage.setItem(
      keyFor(state.workspace),
      JSON.stringify({ ...state, _seq: getSeq(), _tok: getTokenCounter() })
    );
  } catch {
    /* storage unavailable — session-only state is fine */
  }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState(): AppState {
  return state;
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  emit();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Token Vault — restoring a token back to its original value
// ---------------------------------------------------------------------------

/** Only someone inside the company's authorized scope may turn a token back
 *  into the real value. Every attempt — allowed or denied — is logged. */
export function restoreToken(tokenId: string, requester: string, inside: boolean): RestoreRecord | undefined {
  const t = state.tokens.find((x) => x.id === tokenId);
  if (!t) return undefined;
  const expired = t.expiresAt <= Date.now();
  const allowed = inside && t.restorable && !expired;
  const rec: RestoreRecord = {
    id: `rst-${Date.now().toString(36)}-${state.restorations.length}`,
    tokenId, requester, inside, allowed, at: Date.now(),
    reason: !inside
      ? `Requester is outside ${ORG.short} — external parties only ever hold tokens`
      : expired ? "Token has expired"
      : !t.restorable ? "Token is sealed — no restoration permitted"
      : `Inside ${ORG.short}, token in scope`,
  };
  set({ restorations: [...state.restorations, rec] });
  return rec;
}

// ---------------------------------------------------------------------------
// Safety Kernel updates (Wrapbox-managed rule pack)
// ---------------------------------------------------------------------------

/** Install the next Wrapbox Safety Kernel release; its new rules start in observe mode. */
export function installKernelUpdate(): boolean {
  const rel = pendingRelease(state.kernel);
  if (!rel) return false;
  set({ kernel: installRelease(state.kernel, rel, Date.now()) });
  return true;
}

/** Move an observing kernel rule to enforcing ahead of its observation window. */
export function enforceKernelRule(ruleId: string) {
  set({ kernel: enforceRule(state.kernel, ruleId) });
}

export function setDemoStep(n: number) {
  set({ demoStep: n });
}

/** Reset the CURRENT workspace to its starting point (demo → seeded history, fresh → day one). */
export function resetDemoData() {
  state = state.workspace === "fresh" ? freshState() : seedState();
  emit();
}

// ---------------------------------------------------------------------------
// Workspaces + onboarding actions
// ---------------------------------------------------------------------------

/** Switch workspace: the current one is saved, the other is loaded (or created). */
export function switchWorkspace(ws: Workspace) {
  if (ws === state.workspace) return;
  persist();
  try { localStorage.setItem(WS_KEY, ws); } catch { /* session-only */ }
  state = load(ws);
  emit();
}

/** Start the fresh workspace over from day one and make it current. */
export function startFreshWorkspace() {
  persist();
  try { localStorage.setItem(WS_KEY, "fresh"); } catch { /* session-only */ }
  // Wizards reopen at step 1 after a fresh start.
  try { for (const k of ["admin", "employee"]) sessionStorage.removeItem(`wrapbox-onboarding-${k}:fresh`); } catch { /* ignore */ }
  state = freshState();
  emit();
}

export function setOrg(patch: Partial<OrgProfile>) {
  set({ org: { ...state.org, ...patch } });
}

export function setOnboarding(patch: Partial<Omit<OnboardingState, "employee">>) {
  set({ onboarding: { ...state.onboarding, ...patch } });
}

export function setEmployeeProgress(patch: Partial<OnboardingState["employee"]>) {
  set({ onboarding: { ...state.onboarding, employee: { ...state.onboarding.employee, ...patch } } });
}

/** Publish the recommended contract pack. Each contract goes ACTIVE only if
 *  Wrapbox has the skills to keep it (canActivate) — otherwise it lands as a
 *  DRAFT and says so. Returns which ids went live and which stayed draft. */
export function publishRecommendedContracts(): { active: string[]; draft: string[] } {
  const active: string[] = [];
  const draft: string[] = [];
  const next = [...state.contracts];
  for (const seed of structuredClone(SEED_CONTRACTS) as IntentContract[]) {
    const ok = canActivate(seed);
    const status: IntentContract["status"] = ok ? "ACTIVE" : "DRAFT";
    (ok ? active : draft).push(seed.id);
    const i = next.findIndex((c) => c.id === seed.id);
    const c = { ...seed, status, coverage: contractCoverage(seed) };
    if (i >= 0) next[i] = { ...c, version: next[i].version + 1 }; else next.push(c);
  }
  set({ contracts: next });
  return { active, draft };
}

export function completeAdminOnboarding() {
  set({ onboarding: { ...state.onboarding, adminDone: true } });
}

export function completeEmployeeOnboarding() {
  set({ onboarding: { ...state.onboarding, employeeDone: true } });
}

export function activeBreakGlass(now = Date.now()): BreakGlassSession | undefined {
  return state.breakGlass.find((b) => b.active && b.startedAt + b.durationMin * 60000 > now && b.scopeResource && b.scopeEnvironment);
}

/** Agents stopped right now (kill switch). */
export function activeStops(s: AppState = state): AgentStop[] {
  return s.stops.filter((x) => x.active);
}
export function stopOf(agent: string, s: AppState = state): AgentStop | undefined {
  return s.stops.find((x) => x.active && x.agent === agent);
}

/** Untrusted content this agent read within the injection window, if any. */
export function taintOf(agent: string, now = Date.now(), s: AppState = state): AgentTaint | undefined {
  return s.taints.find((t) => t.agent === agent && t.expiresAt > now);
}

/** Fill each claim in the agent's output with the result sealed at the gateway
 *  (the most recent recorded result for that field). Nothing sealed = nothing
 *  to verify against, which the brain treats as fail-closed. */
export function withSealedClaims(sc: Scenario, events: SimulationEvent[] = state.events): Scenario {
  if (!sc.claims?.length) return sc;
  const claims = sc.claims.map((c) => {
    const sealed = [...events].reverse().find((e) => e.resultSeal?.field === c.field)?.resultSeal;
    return { field: c.field, claimed: c.claimed, sealed: sealed?.value, source: sealed?.source };
  });
  return { ...sc, claims };
}

/** After an action that read untrusted content ran, the agent stays under closer watch. */
function taintsAfter(ev: SimulationEvent, taints: AgentTaint[]): AgentTaint[] {
  if (!ev.untrustedRead || (ev.decision !== "ALLOW" && ev.decision !== "CONSTRAIN")) return taints;
  const t: AgentTaint = {
    agent: ev.agent, kind: ev.untrustedRead.kind, label: ev.untrustedRead.label, eventId: ev.id,
    at: ev.timestamp, expiresAt: ev.timestamp + INJECTION_WINDOW_MIN * 60_000,
  };
  return [...taints.filter((x) => x.agent !== ev.agent), t];
}

export function simulate(sc: Scenario): SimulationEvent {
  const live = activeBreakGlass();
  const bg = live ? { resource: live.scopeResource!, environment: live.scopeEnvironment! } : undefined;
  const out = runScenario(withSealedClaims(sc), state.contracts, state.lastHash, {
    breakGlass: bg, kernel: state.kernel, standing: state.standing, stops: activeStops(), taint: taintOf(sc.agent),
  });
  set({
    events: [...state.events, out.event],
    tokens: [...state.tokens, ...out.tokens],
    lastHash: out.event.evidence.hash,
    taints: taintsAfter(out.event, state.taints),
  });
  return out.event;
}

export function simulateById(id: string): SimulationEvent | undefined {
  const sc = scenarioById(id);
  if (!sc) return undefined;
  return simulate(sc);
}

// What-if evaluation that does NOT record an event (Policy Simulator).
/** Pure what-if through the real brain — nothing is recorded. Restores the
 *  event sequence and token counter so a preview never consumes ids that a
 *  real run will later show. */
export function shadowEvent(
  sc: Scenario, contracts: IntentContract[], kernel: KernelState = state.kernel, standing: StandingPermission[] = state.standing,
  opts?: { withLiveOverride?: boolean },
): SimulationEvent {
  const seqBefore = getSeq();
  const tokBefore = getTokenCounter();
  // "What would Run do right now" must include everything simulate() uses:
  // an active break-glass override, stopped agents and untrusted reads.
  const live = opts?.withLiveOverride ? activeBreakGlass() : undefined;
  const breakGlass = live ? { resource: live.scopeResource!, environment: live.scopeEnvironment! } : undefined;
  const out = runScenario(withSealedClaims(sc), contracts, "shadow", {
    timestamp: Date.now(), kernel, standing, breakGlass,
    ...(opts?.withLiveOverride ? { stops: activeStops(), taint: taintOf(sc.agent) } : {}),
  });
  setSeq(seqBefore);
  setTokenCounter(tokBefore);
  return out.event;
}

export function shadowEvaluate(sc: Scenario, contracts: IntentContract[], kernel?: KernelState, standing?: StandingPermission[]): Decision {
  return shadowEvent(sc, contracts, kernel, standing).decision;
}

/** The decision a real Run would return right now — live rules, kernel, standing
 *  permissions, break-glass, stopped agents and untrusted reads — without recording anything. */
export function decisionNow(sc: Scenario): Decision {
  return shadowEvent(sc, state.contracts, state.kernel, state.standing, { withLiveOverride: true }).decision;
}

/** Who must decide a review: the job's approver for task steps; money goes to
 *  the Finance Controller; otherwise the Engineering Manager — and never the
 *  person who made the request (the Admin steps in then). */
export function approverFor(e: SimulationEvent): string {
  if (e.reviewState?.approver) return e.reviewState.approver;
  const money = (e.blastRadius?.spendUsd ?? 0) > 0 || e.resource === "r-stripe";
  const first = money ? "u-sam" : "u-alex";
  return e.user === first ? "u-priya" : first;
}

export function resolveReview(
  eventId: string,
  resolution: "approved" | "approved_scoped" | "constrained" | "denied",
  reviewer: string,
  note?: string,
  scope?: string
) {
  const target = state.events.find((e) => e.id === eventId);
  // Separation of duties: the requester can never resolve their own review.
  // Enforced here, not only by approverFor() routing, so no caller can bypass it.
  if (target && reviewer === target.user) return;
  // A stopped agent's held action can't be approved into running; deny still records.
  if (target && stopOf(target.agent) && resolution !== "denied") return;
  if (target?.taskId && resolution === "approved_scoped") {
    // For a task step, "scoped" has a precise meaning: this task may use this
    // resource in this environment until it finishes.
    scope = `This task may use ${target.resource} in ${target.environment} until it finishes`;
  }
  const events = state.events.map((e) => {
    if (e.id !== eventId || !e.reviewState) return e;
    const approved = resolution === "approved" || resolution === "approved_scoped";
    return {
      ...e,
      reviewState: { ...e.reviewState, status: resolution, reviewer, note, scope, decidedAt: Date.now() },
      status: approved ? ("completed" as const) : resolution === "constrained" ? ("transformed" as const) : ("blocked" as const),
      evidence: {
        ...e.evidence,
        chain: [
          ...e.evidence.chain,
          { label: "Review", detail: `${resolution.replaceAll("_", " ")} by ${userById(reviewer)?.name ?? reviewer}${scope ? ` · scope: ${scope}` : ""}` },
          { label: "Outcome", detail: approved ? "Action executed after approval" : resolution === "constrained" ? "Constrained alternative executed" : "Action remained blocked" },
        ],
      },
    };
  });
  set({ events });
  // Resume any parked task step tied to this event.
  const ev = events.find((e) => e.id === eventId);
  if (ev?.taskId) resumeParkedStep(ev.taskId, eventId, resolution, reviewer);
}

// ---------------------------------------------------------------------------
// Task engine — envelope + park/resume (§25, §28)
// ---------------------------------------------------------------------------

let taskCounter = 0;

/** Start a team's job: the agent gets that team's permission slip (envelope). */
export function startTask(jobId?: string): TaskEnvelope {
  const t = jobById(jobId);
  taskCounter += 1;
  const envelope: TaskEnvelope = {
    taskId: `task-${Date.now().toString(36)}-${taskCounter}`,
    jobId: t.id,
    team: t.team,
    approver: t.approver,
    approverRole: t.approverRole,
    templateName: t.envelope.name,
    title: t.title,
    agent: t.agent,
    user: t.user,
    allowedResources: [...t.envelope.allowedResources],
    allowedActions: [...t.envelope.allowedActions],
    environment: t.envelope.environment,
    forbidden: [...t.envelope.forbidden],
    durationMin: t.envelope.durationMin,
    startedAt: Date.now(),
    fileBudget: t.envelope.fileBudget,
    filesUsed: 0,
    status: "active",
    steps: t.steps.map((s, i) => ({
      index: i,
      label: s.label,
      action: s.action,
      resource: s.resource,
      dependsOn: s.dependsOn,
      state: "pending",
    })),
  };
  set({ tasks: [...state.tasks, envelope] });
  return envelope;
}

// Advance the task: run every step whose dependencies are satisfied.
export function advanceTask(taskId: string): void {
  const task = state.tasks.find((t) => t.taskId === taskId);
  if (!task || task.status !== "active") return;
  const t = jobById(task.jobId);
  let tasks = state.tasks;
  let events = state.events;
  let lastHash = state.lastHash;
  let tokens = state.tokens;
  let updated = { ...task, steps: task.steps.map((s) => ({ ...s })) };

  const stepDone = (i: number) => updated.steps[i].state === "done";

  for (const step of updated.steps) {
    if (step.state !== "pending") continue;
    const depsMet = step.dependsOn.every(stepDone);
    if (!depsMet) {
      const depStopped = step.dependsOn.some((d) => ["blocked", "skipped"].includes(updated.steps[d].state));
      const depParked = step.dependsOn.some((d) => ["parked", "waiting_dependency"].includes(updated.steps[d].state));
      if (depStopped) step.state = "skipped";
      else if (depParked) step.state = "waiting_dependency";
      continue;
    }
    const def = t.steps[step.index];
    const sc: Scenario = {
      id: `${taskId}-step-${step.index}`,
      group: "TASK",
      title: step.label,
      narrative: step.label,
      expected: "",
      plane: def.plane ?? (def.environment === "production" ? "GATEWAY" : "ENDPOINT"),
      action: def.action,
      actionRaw: def.actionRaw,
      agent: t.agent,
      user: t.user,
      application: def.application ?? "Terminal",
      resource: def.resource,
      environment: def.environment,
      sensitivity: def.sensitivity,
      destination: def.destination,
      destinationClass: def.destinationClass,
      fileName: def.fileName,
      payload: def.payload,
      findings: def.findings,
      blast: def.blast,
    };
    // The task's envelope goes to the brain, so allowed scope, forbidden scope,
    // time window, file budget and scoped grants are genuinely enforced.
    const out = runScenario(sc, state.contracts, lastHash, { kernel: state.kernel, envelope: updated, stops: activeStops(), taint: taintOf(t.agent) });
    out.event.taskId = taskId;
    out.event.stepIndex = step.index;
    out.event.dependsOn = step.dependsOn;
    tokens = [...tokens, ...out.tokens];
    if (out.event.decision === "REVIEW") {
      out.event.status = "parked";
      // Route the decision to this job's approver — never the requester.
      if (out.event.reviewState) out.event.reviewState = { ...out.event.reviewState, approver: t.approver };
      step.state = "parked";
    } else if (out.event.decision === "BLOCK") {
      step.state = "blocked";
    } else {
      step.state = "done";
      if (def.action === "WRITE") updated.filesUsed += 1;
    }
    step.decision = out.event.decision;
    step.eventId = out.event.id;
    events = [...events, out.event];
    lastHash = out.event.evidence.hash;
  }
  // Mark waiting steps.
  for (const step of updated.steps) {
    if (step.state === "pending" && step.dependsOn.some((d) => updated.steps[d].state === "parked")) {
      step.state = "waiting_dependency";
    }
  }
  // A step skipped earlier because its dependency was waiting may now be stuck behind a stop.
  for (const step of updated.steps) {
    if (step.state === "waiting_dependency" && step.dependsOn.some((d) => ["blocked", "skipped"].includes(updated.steps[d].state))) {
      step.state = "skipped";
    }
  }
  const allDone = updated.steps.every((s) => s.state === "done");
  const anyParked = updated.steps.some((s) => s.state === "parked" || s.state === "waiting_dependency");
  const anyPending = updated.steps.some((s) => s.state === "pending");
  updated.status = allDone ? "completed" : anyParked ? "parked" : anyPending ? "active" : "stopped";
  tasks = tasks.map((x) => (x.taskId === taskId ? updated : x));
  set({ tasks, events, lastHash, tokens });
}

function resumeParkedStep(taskId: string, eventId: string, resolution: string, reviewer: string) {
  const approved = resolution === "approved" || resolution === "approved_scoped" || resolution === "constrained";
  const ev = state.events.find((e) => e.id === eventId);
  let tasks = state.tasks.map((task) => {
    if (task.taskId !== taskId) return task;
    const steps = task.steps.map((s) => {
      if (s.eventId !== eventId) return s;
      return { ...s, state: approved ? ("done" as const) : ("blocked" as const) };
    });
    // "Approve scoped" widens this task's envelope for that resource +
    // environment; any approval re-authorizes the task, renewing its window.
    const grants = resolution === "approved_scoped" && ev
      ? [...(task.grants ?? []), { resource: ev.resource, environment: ev.environment, grantedBy: reviewer, at: Date.now() }]
      : task.grants;
    return { ...task, steps, grants, startedAt: approved ? Date.now() : task.startedAt, status: "active" as const };
  });
  state = { ...state, tasks };
  // Waiting dependents become pending again and run.
  tasks = state.tasks.map((task) => {
    if (task.taskId !== taskId) return task;
    const steps = task.steps.map((s) =>
      s.state === "waiting_dependency" ? { ...s, state: "pending" as const } : s
    );
    return { ...task, steps };
  });
  state = { ...state, tasks };
  emit();
  advanceTask(taskId);
}

// ---------------------------------------------------------------------------
// Contracts / standing / break-glass / autopilot / vault
// ---------------------------------------------------------------------------

export function upsertContract(c: IntentContract) {
  const exists = state.contracts.some((x) => x.id === c.id);
  set({
    contracts: exists
      ? state.contracts.map((x) => (x.id === c.id ? { ...c, version: x.version + 1 } : x))
      : [...state.contracts, c],
  });
}

/** Returns false (and changes nothing) when activation would be a false claim. */
export function setContractStatus(id: string, status: IntentContract["status"]): boolean {
  const target = state.contracts.find((c) => c.id === id);
  if (!target) return false;
  if (status === "ACTIVE" && !canActivate(target)) return false;
  set({ contracts: state.contracts.map((c) => (c.id === id ? { ...c, status, coverage: contractCoverage(c) } : c)) });
  return true;
}

/** Start an emergency override for ONE resource in ONE environment. The
 *  security analyst and engineering manager are notified (recorded). */
export function startBreakGlass(
  requester: string, reason: string, scopeResource: string, scopeEnvironment: Environment, scope: string, durationMin: number,
) {
  const bg: BreakGlassSession = {
    id: `bg-${Date.now().toString(36)}`,
    requester, reason, scope, scopeResource, scopeEnvironment,
    notified: ["u-maya", "u-alex"].filter((u) => u !== requester),
    durationMin: Math.min(60, Math.max(5, durationMin)),
    startedAt: Date.now(), active: true,
  };
  set({ breakGlass: [...state.breakGlass, bg] });
}

export function endBreakGlass(id: string) {
  set({ breakGlass: state.breakGlass.map((b) => (b.id === id ? { ...b, active: false } : b)) });
}

export function setAutopilotStatus(id: string, status: AutopilotRecommendation["status"]) {
  set({ autopilot: state.autopilot.map((a) => (a.id === id ? { ...a, status } : a)) });
}

/** Accept a recommendation: create a DRAFT rule (never active) or narrow a
 *  standing permission. Nothing is switched on or widened automatically. */
export function acceptAutopilot(id: string): string | undefined {
  const rec = state.autopilot.find((a) => a.id === id);
  if (!rec?.proposes || rec.status !== "open") return undefined;
  const p = rec.proposes;
  if (p.kind === "draft") {
    const contractId = `ic-${rec.id}`;
    const clauses = structuredClone(p.clauses);
    const draft: IntentContract = {
      id: contractId, name: p.name, author: "u-priya", createdAt: Date.now(), version: 1,
      status: "DRAFT", sourceText: p.sourceText, clauses, coverage: contractCoverage({ clauses }),
    };
    const result = `Created draft "${p.name}" — test it in the Policy Simulator, then switch it on in Intent Studio.`;
    set({
      contracts: [...state.contracts.filter((c) => c.id !== contractId), draft],
      autopilot: state.autopilot.map((a) => (a.id === id ? { ...a, status: "accepted", result, contractId } : a)),
    });
    return result;
  }
  const result = `Narrowed a standing permission: "${p.from}" → "${p.to}".`;
  set({
    standing: state.standing.map((sp) =>
      sp.id === p.standingId ? { ...sp, maxRows: p.maxRows } : sp),
    autopilot: state.autopilot.map((a) => (a.id === id ? { ...a, status: "accepted", result } : a)),
  });
  return result;
}

/** The admin rewrote a recommendation in the drafting panel and saved it as a draft. */
export function markAutopilotModified(id: string, contractId: string, name: string) {
  set({
    autopilot: state.autopilot.map((a) =>
      a.id === id ? { ...a, status: "modified", contractId, result: `Saved your edited version as draft "${name}".` } : a),
  });
}

export function revokeStanding(id: string) {
  set({ standing: state.standing.map((s) => (s.id === id ? { ...s, status: "revoked" } : s)) });
}

/** A human grants the permission again — a fresh 7-day window, recorded as theirs. */
export function grantStandingAgain(id: string, grantedBy: string) {
  set({
    standing: state.standing.map((s) =>
      s.id === id ? { ...s, status: "active", grantedBy, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 } : s),
  });
}

// ---------------------------------------------------------------------------
// Kill switch — stop one agent everywhere, in one step.
// ---------------------------------------------------------------------------

/** Stop an agent on every plane. Its held requests are cancelled and its
 *  running jobs stop; every later action is refused by the Core Brain until a
 *  person resumes it. Returns false if it is already stopped. */
export function stopAgent(agent: string, by: string, reason: string): boolean {
  if (stopOf(agent)) return false;
  const now = Date.now();
  const stop: AgentStop = { id: `stop-${now.toString(36)}-${state.stops.length}`, agent, by, reason, at: now, active: true };
  const byName = userById(by)?.name ?? by;
  const events = state.events.map((e) => {
    if (e.agent !== agent || e.reviewState?.status !== "pending") return e;
    return {
      ...e,
      reviewState: { ...e.reviewState, status: "denied" as const, reviewer: by, note: `Cancelled — agent stopped everywhere by ${byName}`, decidedAt: now },
      status: "blocked" as const,
      evidence: { ...e.evidence, chain: [...e.evidence.chain, { label: "Kill switch", detail: `Agent stopped by ${byName}: ${reason}` }, { label: "Outcome", detail: "Held request cancelled — action never ran" }] },
    };
  });
  const tasks = state.tasks.map((t) => {
    if (t.agent !== agent || (t.status !== "active" && t.status !== "parked")) return t;
    return {
      ...t, status: "stopped" as const,
      steps: t.steps.map((st) => (st.state === "parked" ? { ...st, state: "blocked" as const }
        : st.state === "pending" || st.state === "waiting_dependency" || st.state === "running" ? { ...st, state: "skipped" as const } : st)),
    };
  });
  set({ stops: [...state.stops, stop], events, tasks });
  return true;
}

/** Resume a stopped agent. Stopped jobs stay stopped — start them again if needed. */
export function resumeAgent(agent: string, by: string): boolean {
  const cur = stopOf(agent);
  if (!cur) return false;
  set({ stops: state.stops.map((x) => (x.id === cur.id ? { ...x, active: false, resumedBy: by, resumedAt: Date.now() } : x)) });
  return true;
}

// ---------------------------------------------------------------------------
// Derived metrics — every dashboard number comes from here.
// ---------------------------------------------------------------------------

export function metrics(s: AppState) {
  const counts: Record<Decision, number> = { ALLOW: 0, CONSTRAIN: 0, REVIEW: 0, BLOCK: 0 };
  let secretsProtected = 0;
  let transfersTransformed = 0;
  let highRisk = 0;
  for (const e of s.events) {
    counts[e.decision] += 1;
    if (e.decision === "BLOCK" && e.dataClasses.some((c) => c.startsWith("CREDENTIAL."))) secretsProtected += 1;
    if (e.transformation && e.transformation.length > 0) transfersTransformed += 1;
    if (e.risk === "high" || e.risk === "critical") highRisk += 1;
  }
  const pendingReviews = s.events.filter((e) => e.reviewState?.status === "pending").length;
  return { counts, secretsProtected, transfersTransformed, highRisk, pendingReviews, total: s.events.length };
}

export { SCENARIOS };
