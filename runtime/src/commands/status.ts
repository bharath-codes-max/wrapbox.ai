/**
 * `wrapboxd status` — one honest snapshot of enforcement posture.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { loadConfig, PATHS, FRESH_HOURS } from "../config.js";
import { loadState, spoolDepth } from "../receipts.js";
import { detectAgents } from "../discover.js";
import { SHIMS_DIR } from "../shims.js";
import { DEFAULT_PROXY_PORT } from "../proxy.js";

function probeProxy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    const done = (ok: boolean) => { try { s.destroy(); } catch { /* ignore */ } resolve(ok); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 300);
  });
}

export async function cmdStatus(): Promise<number> {
  const cfg = loadConfig();
  const state = loadState();
  const spool = spoolDepth();

  // Read the cache header directly (count + pulled_at only — no matching here,
  // so this must not and does not import the policy engine).
  let ruleCount: number | null = null;
  let pulledAt: string | null = null;
  let fresh = false;
  try {
    const body = JSON.parse(fs.readFileSync(PATHS.rulesCache, "utf-8"));
    if (Array.isArray(body.rules) && typeof body.pulled_at === "string") {
      ruleCount = body.rules.length;
      pulledAt = body.pulled_at;
      const ageHours = (Date.now() - Date.parse(body.pulled_at)) / 3_600_000;
      fresh = Number.isFinite(ageHours) && ageHours < FRESH_HOURS;
    }
  } catch {
    /* no cache */
  }

  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let hooksInstalled = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const pre = settings?.hooks?.PreToolUse;
    hooksInstalled = Array.isArray(pre) && pre.some((e: any) =>
      Array.isArray(e?.hooks) && e.hooks.some((h: any) => typeof h?.command === "string" && h.command.includes("wrapbox")));
  } catch {
    /* no settings file */
  }

  const mode = !cfg || ruleCount === null ? "not enrolled" : fresh ? "full" : "degraded: stale ruleset";

  console.log(`Enrolled:        ${cfg ? "yes" : "no"}`);
  console.log(`Server:          ${cfg ? cfg.server : "—"}`);
  console.log(`Device id:       ${cfg ? cfg.device_id : "—"}`);
  if (ruleCount !== null && pulledAt !== null) {
    const ageH = ((Date.now() - Date.parse(pulledAt)) / 3_600_000).toFixed(1);
    console.log(`Ruleset:         ${ruleCount} rule(s), pulled ${pulledAt} (${ageH}h ago, ${fresh ? "fresh" : "STALE"})`);
  } else {
    console.log("Ruleset:         none cached");
  }
  console.log(`Chain head seq:  ${state.seq}`);
  console.log(`Spool depth:     ${spool.unsent} unsent (${spool.total} total)`);
  console.log(`Hooks installed: ${hooksInstalled ? "yes" : "no"} (${settingsPath})`);
  console.log(`Enforcement:     ${cfg && ruleCount !== null ? (fresh ? "full" : mode) : "not enrolled"}`);

  const sightings = await detectAgents();
  console.log(`\nAgents detected: ${sightings.length}`);
  for (const s of sightings) console.log(`  ${s.registryId.padEnd(18)} ${s.detected.padEnd(9)} ${s.where}${s.version ? ` (${s.version})` : ""}`);

  let shimEntries: string[] = [];
  try { shimEntries = fs.readdirSync(SHIMS_DIR); } catch { /* none */ }
  console.log(`\nShims installed: ${shimEntries.length} (${SHIMS_DIR})`);
  for (const name of shimEntries) console.log(`  ${name}`);

  const proxyUp = await probeProxy(DEFAULT_PROXY_PORT);
  console.log(`\nProxy:           ${proxyUp ? `listening on 127.0.0.1:${DEFAULT_PROXY_PORT}` : "stopped"}`);
  return 0;
}
