/**
 * `wrapboxd discover` — enumerate every agent detected on this machine.
 * `wrapboxd scan`     — same, plus emit a discovery receipt for anything new
 *                       and (best-effort) POST the inventory to the control
 *                       plane. Idempotent: no duplicate receipts for sightings
 *                       we've already recorded.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS, loadConfig } from "../config.js";
import { detectAgents, type AgentSighting } from "../discover.js";
import { makeReceipt, appendToSpool } from "../receipts.js";
import { pushAgents } from "../api.js";

function pad(s: string, n: number): string { return s.length >= n ? s : s + " ".repeat(n - s.length); }

function printTable(sightings: AgentSighting[]): void {
  if (sightings.length === 0) {
    console.log("0 agents detected.");
    console.log("Hint: install a supported agent (e.g. `npm i -g @anthropic-ai/claude-code`) then re-run `wrapboxd discover`.");
    return;
  }
  const cols = [
    ["ID", "KIND", "VIA", "WHERE", "VERSION"] as const,
    ...sightings.map((s) => [s.registryId, s.kind, s.detected, s.where, s.version ?? ""] as const),
  ];
  const widths = [0, 0, 0, 0, 0];
  for (const row of cols) for (let i = 0; i < 5; i++) widths[i] = Math.max(widths[i], row[i].length);
  for (const row of cols) {
    console.log(`${pad(row[0], widths[0])}  ${pad(row[1], widths[1])}  ${pad(row[2], widths[2])}  ${pad(row[3], widths[3])}  ${row[4]}`);
  }
  console.log(`\n${sightings.length} sighting(s).`);
}

const SEEN_FILE = path.join(PATHS.home, "sightings.json");
function loadSeen(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8"));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch { return new Set(); }
}
function saveSeen(s: Set<string>): void {
  fs.mkdirSync(PATHS.home, { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...s]));
}
function sightingKey(s: AgentSighting): string { return `${s.registryId}|${s.detected}|${s.where}`; }

export async function cmdDiscover(): Promise<number> {
  printTable(await detectAgents());
  return 0;
}

export async function cmdScan(): Promise<number> {
  const sightings = await detectAgents();
  printTable(sightings);

  const cfg = loadConfig();
  if (!cfg) {
    console.error("Not enrolled — skipping receipt emission.");
    return 0;
  }
  const seen = loadSeen();
  let newCount = 0;
  for (const s of sightings) {
    const key = sightingKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    newCount++;
    // The wire schema restricts effect to allow|block|review|tamper|violation
    // — a literal "discover" would fail /v1/evidence validation. We encode
    // discovery via agent:"discovery" + tool_name=<registryId>. Do NOT mutate
    // the receipt after makeReceipt() signs it, or the signature will not
    // verify server-side.
    const receipt = makeReceipt(cfg, {
      agent: "discovery",
      session: "",
      tool_name: s.registryId,
      tool_input: { detected: s.detected, where: s.where, version: s.version ?? null },
      target: s.where,
      effect: "allow",
      reason: "agent detected",
      rule_id: null,
      ruleset_pulled_at: null,
      enforcement: "hook",
      degraded: false,
    });
    appendToSpool(receipt);
  }
  saveSeen(seen);
  console.log(`${newCount} new sighting(s) recorded as receipts.`);

  // Best-effort inventory push. The full inventory (not just new ones) is
  // sent so the server can update last_seen_at on the ones it already knows.
  try {
    const inv = sightings.map((s) => ({
      registry_id: s.registryId,
      name: s.registryId,
      kind: s.kind,
      detected_via: s.detected,
      where: s.where,
      version: s.version ?? undefined,
    }));
    const res = await pushAgents(cfg, inv);
    console.log(`Inventory: ${res.upserted} upserted, ${res.seen} seen for this device.`);
  } catch (err) {
    console.error(`Inventory push failed (will retry on next scan): ${(err as Error).message}`);
  }
  return 0;
}
