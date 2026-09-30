/**
 * Pure mappers from Control Plane admin payloads → the store's shapes.
 * Nothing here invents a value: a field the API did not return becomes "—"
 * (or 0 for numbers where a "—" would break math). Every screen renders what
 * the API returned or an honest blank.
 */

import type { Decision } from "../data/agents";
import type { Rule } from "../data/contract";
import type { DiscoveredAgent, Evt, FleetDevice } from "./store";
import type { CpAgentRow, CpDeviceRow, CpReceiptRow, CpRuleRow } from "./cp-api";

/* ------------ device ------------ */

function osLogoOf(os: string): string {
  const s = os.toLowerCase();
  if (s.includes("mac") || s.includes("darwin") || s.includes("osx") || s.includes("os x")) return "apple";
  if (s.includes("ubuntu")) return "ubuntu";
  if (s.includes("debian")) return "debian";
  if (s.includes("fedora")) return "fedora";
  if (s.includes("linux")) return "linux";
  if (s.includes("windows") || s.includes("win")) return "windows";
  return "device";
}

function stateOf(s: string | null | undefined): FleetDevice["state"] {
  const v = (s ?? "").toLowerCase();
  if (v === "healthy" || v === "heartbeat-lost" || v === "quarantined" || v === "enrolling") return v;
  return "enrolling";
}

/**
 * SQLite's datetime('now') returns UTC as "YYYY-MM-DD HH:MM:SS" — no T, no
 * zone marker. Date.parse() reads that as LOCAL time, so every timestamp the
 * Control Plane wrote lands off by the viewer's UTC offset (a live device
 * reads as hours stale). Stamp the zone on before parsing; ISO strings with
 * their own offset are passed through untouched.
 */
function toMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(iso);
  const t = Date.parse(sqliteUtc ? `${iso.replace(" ", "T")}Z` : iso);
  return Number.isFinite(t) ? t : 0;
}

export function deviceFromCp(row: CpDeviceRow, agents: DiscoveredAgent[] = []): FleetDevice {
  return {
    id: row.id,
    hostname: row.hostname ?? row.id,
    ownerId: row.owner_email ?? "",
    os: row.os ?? "",
    osLogo: osLogoOf(row.os ?? ""),
    arch: row.arch ?? "",
    enrolledAt: toMs(row.created_at),
    runtimeVersion: row.daemon_version ?? "—",
    policyBundleVersion: 0,
    heartbeat: toMs(row.last_heartbeat),
    state: stateOf(row.state),
    killSwitch: false,
    keyId: row.key_id ?? "",
    // When this device last pulled the ruleset. The top-bar "enforcing" pill
    // counts only devices that have actually pulled — a device that never
    // pulled is enrolled, not enforcing.
    rulesetPulledAt: toMs(row.ruleset_pulled_at),
    agents,
  };
}

/* ------------ agents (grouped per device) ------------ */

export function agentFromCp(row: CpAgentRow): DiscoveredAgent {
  const name = typeof row.name === "string" ? row.name : String(row.id);
  return {
    agentId: `unknown:${name}`,
    binary: typeof row.where === "string" ? row.where : name,
    version: typeof row.version === "string" ? row.version : "",
    launchMode: "unknown",
    // The row's own timestamps, never 0 — epoch renders as "20711d ago".
    discoveredAt: toMs((row.created_at ?? row.last_seen_at) as string | undefined),
  };
}

export function groupAgentsByDevice(rows: CpAgentRow[]): Record<string, DiscoveredAgent[]> {
  const out: Record<string, DiscoveredAgent[]> = {};
  for (const row of rows) {
    if (!row?.device_id) continue;
    (out[row.device_id] ??= []).push(agentFromCp(row));
  }
  return out;
}

/* ------------ receipts → Evt ------------ */

const DECISION_MAP: Record<string, Decision> = {
  allow: "ALLOW",
  block: "BLOCK",
  review: "REVIEW",
  violation: "BLOCK",
  tamper: "BLOCK",
  discover: "ALLOW",
};

export function evtFromReceipt(row: CpReceiptRow): Evt {
  const r = row.receipt ?? ({} as CpReceiptRow["receipt"]);
  const effectRaw = (r.effect ?? "").toLowerCase();
  const decision: Decision = DECISION_MAP[effectRaw] ?? "BLOCK";
  const path = typeof r.tool_input?.path === "string" ? (r.tool_input.path as string) : undefined;
  const action = `${r.tool_name ?? ""} ${r.target ?? ""}`.trim() || (r.tool_name ?? "");
  return {
    id: row.id,
    ts: toMs(r.ts ?? row.ts) || 0,
    agentId: (typeof r.agent === "string" && r.agent) ? r.agent : "unknown",
    human: "",
    action,
    effect: (r.tool_name ?? effectRaw) || "",
    decision,
    rule: r.rule_id ?? "—",
    reason: r.reason ?? "",
    latency: 0,
    // No env: a receipt carries no environment (see runtime receipts.ts). Leaving
    // it unset keeps Evidence honest ("environment not reported") and stops live
    // events from being mis-bucketed under Production in the env filter.
    source: "live",
    // The signer's real chain fields, carried verbatim so Evidence can render a
    // genuine signed receipt (hash chain, signature, key id, server-verified
    // flag) instead of a fabricated one. Omitted when the receipt lacks them.
    ...(typeof r.seq === "number" ? { seq: r.seq } : {}),
    ...(r.prev ? { prev: r.prev } : {}),
    ...(r.sig ? { sig: r.sig } : {}),
    ...(r.key_id ? { keyId: r.key_id } : {}),
    ...(typeof row.verified === "boolean" ? { verified: row.verified } : {}),
    act: {
      effect: r.tool_name ?? "",
      ...(path ? { path } : {}),
      ctx: {
        "device.id": r.device_id ?? row.device_id,
        enforcement: r.enforcement ?? "",
        // The raw effect before DECISION_MAP collapses tamper/violation into
        // BLOCK — Evidence uses it to describe what actually happened.
        receiptEffect: effectRaw,
      },
    },
  };
}

/* ------------ rules ------------ */

export function ruleFromCp(row: CpRuleRow): Rule {
  const effect = (row.effect ?? "block").toLowerCase();
  const decision: Decision = effect === "allow" ? "ALLOW" : effect === "review" ? "REVIEW" : "BLOCK";
  return {
    id: row.id,
    title: row.name ?? row.id,
    why: (row.description ?? "").trim(),
    // Emit no synthetic matcher. The CP rule is a structured condition evaluated on
    // the device, not a browser `effect` glob; the old `effect: ["policy.*"]` named
    // a namespace no action carries and made the local tester silently fall through.
    // An empty matcher never fabricates a browser verdict. The real condition and
    // evaluation order travel on `condition`/`priority`, and `cpOnly` marks the rule
    // as Control-Plane-evaluated so surfaces can say so instead of guessing.
    when: { effect: [] },
    decision,
    scope: "all",
    custom: true,
    cpOnly: true,
    ...(row.condition_json ? { condition: row.condition_json } : {}),
    ...(typeof row.priority === "number" ? { priority: row.priority } : {}),
  };
}
