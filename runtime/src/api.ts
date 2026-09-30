/**
 * Control-plane HTTP wrappers. Every call carries AbortSignal.timeout(5000).
 * NOTE: the hook decision path (commands/check.ts) never imports this module —
 * decisions are made from cache only.
 */

import type { Config } from "./config.js";
import type { Receipt } from "./receipts.js";

const TIMEOUT_MS = 5000;

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}: ${json?.error ?? JSON.stringify(json)}`);
  }
  return json;
}

export interface EnrollBody {
  org_id: string;
  enroll_token: string;
  hostname: string;
  os: string;
  arch?: string;
  owner_email?: string;
  public_key: string;
}

export interface EnrollResponse {
  id: string;
  api_key: string;
  key_id: string;
  message: string;
}

export async function enroll(server: string, body: EnrollBody): Promise<EnrollResponse> {
  return post(`${server}/v1/devices/enroll`, body);
}

export async function heartbeat(
  cfg: Config,
  body: { daemon_version?: string; ruleset_pulled_at?: string; chain_head_seq?: number; capabilities?: unknown },
): Promise<{ status: string; device_id: string }> {
  return post(`${cfg.server}/v1/devices/heartbeat`, body, { authorization: `Bearer ${cfg.api_key}` });
}

export interface RulesPullResponse {
  rules: Array<{
    id: string;
    name: string;
    effect: "allow" | "constrain" | "block" | "review";
    priority: number;
    condition_json: string | null;
    constraint_json?: string | null;
    project_id: string | null;
    /** v2 provenance: the IR clause / contract a rule was compiled from. */
    clause_id?: string | null;
    contract_id?: string | null;
    meta_json?: string | null;
    description?: string | null;
  }>;
  pulled_at: string;
  /** The tenant's destination configuration (approved AI, internal domains, exemptions, groups). */
  destinations?: import("@wrapbox/registry").TenantDestinationConfig;
}

export async function pullRules(cfg: Config): Promise<RulesPullResponse> {
  const res = await fetch(`${cfg.server}/v1/rules/pull`, {
    headers: { authorization: `Bearer ${cfg.api_key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`/v1/rules/pull -> ${res.status}: ${json?.error ?? ""}`);
  return json as RulesPullResponse;
}

export async function pushEvidence(
  cfg: Config,
  receipts: Receipt[],
): Promise<{ accepted: number; duplicates: number; rejected: Array<{ id: string; reason: string }> }> {
  return post(`${cfg.server}/v1/evidence`, { receipts }, { authorization: `Bearer ${cfg.api_key}` });
}

export interface AgentInventoryEntry {
  registry_id: string;
  name: string;
  kind: string;
  detected_via: string;
  where: string;
  version?: string;
}

export async function pushAgents(
  cfg: Config,
  agents: AgentInventoryEntry[],
): Promise<{ upserted: number; seen: number }> {
  return post(`${cfg.server}/v1/agents`, { agents }, { authorization: `Bearer ${cfg.api_key}` });
}

/* ------------------------------------------------------------------ *
 * Approvals — the REVIEW verdict
 * ------------------------------------------------------------------ */

export interface ApprovalRequest {
  org_id: string;
  rule_id: string | null;
  rule_name?: string;
  summary: string;
  destination?: string;
  method?: string;
  path?: string;
  client_label?: string;
  service_label?: string;
  content_kinds?: string[];
  findings?: string[];
  bytes?: number;
}

export async function openApproval(cfg: Config, body: ApprovalRequest): Promise<{ id: string; expires_in_ms: number }> {
  const res = await fetch(`${cfg.server}/v1/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.api_key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`approval open failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string; expires_in_ms: number };
}

export async function readApproval(cfg: Config, id: string): Promise<{ state: string; decided_by?: string; note?: string }> {
  const res = await fetch(`${cfg.server}/v1/approvals/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${cfg.api_key}` },
  });
  if (!res.ok) throw new Error(`approval read failed: HTTP ${res.status}`);
  return (await res.json()) as { state: string; decided_by?: string; note?: string };
}

