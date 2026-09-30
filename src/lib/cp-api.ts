/**
 * Thin fetch wrappers around the Control Plane admin endpoints.
 * Every call carries X-Admin-Key from cp-config and an AbortSignal.timeout(4000).
 * Nothing throws — callers switch on { ok, status, data | error }.
 */

import { getCpConfig, type CpConfig } from "./cp-config";

export interface Ok<T> { ok: true; status: number; data: T }
export interface Err { ok: false; status: number; error: string }
export type Result<T> = Ok<T> | Err;

const TIMEOUT_MS = 4000;

function trimServer(server: string): string {
  return server.replace(/\/+$/, "");
}

function timeoutSignal(): AbortSignal {
  // AbortSignal.timeout may not exist on very old runtimes; guard.
  if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as unknown as { timeout?: (n: number) => AbortSignal }).timeout === "function") {
    return (AbortSignal as unknown as { timeout: (n: number) => AbortSignal }).timeout(TIMEOUT_MS);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return ctrl.signal;
}

async function get<T>(path: string, cfgOverride?: Partial<CpConfig>): Promise<Result<T>> {
  const cfg = { ...getCpConfig(), ...cfgOverride };
  if (!cfg.server || !cfg.adminKey) return { ok: false, status: 0, error: "unconfigured" };
  const url = `${trimServer(cfg.server)}${path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Admin-Key": cfg.adminKey, Accept: "application/json" },
      signal: timeoutSignal(),
    });
    let payload: unknown = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!res.ok) {
      const err = (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error: unknown }).error === "string")
        ? (payload as { error: string }).error
        : `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: err };
    }
    return { ok: true, status: res.status, data: payload as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg || "network error" };
  }
}

/**
 * Write helper. Kept separate from `get` so the read path stays trivially
 * auditable: anything that CHANGES the tenant's policy goes through here and
 * carries the admin key explicitly.
 */
async function send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Result<T>> {
  const cfg = getCpConfig();
  if (!cfg.server || !cfg.adminKey) return { ok: false, status: 0, error: "unconfigured" };
  const url = `${trimServer(cfg.server)}${path}`;
  try {
    // Content-Type is set ONLY when there is a body. Fastify rejects a request
    // that declares application/json and then sends nothing
    // (FST_ERR_CTP_EMPTY_JSON_BODY), which is what made every DELETE fail with
    // "Bad Request" while looking like the button did nothing.
    const headers: Record<string, string> = {
      "X-Admin-Key": cfg.adminKey,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal(),
    });
    let payload: unknown = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!res.ok) {
      const err = (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error: unknown }).error === "string")
        ? (payload as { error: string }).error
        : `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: err };
    }
    return { ok: true, status: res.status, data: payload as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg || "network error" };
  }
}

/* --------------- Endpoint shapes as CP actually returns them --------------- */

export interface CpOrg {
  id: string;
  name: string;
  domain: string | null;
  region: string;
  created_at?: string;
}
export interface CpDeviceRow {
  id: string;
  hostname: string;
  os: string;
  arch: string | null;
  owner_email: string | null;
  state: string;
  last_heartbeat: string | null;
  key_id: string | null;
  daemon_version: string | null;
  ruleset_pulled_at: string | null;
  chain_head_seq: number | null;
  created_at: string | null;
}
export interface CpRuleRow {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  effect: "allow" | "constrain" | "block" | "review";
  priority: number;
  condition_json: string | null;
  constraint_json?: string | null;
  active?: number | boolean;
  created_at?: string | null;
}
export interface CpAgentRow {
  id: string;
  device_id: string;
  name?: string;
  kind?: string;
  detected_via?: string;
  where?: string;
  version?: string;
  last_seen_at?: string;
  created_at?: string;
  [k: string]: unknown;
}
export interface CpReceiptRow {
  id: string;
  device_id: string;
  seq: number;
  ts: string;
  verified: boolean;
  created_at: string | null;
  receipt: {
    v?: number;
    id: string;
    seq: number;
    ts: string;
    device_id: string;
    key_id?: string;
    agent?: string;
    session?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_input_sha256?: string;
    target?: string;
    effect: string;
    reason?: string;
    rule_id?: string | null;
    ruleset_pulled_at?: string | null;
    enforcement?: string;
    /** Browser or tool that made the request (attribution only). */
    client?: string;
    client_label?: string;
    /** Destination as a recognised service, when it is one. */
    service?: string;
    service_label?: string;
    degraded?: boolean;
    prev?: string;
    sig?: string;
  };
}
export interface CpVerifyChain {
  device_id: string;
  total: number;
  verified_through_seq: number;
  chain_ok: boolean;
  breaks: Array<{ seq: number; kind: string; detail: string }>;
}

export const listOrgs = () => get<CpOrg[]>("/v1/orgs");
export const listDevices = (orgId: string) => get<CpDeviceRow[]>(`/v1/devices?org_id=${encodeURIComponent(orgId)}`);
export const listAgents = (orgId: string) => get<CpAgentRow[]>(`/v1/agents?org_id=${encodeURIComponent(orgId)}`);
export const listRules = (orgId: string) => get<CpRuleRow[]>(`/v1/rules?org_id=${encodeURIComponent(orgId)}`);
export const listReceipts = (orgId: string, opts: { limit?: number; deviceId?: string } = {}) => {
  const params = new URLSearchParams({ org_id: orgId, limit: String(opts.limit ?? 200) });
  if (opts.deviceId) params.set("device_id", opts.deviceId);
  return get<CpReceiptRow[]>(`/v1/receipts?${params.toString()}`);
};
export const verifyChain = (orgId: string, deviceId: string) =>
  get<CpVerifyChain>(`/v1/evidence/verify?org_id=${encodeURIComponent(orgId)}&device_id=${encodeURIComponent(deviceId)}`);

/* --------------------------- Authoring rules --------------------------- */

/** A condition the device-side evaluator understands. */
export interface CpCondition {
  field: string;
  op: "contains" | "not_contains" | "equals" | "starts_with" | "regex" | "gt" | "lt" | "gte" | "lte" | "any_of" | "none_of" | "has" | "finding";
  value: string;
}

/** A constraint the runtime applies when effect is "constrain". */
export interface CpConstraint {
  kind: "reversible_tokenize" | "redact";
  fields?: string[];
  classes?: string[];
  /** v2: Transform Registry handler + params. */
  handler?: string;
  params?: Record<string, unknown>;
}

/** Provenance stored with a rule and echoed into evidence. */
export interface CpRuleMeta {
  clause_id: string;
  contract_id?: string;
  ir_schema: string;
  kind: "clause" | "carrier";
  coverage: "enforced" | "degraded" | "understood_only" | "pending";
  pins?: Record<string, string>;
}

export interface CpRuleInput {
  name: string;
  description?: string;
  effect: "allow" | "constrain" | "block" | "review";
  priority: number;
  /** null / omitted means "matches everything" — used for a catch-all. */
  condition?: CpCondition | CpCondition[] | null;
  /** Required by the server when effect is "constrain". */
  constraint?: CpConstraint | null;
  clause_id?: string;
  contract_id?: string;
  meta?: CpRuleMeta;
}

export function createRule(orgId: string, rule: CpRuleInput) {
  const body: Record<string, unknown> = {
    org_id: orgId,
    name: rule.name,
    effect: rule.effect,
    priority: rule.priority,
  };
  if (rule.description) body.description = rule.description;
  // Send `condition` only when there is one: the API treats an absent
  // condition as "matches everything", and sending an empty object would be a
  // condition that never matches — the opposite of what the author meant.
  if (rule.condition) body.condition = rule.condition;
  if (rule.constraint) body.constraint = rule.constraint;
  if (rule.clause_id) body.clause_id = rule.clause_id;
  if (rule.contract_id) body.contract_id = rule.contract_id;
  if (rule.meta) body.meta = rule.meta;
  return send<CpRuleRow>("POST", "/v1/rules", body);
}

/* --------------------------- Capabilities / destinations --------------------------- */

/** The latest runtime capability snapshot any device of the org reported (v2). */
export function getCapabilities(orgId: string) {
  return get<{ device_id: string | null; capabilities_at?: string | null; capabilities: unknown | null }>(`/v1/capabilities?org_id=${encodeURIComponent(orgId)}`);
}

export function getDestinations(orgId: string) {
  return get<Record<string, unknown>>(`/v1/orgs/${encodeURIComponent(orgId)}/destinations`);
}

export function putDestinations(orgId: string, cfg: Record<string, unknown>) {
  return send<Record<string, unknown>>("PUT", `/v1/orgs/${encodeURIComponent(orgId)}/destinations`, cfg);
}

export function updateRule(id: string, rule: Partial<CpRuleInput>) {
  const body: Record<string, unknown> = {};
  if (rule.name !== undefined) body.name = rule.name;
  if (rule.description !== undefined) body.description = rule.description;
  if (rule.effect !== undefined) body.effect = rule.effect;
  if (rule.priority !== undefined) body.priority = rule.priority;
  if (rule.condition !== undefined) body.condition = rule.condition;
  return send<CpRuleRow>("PUT", `/v1/rules/${encodeURIComponent(id)}`, body);
}

export function deleteRule(id: string) {
  return send<unknown>("DELETE", `/v1/rules/${encodeURIComponent(id)}`);
}

/* --------------------------- Approvals --------------------------- */

/**
 * A held request on the device, waiting for a human. Every column comes
 * straight from the runtime's approval payload — no synthesis in the browser.
 */
export interface CpApprovalRow {
  id: string;
  org_id: string;
  device_id: string | null;
  rule_id: string | null;
  rule_name: string | null;
  summary: string;
  destination: string | null;
  method: string | null;
  path: string | null;
  client_label: string | null;
  service_label: string | null;
  /** JSON strings — parse in the renderer. */
  content_kinds: string | null;
  findings: string | null;
  bytes: number | null;
  state: "pending" | "approved" | "rejected" | "expired";
  decided_by: string | null;
  note: string | null;
  decided_at: string | null;
  created_at: string;
}

export const listApprovals = (orgId: string, state?: "pending" | "approved" | "rejected" | "expired") => {
  const params = new URLSearchParams({ org_id: orgId });
  if (state) params.set("state", state);
  return get<CpApprovalRow[]>(`/v1/approvals?${params.toString()}`);
};

export const decideApproval = (id: string, decision: "approved" | "rejected", decidedBy: string, note?: string) =>
  send<CpApprovalRow>("POST", `/v1/approvals/${encodeURIComponent(id)}/decide`, {
    decision,
    decided_by: decidedBy,
    ...(note ? { note } : {}),
  });

/** Ping /health with only the server URL (no admin key required). */
export async function ping(server: string): Promise<Result<{ status?: string }>> {
  if (!server) return { ok: false, status: 0, error: "unconfigured" };
  const url = `${trimServer(server)}/health`;
  try {
    const res = await fetch(url, { method: "GET", signal: timeoutSignal() });
    const text = await res.text();
    let payload: unknown = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = { status: text }; } }
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status, data: payload as { status?: string } };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" };
  }
}
