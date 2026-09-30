/**
 * Live poller. When the workspace is "v2" and cp-config is complete, this polls
 * the Control Plane admin endpoints every 5 s and maps their rows into the
 * store's v2 state. It never invents data: on failure the workspace either
 * stays empty or keeps its last-good snapshot, and cpStatus() tells the UI
 * why the numbers are (or are not) moving.
 */

import { useSyncExternalStore } from "react";
import { getState, setState, subscribeStore } from "./store";
import type { CpConfig } from "./cp-config";
import { cpConfigComplete, getCpConfig, subscribeCpConfig } from "./cp-config";
import { listAgents, listDevices, listOrgs, listReceipts, listRules } from "./cp-api";
import { deviceFromCp, evtFromReceipt, groupAgentsByDevice, ruleFromCp } from "./cp-map";

export type CpStatus = "unconfigured" | "connecting" | "connected" | "unreachable" | "unauthorized";

const POLL_MS = 5000;
let timer: number | undefined;
let inFlight = false;
let status: CpStatus = "unconfigured";
const statusListeners = new Set<() => void>();

function setStatus(next: CpStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

export function cpStatus(): CpStatus {
  return status;
}

const subscribeStatus = (l: () => void) => {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
};

export function useCpStatus(): CpStatus {
  return useSyncExternalStore(subscribeStatus, cpStatus, cpStatus);
}

async function pollOnce(cfg: CpConfig) {
  if (inFlight) return;
  inFlight = true;
  try {
    const [devices, agents, rules, receipts, orgs] = await Promise.all([
      listDevices(cfg.orgId),
      listAgents(cfg.orgId),
      listRules(cfg.orgId),
      listReceipts(cfg.orgId, { limit: 200 }),
      listOrgs(),
    ]);

    // Auth failures anywhere bubble up as unauthorized; total unreachability as unreachable.
    const anyUnauthorized = [devices, rules, receipts].some((r) => !r.ok && r.status === 401);
    const anyNetwork = [devices, rules, receipts].some((r) => !r.ok && r.status === 0);
    if (anyUnauthorized) { setStatus("unauthorized"); return; }
    if (anyNetwork && !devices.ok && !rules.ok && !receipts.ok) { setStatus("unreachable"); return; }

    // Devices + agents → FleetDevice[]. Agents endpoint may be absent (404) —
    // in that case every device just carries an empty agents list, which is
    // an honest report, not an invented one.
    const agentRows = agents.ok ? agents.data : [];
    const grouped = groupAgentsByDevice(agentRows);
    const fleet = devices.ok ? devices.data.map((d) => deviceFromCp(d, grouped[d.id] ?? [])) : getState().fleet;

    // Rules → the store's normalized Rule[]. Published mirrors rules until the
    // CP grows a separate "published bundle" concept; every screen that reads
    // `published` (Contract, tester, runtime evaluator) reads the same rows.
    const mappedRules = rules.ok ? rules.data.map(ruleFromCp) : getState().rules;

    // Receipts → Evt[]. Sorted newest first so the stream reads chronologically.
    // Inventory receipts (agent:"discovery") are dropped here: they record that
    // an agent was FOUND on disk, not that policy decided anything, and letting
    // them into the decision stream would inflate "decisions today" with events
    // no rule ever evaluated. They remain in the signed chain on the server and
    // surface as agents on the Fleet page, which is where inventory belongs.
    const evts = receipts.ok
      ? receipts.data
          .filter((r) => r.receipt?.agent !== "discovery")
          .map(evtFromReceipt)
          .sort((a, b) => b.ts - a.ts)
      : getState().events;

    // Only touch state if we still hold v2 — a workspace switch between the
    // request and now must not overwrite the other workspace's data.
    if (getState().workspace !== "v2") return;

    // The tenant's own identity, so the shell stops showing a placeholder
    // company for a workspace that is pointed at a real org.
    const org = orgs.ok ? orgs.data.find((o) => o.id === cfg.orgId) : undefined;

    setState({
      fleet,
      rules: mappedRules,
      published: mappedRules,
      events: evts,
      ...(org ? { company: org.name, domain: org.domain ?? "", region: org.region || "us" } : {}),
    });
    setStatus("connected");
  } finally {
    inFlight = false;
  }
}

function tick() {
  const s = getState();
  const cfg = getCpConfig();
  if (s.workspace !== "v2") { setStatus("unconfigured"); return; }
  if (!cpConfigComplete(cfg)) { setStatus("unconfigured"); return; }
  if (typeof document !== "undefined" && document.hidden) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { setStatus("unreachable"); return; }
  if (status === "unconfigured") setStatus("connecting");
  void pollOnce(cfg);
}

let started = false;
let unsubStore: (() => void) | null = null;
let unsubCfg: (() => void) | null = null;

/** Idempotent. Safe to call from every mount — later calls are no-ops. */
export function startCpSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Poll now, then every 5 s. Also react to workspace/config changes.
  tick();
  timer = window.setInterval(tick, POLL_MS);
  unsubStore = subscribeStore(tick);
  unsubCfg = subscribeCpConfig(tick);
}

export function stopCpSync() {
  if (!started) return;
  started = false;
  if (timer) window.clearInterval(timer);
  timer = undefined;
  unsubStore?.(); unsubStore = null;
  unsubCfg?.(); unsubCfg = null;
}
