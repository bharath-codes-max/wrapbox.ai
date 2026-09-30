import { useSyncExternalStore } from "react";
import { AGENTS, METHODS, agentById, type Assurance, type Decision } from "../data/agents";
import { INITIAL_RULES, ruleSig, type Rule } from "../data/contract";
import { PEOPLE, personById, type Person } from "../data/people";
import { fabricState, fabricTemplates } from "../data/fabric";
import type { AdapterKind, LaunchMode } from "../data/profiles";
import { SCENARIOS, actOf, type Gate, type Scenario } from "../data/scenarios";
import { evaluate, type Act, type Env, type Verdict } from "./engine";
import type { Permit } from "./permit";
import { TEMPLATES, approvalFrom, approversFor, categoryOf, gateFromAct, mkEvt, pick, rng } from "./traffic";

export { TEMPLATES, approvalFrom, categoryOf, gateFromAct, genericSignals, spaceOf } from "./traffic";

export type Role = "admin" | "employee";
export type WorkspaceId = "v2" | "live" | "fabric" | "fresh";
export const EMPLOYEE = PEOPLE.dev;
export const ADMIN = PEOPLE.priya;
export const NONE: string[] = [];

/** The environments. `labs` is the prototype scaffolding (playground, scripted flows, test traffic): it exists to
 *  explain and test Wrapbox, never in a reference. `fabric` is the install-once product; `sims` allows its
 *  "Simulate" controls (tamper, stop the runtime, quarantine) — device events the browser cannot cause for real. */
export interface WorkspaceMeta {
  id: WorkspaceId;
  label: string;
  kind: "reference" | "sandbox" | "fresh";
  labs: boolean;
  fabric: boolean;
  sims: boolean;
  /** Milliseconds between background decisions while the stream is live. */
  tick: number;
  blurb: string;
}
export const WORKSPACES: Record<WorkspaceId, WorkspaceMeta> = {
  v2: { id: "v2", label: "Wrapbox v2", kind: "fresh", labs: false, fabric: true, sims: false, tick: 0, blurb: "The real product. Empty until devices enroll and rules are created — data comes from the live Control Plane." },
  live: { id: "live", label: "Live demo", kind: "reference", labs: false, fabric: false, sims: true, tick: 0, blurb: "A click-driven playground: pick any agent surface, run an action, and see the real policy engine decide — simulated surroundings, real decisions." },
  fabric: { id: "fabric", label: "Enforcement Fabric — v2", kind: "reference", labs: false, fabric: true, sims: true, tick: 12_000, blurb: "Installed once per device. Every agent on it is discovered, provisioned, confined and credential-brokered — nothing installed per agent." },
  fresh: { id: "fresh", label: "Fresh workspace", kind: "fresh", labs: true, fabric: false, sims: false, tick: 2_400, blurb: "Completely empty. Start from zero and watch every page fill in." },
};
export const WORKSPACE_ORDER: WorkspaceId[] = ["v2", "live", "fabric", "fresh"];
/** v2 is the real product and the default landing spot after login. fabric (the
 *  earlier scripted reference) and fresh stay in the switcher — not hidden. */
export const VISIBLE_WORKSPACES: WorkspaceId[] = WORKSPACE_ORDER;

export interface Evt {
  id: string;
  ts: number;
  agentId: string;
  human: string;
  action: string;
  effect: string;
  decision: Decision;
  observed?: Decision;
  rule: string;
  reason: string;
  latency: number;
  /** The environment the action ran in. Optional: a live Control Plane receipt
   *  carries no environment, so cp-map leaves it unset rather than inventing one.
   *  Seeded/simulated events always set it. Absent renders as "not reported". */
  env?: Env;
  permit?: string;
  approvers?: string[];
  rewritten?: string;
  /** The normalized action the evaluator saw — what a replay re-decides. */
  act?: Act;
  source: "live" | "flow" | "seed" | "playground";
  /**
   * Chain fields exactly as the device signer emitted them (live receipts only).
   * Absent for simulated events — the mapper (cp-map.ts evtFromReceipt) populates
   * these from the receipt so Evidence renders the real chain instead of a
   * synthesized hash. Nothing may be shown in a hash/signature position that the
   * signer did not return.
   */
  seq?: number;
  prev?: string;
  sig?: string;
  keyId?: string;
  verified?: boolean;
}

export interface Approval {
  id: string;
  gateId: string;
  scenarioId?: string;
  agentId: string;
  title: string;
  human: Person;
  approvers: Person[];
  quorum: number;
  approvedBy: string[];
  signatures: Record<string, string>;
  status: "pending" | "approved" | "rejected";
  rejectReason?: string;
  createdAt: number;
  resolvedAt?: number;
  /** Assigned when the request is opened; the permit minted on approval carries this id. */
  permitId?: string;
  permit?: Permit;
  rule: string;
  reason: string;
  intent: string;
  gate: Gate;
  args?: Record<string, unknown>;
}

export interface AccessRequest {
  id: string;
  kind: "agent" | "exception";
  person: Person;
  agentId: string;
  reason: string;
  action?: string;
  rule?: string;
  status: "pending" | "approved" | "denied";
  at: number;
}

export interface Member {
  id: string;
  roles: string[];
  status: "active" | "invited";
}
export interface DeviceAgent {
  name: string;
  logo: string;
  state: "protected" | "degraded" | "shadow";
  note?: string;
  /** Why a degraded agent is degraded. Alerts on Team & devices derive from this. */
  issue?: { kind: "hook" | "key"; detail: string };
}
export interface Device {
  id: string;
  ownerId: string;
  os: string;
  osLogo: string;
  mdm: string;
  cli: string;
  seen: number;
  agents: DeviceAgent[];
}
export interface Alert {
  id: string;
  deviceId: string;
  agentName: string;
  tone: "block" | "review";
  kind: "hook" | "shadow" | "key";
  title: string;
  body: string;
  action: string;
}

export interface ContractChange {
  version: number;
  at: number;
  by: string;
  summary: string;
  added: string[];
  changed: string[];
  removed: string[];
}

/* ================= Enforcement Fabric: devices, gateway, broker, destinations ================= */
export type DeviceState = "enrolling" | "healthy" | "heartbeat-lost" | "quarantined";
export type AdapterState = "provisioned" | "tampered" | "re-provisioned";
export interface DiscoveredAgent {
  /** A catalog id, or "unknown:<binary>" for a process no profile matched. */
  agentId: string;
  binary: string;
  version: string;
  launchMode: LaunchMode;
  discoveredAt: number;
  /** For an unprofiled process: the model host the egress gate saw it reach. */
  endpoint?: string;
  adapter?: { path: string; kind: AdapterKind; state: AdapterState; writtenAt: number; sha256: string };
}
export interface FleetDevice {
  id: string;
  hostname: string;
  ownerId: string;
  os: string;
  osLogo: string;
  arch: string;
  enrolledAt: number;
  runtimeVersion: string;
  policyBundleVersion: number;
  /** When this device last pulled the ruleset into its local cache (ms epoch).
   *  0/undefined means it has never pulled, so no rule is actually enforced on
   *  it yet — the CP-backed posture pill depends on this. cp-map's deviceFromCp
   *  maps CpDeviceRow.ruleset_pulled_at into it; simulated workspaces leave it unset. */
  rulesetPulledAt?: number;
  heartbeat: number;
  state: DeviceState;
  killSwitch: boolean;
  /** Fingerprint of the device's enrollment key (Secure Enclave / TPM). Public, not a secret. */
  keyId: string;
  agents: DiscoveredAgent[];
}
export interface GatewayNode {
  id: string;
  region: string;
  version: string;
  state: "healthy" | "degraded";
  heartbeat: number;
  policyBundleVersion: number;
  /** MCP servers fronted by the virtual MCP server (catalog ids). */
  upstreams: string[];
  /** API hosts whose credentials the forward proxy injects. */
  brokered: string[];
}
export interface VaultRef {
  id: string;
  /** Reference only. The value never leaves the vault. */
  ref: string;
  kind: "api-key" | "oauth" | "db" | "cloud";
  upstream: string;
  provider: string;
  rotatedAt: number;
}
export interface SessionToken {
  id: string;
  agentId: string;
  deviceId: string;
  personId: string;
  issuedAt: number;
  ttlSeconds: number;
  scope: string[];
  state: "active" | "expired" | "revoked";
  revokedAt?: number;
  revokedBy?: string;
  reason?: string;
}
export interface Destination {
  id: string;
  kind: "scm.push" | "deploy" | "payment" | "mcp";
  label: string;
  host: string;
  tier0: boolean;
  verifier: string;
}

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "default" | "allow" | "block" | "review";
}

export interface PasskeyAsk {
  person: Person;
  title: string;
  detail: string;
}

export interface State {
  workspace: WorkspaceId;
  company: string;
  domain: string;
  region: string;
  idp: string;
  role: Role;
  theme: "light" | "dark";
  connected: Record<string, { method: string; assurance: Assurance; at: number }>;
  events: Evt[];
  approvals: Approval[];
  killSwitch: boolean;
  live: boolean;
  rules: Rule[];
  published: Rule[];
  version: number;
  publishedAt: number;
  changelog: ContractChange[];
  toasts: Toast[];
  tour: number | null;
  palette: boolean;
  requests: AccessRequest[];
  allowed: Record<string, string[]>;
  baseline: { decisions: number; blocked: number; rewritten: number };
  passkey: PasskeyAsk | null;
  onboarded: { admin: boolean; employee: boolean };
  groups: Record<string, string[]>;
  members: Member[];
  devices: Device[];
  envFilter: "all" | Env;
  fleet: FleetDevice[];
  gateways: GatewayNode[];
  vault: VaultRef[];
  sessions: SessionToken[];
  destinations: Destination[];
}

/** Decisions kept in memory per workspace. A real deployment pages older ones from the API. */
const RETENTION = 40_000;

/* ================= ids & helpers ================= */
let seq = 0;
const eid = () => "d-" + (0x4f81a2 + ++seq * 7919 + Math.floor(Math.random() * 97)).toString(16).slice(-6);

/** Approver group → people, never including the requester (separation of duties). */
export function resolveApprovers(group: string | undefined, requester: string, s: State = state): Person[] {
  return approversFor(group, requester, s.groups, adminPerson(s));
}

/* ================= seeds ================= */
const now = Date.now();
const recommended = (catId: keyof typeof METHODS) => METHODS[catId].find((m) => m.recommended) ?? METHODS[catId][0];

export const DEMO_GROUPS: State["groups"] = {
  "oncall-sre": ["dev.k", "arjun.n"],
  "claims-manager": ["meera.i", "rohan.d"],
  "payments-manager": ["sara.t"],
  "sales-manager": ["ananya.r"],
  "vp-sales": ["ananya.r"],
  "finance-controller": ["vikram.s"],
};

const DEMO_MEMBERS: Member[] = [
  { id: "priya.m", roles: ["Admin", "Owner"], status: "active" },
  { id: "dev.k", roles: ["Developer", "Approver · oncall-sre"], status: "active" },
  { id: "arjun.n", roles: ["Developer", "Approver · oncall-sre"], status: "active" },
  { id: "sara.t", roles: ["Support", "Approver · payments-manager"], status: "active" },
  { id: "anjali.v", roles: ["Business user"], status: "active" },
  { id: "kiran.b", roles: ["Business user"], status: "active" },
  { id: "neha.j", roles: ["Business user"], status: "active" },
  { id: "meera.i", roles: ["Approver · claims-manager"], status: "active" },
  { id: "rohan.d", roles: ["Approver · claims-manager"], status: "active" },
  { id: "ananya.r", roles: ["Approver · vp-sales"], status: "active" },
  { id: "vikram.s", roles: ["Approver · finance-controller"], status: "active" },
];

const DEMO_ALLOWED: State["allowed"] = {
  "dev.k": ["cursor", "claude-code", "codex-cli", "github-mcp"],
  "arjun.n": ["claude-code", "cursor", "copilot-ide", "copilot-cloud", "github-mcp", "postgres-mcp"],
  "sara.t": ["stripe-mcp", "github-mcp", "postgres-mcp"],
  "anjali.v": ["langgraph"],
  "kiran.b": ["agentforce"],
  "neha.j": ["browser-use"],
};

const DEMO_DEVICES: Device[] = [
  { id: "dk-macbook-pro", ownerId: "dev.k", os: "macOS 15.6", osLogo: "apple", mdm: "Jamf", cli: "1.4.2", seen: now - 2 * 60_000, agents: [{ name: "Cursor", logo: "cursor", state: "protected", note: "hooks.json · failClosed" }, { name: "Claude Code", logo: "claudecode", state: "protected", note: "managed settings" }, { name: "Codex CLI", logo: "codex", state: "protected", note: "~/.codex/hooks.json" }] },
  { id: "dev-linux-01", ownerId: "dev.k", os: "Ubuntu 24.04", osLogo: "ubuntu", mdm: "—", cli: "1.4.2", seen: now - 60 * 60_000, agents: [{ name: "Codex CLI", logo: "codex", state: "degraded", note: "token expires in 2 days", issue: { kind: "key", detail: "expires in 2 days" } }] },
  { id: "arjun-mbp", ownerId: "arjun.n", os: "macOS 15.6", osLogo: "apple", mdm: "Jamf", cli: "1.4.1", seen: now - 6 * 60_000, agents: [{ name: "Claude Code", logo: "claudecode", state: "protected", note: "managed settings" }, { name: "Cursor", logo: "cursor", state: "degraded", note: ".cursor/hooks.json removed 14m ago · runtime still enforcing", issue: { kind: "hook", detail: ".cursor/hooks.json was deleted 14 minutes ago" } }, { name: "Copilot agent mode", logo: "githubcopilot", state: "protected", note: ".github/hooks" }] },
  { id: "sara-mbp", ownerId: "sara.t", os: "macOS 15.5", osLogo: "apple", mdm: "Jamf", cli: "1.4.2", seen: now - 14 * 60_000, agents: [{ name: "Claude (MCP via gateway)", logo: "claude", state: "protected", note: "mcp.wrapbox.ai/stripe" }] },
  { id: "neha-win", ownerId: "neha.j", os: "Windows 11", osLogo: "windows", mdm: "Intune", cli: "1.4.2", seen: now - 9 * 60_000, agents: [{ name: "Browser Use", logo: "browseruse", state: "protected", note: "controlled executor" }, { name: "Windsurf", logo: "windsurf", state: "shadow", note: "found by the endpoint runtime · not in the contract" }] },
  { id: "anjali-win", ownerId: "anjali.v", os: "Windows 11", osLogo: "windows", mdm: "Intune", cli: "—", seen: now - 60 * 60_000, agents: [] },
];


function v2State(): State {
  return {
    ...freshState(),
    workspace: "v2",
    company: "Wrapbox",
    domain: "wrapbox.ai",
    region: "us",
    idp: "",
  };
}

/** The pitch theatre. Self-contained — the film carries its own beats, so it needs no seeded fleet data. */
function liveState(): State {
  return { ...freshState(), workspace: "live", company: "Northwind Financial", domain: "northwind.example", region: "us" };
}

function freshState(): State {
  return {
    workspace: "fresh",
    company: "Wrapbox",
    domain: "wrapbox.ai",
    region: "us",
    idp: "",
    role: "admin",
    theme: "light",
    connected: {},
    events: [],
    approvals: [],
    killSwitch: false,
    live: false,
    rules: [],
    published: [],
    version: 0,
    publishedAt: 0,
    changelog: [],
    toasts: [],
    tour: null,
    palette: false,
    requests: [],
    allowed: {},
    baseline: { decisions: 0, blocked: 0, rewritten: 0 },
    passkey: null,
    onboarded: { admin: false, employee: false },
    groups: {},
    members: [{ id: "priya.m", roles: ["Admin", "Owner"], status: "active" }],
    devices: [],
    envFilter: "all",
    fleet: [],
    gateways: [],
    vault: [],
    sessions: [],
    destinations: [],
  };
}

/* ================= persistence ================= */
function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode, sandbox) */
  }
}
const FRESH_KEY = "wbx-fresh-v2";
const UI_KEYS = ["role", "theme", "toasts", "tour", "palette", "passkey"] as const;
function persistable(s: State) {
  const copy: Partial<State> = { ...s };
  for (const k of UI_KEYS) delete copy[k];
  return copy;
}
function loadFresh(): State {
  const saved = read<Partial<State> | null>(FRESH_KEY, null);
  return saved ? { ...freshState(), ...saved, workspace: "fresh", live: false } : freshState();
}

/* ================= the store ================= */
/** Workspaces are built on first use: the reference tenant carries two weeks of decisions and is only paid for when opened. */
const spaces: Partial<Record<WorkspaceId, State>> = {};
const BUILD: Record<WorkspaceId, () => State> = { v2: v2State, live: liveState, fabric: () => fabricState(), fresh: loadFresh };
export function space(id: WorkspaceId): State {
  return (spaces[id] ??= BUILD[id]());
}
const theme = read<"light" | "dark">("wbx-theme", "light");
const savedWs = read<string>("wbx-ws", "v2");
const startWs: WorkspaceId = savedWs in WORKSPACES ? (savedWs as WorkspaceId) : "v2";
let state: State = { ...space(startWs), theme };
if (typeof window !== "undefined") {
  const warm = () => VISIBLE_WORKSPACES.forEach((id) => space(id));
  if ("requestIdleCallback" in window) window.requestIdleCallback(warm);
  else setTimeout(warm, 800);
}

const listeners = new Set<() => void>();
let saveTimer: number | undefined;
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  spaces[state.workspace] = state;
  listeners.forEach((l) => l());
  if (state.workspace === "fresh") {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => write(FRESH_KEY, persistable(space("fresh"))), 400);
  }
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const subscribeStore = subscribe;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}
export const wsMeta = (id: WorkspaceId = state.workspace) => WORKSPACES[id];
export const useWorkspace = () => useStore((s) => WORKSPACES[s.workspace]);
/** Where a signed-in person lands: the Fleet in the install-once product, the workspace hub otherwise. */
export const homePath = () => (WORKSPACES[state.workspace].fabric ? "/" : "/start");

export function switchWorkspace(id: WorkspaceId) {
  if (state.workspace === id) return;
  const ui: Partial<State> = {};
  for (const k of UI_KEYS) (ui as Record<string, unknown>)[k] = state[k];
  spaces[state.workspace] = state;
  state = { ...space(id), ...ui, passkey: null };
  spaces[id] = state;
  write("wbx-ws", id);
  listeners.forEach((l) => l());
}
export function resetFresh() {
  spaces.fresh = freshState();
  write(FRESH_KEY, null);
  if (state.workspace === "fresh") {
    const ui: Partial<State> = {};
    for (const k of UI_KEYS) (ui as Record<string, unknown>)[k] = state[k];
    state = { ...spaces.fresh, ...ui };
    spaces.fresh = state;
    listeners.forEach((l) => l());
  }
}
export const workspaceHasData = (id: WorkspaceId) => {
  const s = id === state.workspace ? state : space(id);
  return s.events.length > 0 || Object.keys(s.connected).length > 0 || s.rules.length > 0;
};
/** Headline numbers for a workspace — the switcher and the start page read these instead of hard-coding them. */
export function workspaceSummary(id: WorkspaceId) {
  const s = id === state.workspace ? state : space(id);
  return {
    company: s.company,
    label: WORKSPACES[id].label,
    agents: Object.keys(s.connected).length,
    approvals: s.approvals.filter((a) => a.status === "pending").length,
    version: s.version,
    rules: s.published.length,
    members: s.members.length,
    devices: s.devices.length,
    decisions: s.baseline.decisions + s.events.length,
  };
}
/** Who runs this workspace: the member holding the Admin role. Every "waiting for …" line derives from this. */
export function adminPerson(s: State = state): Person {
  const m = s.members.find((x) => x.roles.includes("Admin"));
  return (m && Object.values(PEOPLE).find((p) => p.id === m.id)) || ADMIN;
}
/** Where a tenant's control plane runs. One table so the label, the country and the flag never drift. */
export const REGIONS: Record<string, { label: string; country: string; flag: string }> = {
  us: { label: "us-east-1", country: "United States", flag: "flag-us" },
  eu: { label: "eu-central-1", country: "European Union", flag: "flag-eu" },
  in: { label: "ap-south-1", country: "India", flag: "flag-in" },
};
export const regionOf = (region: string) => REGIONS[region] ?? REGIONS.us;
/** Region label for the control plane — the same string onboarding shows when the workspace is created. */
export const regionLabel = (region: string) => regionOf(region).label;

/* ================= alerts: derived from what the laptops report ================= */
export function deriveAlerts(devices: Device[]): Alert[] {
  const out: Alert[] = [];
  for (const d of devices)
    for (const a of d.agents) {
      const id = `al-${d.id}-${a.name}`;
      const via = d.mdm === "—" ? "Reinstall hooks" : `via ${d.mdm}`;
      if (a.state === "shadow") out.push({ id, deviceId: d.id, agentName: a.name, tone: "review", kind: "shadow", title: `Shadow agent on ${d.id}`, body: `${a.name} is running outside the contract. The endpoint runtime found it — it isn't governed yet.`, action: d.mdm === "—" ? "Block on the device" : `Block ${via}` });
      else if (a.state === "degraded" && a.issue?.kind === "hook") out.push({ id, deviceId: d.id, agentName: a.name, tone: "block", kind: "hook", title: `Hook removed on ${d.id}`, body: `${a.issue.detail}. The endpoint runtime is still enforcing (fail-closed), so nothing got through.`, action: d.mdm === "—" ? "Reinstall hooks" : `Re-push ${via}` });
      else if (a.state === "degraded" && a.issue?.kind === "key") out.push({ id, deviceId: d.id, agentName: a.name, tone: "review", kind: "key", title: `Credential expiring on ${d.id}`, body: `The ${a.name} agent token ${a.issue.detail}. Rotation keeps the agent identity; no config change needed.`, action: "Rotate now" });
    }
  return out;
}
/** Acting on an alert changes the laptop it came from, so Team & devices, the KPIs and the alert list agree. */
export function resolveAlert(id: string) {
  setState((s) => ({
    devices: s.devices.map((d) => ({
      ...d,
      agents: d.agents
        .filter((a) => !(`al-${d.id}-${a.name}` === id && a.state === "shadow"))
        .map((a) =>
          `al-${d.id}-${a.name}` === id && a.state === "degraded"
            ? { ...a, state: "protected" as const, issue: undefined, note: a.issue?.kind === "key" ? "token rotated · valid 30 days" : d.mdm === "—" ? "hooks reinstalled" : `hooks re-pushed by ${d.mdm}` }
            : a,
        ),
    })),
  }));
}

/* ================= actions ================= */
let toastId = 0;
export function toast(title: string, body?: string, tone: Toast["tone"] = "default") {
  const t = { id: ++toastId, title, body, tone };
  setState((s) => ({ toasts: [...s.toasts, t] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 4200);
}

export function setTheme(theme: "light" | "dark") {
  write("wbx-theme", theme);
  setState({ theme });
}

export function markOnboarded(role: Role) {
  const onboarded = { ...state.onboarded, [role]: true };
  write("wbx-onboarded", onboarded);
  setState({ onboarded });
}

export function pushEvent(e: Omit<Evt, "id" | "ts" | "env"> & { id?: string; ts?: number; env?: Env }) {
  const evt: Evt = { env: "production", ...e, id: e.id ?? eid(), ts: e.ts ?? Date.now() } as Evt;
  setState((s) => ({ events: [evt, ...s.events].slice(0, RETENTION) }));
  return evt;
}

/** Evaluate an action against the published contract of the active workspace. */
export function evaluateNow(a: Act, agentId: string, draft = false): Verdict {
  const s = getState();
  return evaluate(a, draft ? s.rules : s.published, categoryOf(agentId), { kill: s.killSwitch });
}

export function connectAgent(id: string, method: string, assurance: Assurance) {
  setState((s) => ({ connected: { ...s.connected, [id]: { method, assurance, at: Date.now() } } }));
}
export function disconnectAgent(id: string) {
  setState((s) => {
    const c = { ...s.connected };
    delete c[id];
    return { connected: c };
  });
}

/** Publish the draft: the new version, when, by whom, and which rules it added, changed or removed. */
export function publishContract(by: string = adminPerson().id) {
  setState((s) => {
    const before = new Map(s.published.map((r) => [r.id, ruleSig(r)]));
    const after = new Map(s.rules.map((r) => [r.id, ruleSig(r)]));
    const added = s.rules.filter((r) => !before.has(r.id)).map((r) => r.id);
    const changed = s.rules.filter((r) => before.has(r.id) && before.get(r.id) !== after.get(r.id)).map((r) => r.id);
    const removed = s.published.filter((r) => !after.has(r.id)).map((r) => r.id);
    const version = s.version + 1;
    const at = Date.now();
    const parts = [added.length ? `added ${added.join(", ")}` : "", changed.length ? `changed ${changed.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""].filter(Boolean);
    const summary = parts.length ? parts.join(" · ").replace(/^\w/, (c) => c.toUpperCase()) : "Republished without rule changes";
    return { published: s.rules, version, publishedAt: at, changelog: [...s.changelog, { version, at, by, summary, added, changed, removed }] };
  });
}

export function approve(approvalId: string, personId: string, signature: string) {
  setState((s) => ({
    approvals: s.approvals.map((a) => {
      if (a.id !== approvalId || a.status !== "pending" || a.approvedBy.includes(personId)) return a;
      const approvedBy = [...a.approvedBy, personId];
      const done = approvedBy.length >= a.quorum;
      return { ...a, approvedBy, signatures: { ...a.signatures, [personId]: signature }, status: done ? "approved" : "pending", resolvedAt: done ? Date.now() : a.resolvedAt };
    }),
  }));
}
export function reject(approvalId: string, reason: string) {
  const a = state.approvals.find((x) => x.id === approvalId);
  setState((s) => ({ approvals: s.approvals.map((x) => (x.id === approvalId ? { ...x, status: "rejected", rejectReason: reason, resolvedAt: Date.now() } : x)) }));
  // Requests that came from live traffic or the playground record their outcome here; scripted flows record their own.
  if (a && a.status === "pending" && !a.scenarioId)
    pushEvent({ agentId: a.agentId, human: a.human.id, action: a.title, effect: a.gate.effect, decision: "BLOCK", rule: a.rule, reason: `rejected by approver — ${reason}`, latency: 2, env: (a.gate.environment as Env) || "production", act: a.args as Act | undefined, source: "live" });
}
export function attachPermit(approvalId: string, permit: Permit) {
  const a = state.approvals.find((x) => x.id === approvalId);
  // One permit per approval: whichever caller mints first wins, so two screens can never disagree on the id.
  if (!a || a.permit) return;
  // The execution is recorded once per permit: a request resolved before this session already carries its record.
  const recorded = state.events.some((e) => e.permit === permit.id);
  setState((s) => ({ approvals: s.approvals.map((x) => (x.id === approvalId ? { ...x, permit } : x)) }));
  if (!a.scenarioId && a.status === "approved" && !recorded)
    pushEvent({ agentId: a.agentId, human: a.human.id, action: a.title, effect: a.gate.effect, decision: "ALLOW", rule: a.rule, reason: `approved · ${a.reason}`, latency: 2, env: (a.gate.environment as Env) || "production", permit: permit.id, approvers: a.approvedBy, act: a.args as Act | undefined, source: "live" });
}
export function upsertApproval(ap: Approval) {
  setState((st) => {
    const exists = st.approvals.find((a) => a.id === ap.id);
    if (exists && exists.status === "pending") return {};
    return { approvals: [ap, ...st.approvals.filter((a) => a.id !== ap.id)] };
  });
  return ap.id;
}
export function ensurePending(s: Scenario, g: Gate, agentId: string, v: Verdict) {
  const gate: Gate = { ...g, decision: v.decision, rule: v.rule, reason: v.rule === g.rule ? g.reason : v.reason };
  return upsertApproval(approvalFrom({ gate, agentId, human: s.human, intent: s.prompt, approvers: resolveApprovers(v.approvers, s.human.id), quorum: v.quorum, scenarioId: s.id }));
}

/* ================= passkey ================= */
let passkeyResolve: ((ok: boolean) => void) | null = null;
export function askPasskey(ask: PasskeyAsk): Promise<boolean> {
  passkeyResolve?.(false);
  setState({ passkey: ask });
  return new Promise((r) => (passkeyResolve = r));
}
export function settlePasskey(ok: boolean) {
  setState({ passkey: null });
  passkeyResolve?.(ok);
  passkeyResolve = null;
}

/* ================= live traffic ================= */
let timer: number | undefined;
let lastTick = 0;
export function tickTraffic(n = 1) {
  const s = getState();
  const templates = s.workspace === "v2" ? [] : s.workspace === "fabric" ? fabricTemplates(s) : TEMPLATES;
  const ctx = { rules: s.published, kill: s.killSwitch, members: s.members, allowed: s.allowed, admin: adminPerson(s).id, attributeAsIs: WORKSPACES[s.workspace].fabric };
  const evts: Evt[] = [];
  const aps: Approval[] = [];
  for (let i = 0; i < n; i++) {
    const t = pick(templates, s.connected, Math.random);
    if (!t) break;
    const e = mkEvt(t, Date.now() - i * 1500, "live", ctx, Math.random);
    evts.push(e);
    if (e.decision === "REVIEW" && e.act && s.approvals.filter((a) => a.status === "pending").length + aps.length < 6) {
      const v = evaluate(e.act, s.published, categoryOf(t.agentId));
      const human = personById(e.human) ?? adminPerson(s);
      aps.push(approvalFrom({ gate: gateFromAct(e.id, e.action, e.act, v), agentId: t.agentId, human, intent: `${agentById(t.agentId).name} session for ${human.name}`, approvers: resolveApprovers(v.approvers, human.id, s), quorum: v.quorum, args: { ...e.act } }));
    }
  }
  if (!evts.length) return 0;
  setState((st) => ({
    events: [...evts, ...st.events].slice(0, RETENTION),
    approvals: [...aps, ...st.approvals],
    baseline: st.baseline,
  }));
  return evts.length;
}
export function startLive() {
  if (timer) return;
  timer = window.setInterval(() => {
    const s = getState();
    if (!s.live || document.hidden) return;
    const t = Date.now();
    if (t - lastTick < WORKSPACES[s.workspace].tick) return;
    lastTick = t;
    tickTraffic(1);
  }, 600);
}

export const TOUR = [
  { path: "/start", title: "Start where a new customer starts", body: "Explore the live demo, or open a fresh, empty workspace and build everything yourself — every page fills in from what you do." },
  { path: "/onboarding/admin", title: "Admin setup, from zero", body: "Create the workspace, discover agents, pick policy packs, connect agents (hooks, SDK, MCP), set approvers, invite the team, see the first decision." },
  { path: "/contract", title: "Write the contract yourself", body: "Add a rule with the builder or type YAML. Test any action against your draft, then publish — flows and the live stream follow it." },
  { path: "/playground", title: "Try any action", body: "Type what an agent would run — a command, a file read, a refund — and watch Wrapbox evaluate it against your contract, with a rule-by-rule trace.", labs: true },
  { path: "/flows/cli", title: "Watch a full flow", body: "Claude Code tries a prod delete, Wrapbox holds it, the on-call engineer approves with a passkey, and the executor verifies the signed permit.", labs: true },
  { path: "/approvals", title: "The approval studio", body: "Intent vs action, dry run, risk signals, history and a signed approval. Tamper with the arguments and watch the permit fail." },
  { path: "/team", title: "Monitor people and devices", body: "Who uses which agent, hook health per laptop, shadow agents, and exception requests." },
  { path: "/onboarding/employee", title: "The employee side", body: "Accept the invite, one command on the laptop, the rules in plain English, try a blocked action, approve from Slack.", role: "employee" as Role },
];
/** The tour for the active workspace: prototype-only stops are left out where the scaffolding isn't shown.
 *  The install-once product gets its own tour (built with its onboarding); until then it has none. */
export const tourFor = (id: WorkspaceId = state.workspace) => (WORKSPACES[id].fabric ? [] : TOUR.filter((t) => !("labs" in t && t.labs) || WORKSPACES[id].labs));

/* ================= directory & devices (fresh workspaces grow through these) ================= */
export const DEFAULT_ROLES: Record<string, string[]> = {
  ...Object.fromEntries(DEMO_MEMBERS.map((m) => [m.id, m.roles])),
  "maya.s": ["Admin", "Security"],
  "rahul.m": ["Developer", "Approver · oncall-sre"],
  "tanvi.k": ["Developer"],
  "jonas.w": ["Developer"],
  "ishaan.p": ["Developer"],
  "omar.h": ["Developer"],
  "sneha.g": ["IT admin"],
  "farah.a": ["Support"],
  "leah.c": ["Approver · payments-manager"],
  "nikhil.r": ["Business user"],
};
const DEFAULT_AGENTS: Record<string, string[]> = {
  "dev.k": ["cursor", "claude-code", "codex-cli"],
  "arjun.n": ["claude-code", "cursor", "copilot-ide", "copilot-cloud"],
  "rahul.m": ["claude-code", "codex-cli"],
  "tanvi.k": ["cursor", "windsurf"],
  "jonas.w": ["claude-code", "copilot-ide", "copilot-cloud"],
  "ishaan.p": ["claude-code", "postgres-mcp"],
  "omar.h": ["claude-code", "postgres-mcp"],
  "maya.s": ["claude-code"],
  "sara.t": ["stripe-mcp", "github-mcp", "postgres-mcp"],
  "farah.a": ["stripe-mcp"],
  "anjali.v": ["langgraph"],
  "nikhil.r": ["langgraph"],
  "kiran.b": ["agentforce"],
  "neha.j": ["browser-use"],
};

/** Okta/SCIM sync: everyone arrives as "invited"; approver groups get their defaults. */
export function syncDirectory() {
  setState((s) => {
    const have = new Set(s.members.map((m) => m.id));
    const add: Member[] = Object.values(PEOPLE)
      .filter((p) => !have.has(p.id))
      .map((p) => ({ id: p.id, roles: DEFAULT_ROLES[p.id] ?? ["Member"], status: "invited" }));
    const groups = Object.keys(s.groups).length ? s.groups : DEMO_GROUPS;
    const allowed = { ...s.allowed };
    for (const [pid, agents] of Object.entries(DEFAULT_AGENTS)) allowed[pid] = Array.from(new Set([...(allowed[pid] ?? []), ...agents.filter((a) => s.connected[a])]));
    return { members: [...s.members, ...add], groups, allowed };
  });
}

/** Grants every synced person the connected agents their role would use. */
export function grantConnectedAgents() {
  setState((s) => {
    const allowed = { ...s.allowed };
    for (const [pid, agents] of Object.entries(DEFAULT_AGENTS)) if (s.members.some((m) => m.id === pid)) allowed[pid] = Array.from(new Set([...(allowed[pid] ?? []), ...agents.filter((a) => s.connected[a])]));
    return { allowed };
  });
}

/** An employee's laptop checks in after `wrapbox install`. */
export function registerDevice(ownerId: string, agents: DeviceAgent[]) {
  setState((s) => ({
    devices: [
      { id: ownerId === "dev.k" ? "dk-macbook-pro" : `${ownerId.split(".")[0]}-laptop`, ownerId, os: "macOS 15.6", osLogo: "apple", mdm: "Jamf", cli: "1.4.2", seen: Date.now(), agents },
      ...s.devices.filter((d) => d.ownerId !== ownerId),
    ],
    members: s.members.some((m) => m.id === ownerId) ? s.members.map((m) => (m.id === ownerId ? { ...m, status: "active" } : m)) : [...s.members, { id: ownerId, roles: DEFAULT_ROLES[ownerId] ?? ["Member"], status: "active" }],
  }));
}

/* Local verification only: the sweep harness reads workspace state through this. Never present in a build. */
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __wbx: unknown }).__wbx = { getState, space, setState, switchWorkspace, deriveAlerts, evaluate, categoryOf };
