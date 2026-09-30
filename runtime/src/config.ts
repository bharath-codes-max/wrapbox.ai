/**
 * wrapboxd configuration and on-disk state layout.
 *
 * Everything lives under WRAPBOX_HOME (default ~/.wrapbox). The env override
 * exists for testing and multi-instance runs; the PRODUCTION layout
 * (/Library/Application Support/Wrapbox, root:wheel 0600, no env overrides)
 * is documented in docs, not implemented here.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const HOME_DIR = process.env.WRAPBOX_HOME || path.join(os.homedir(), ".wrapbox");

/** Ruleset freshness window (hours). Older caches put enforcement in degraded mode. */
export const FRESH_HOURS = 24;

export const PATHS = {
  home: HOME_DIR,
  configFile: path.join(HOME_DIR, "config.json"),
  keysDir: path.join(HOME_DIR, "keys"),
  deviceKey: path.join(HOME_DIR, "keys", "device.key"),
  devicePub: path.join(HOME_DIR, "keys", "device.pub"),
  cacheDir: path.join(HOME_DIR, "cache"),
  rulesCache: path.join(HOME_DIR, "cache", "rules.json"),
  stateFile: path.join(HOME_DIR, "state.json"),
  spoolFile: path.join(HOME_DIR, "receipts.jsonl"),
  sentFile: path.join(HOME_DIR, "receipts.sent"),
  profilesDir: path.join(HOME_DIR, "profiles"),
} as const;

export interface Config {
  /** Control Plane URL — pinned at enroll. After enrollment, env WRAPBOX_SERVER
   *  is IGNORED (trust pinning: a compromised shell env must not be able to
   *  redirect the device to a rogue control plane). */
  server: string;
  org_id: string;
  device_id: string;
  api_key: string;
  key_id: string;
  /** How often the daemon pulls rules (seconds) */
  pullInterval: number;
  /** How often the daemon heartbeats (seconds) */
  heartbeatInterval: number;
}

/** Returns null when the device is not enrolled. Callers decide what
 *  fail-closed means for their path — no process.exit here. */
export function loadConfig(): Config | null {
  let raw: string;
  try {
    raw = fs.readFileSync(PATHS.configFile, "utf-8");
  } catch {
    return null;
  }
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed.server || !parsed.device_id || !parsed.api_key || !parsed.key_id) return null;
  return {
    server: parsed.server,
    org_id: parsed.org_id ?? "",
    device_id: parsed.device_id,
    api_key: parsed.api_key,
    key_id: parsed.key_id,
    pullInterval: parsed.pullInterval ?? 60,
    heartbeatInterval: parsed.heartbeatInterval ?? 30,
  };
}

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(PATHS.configFile, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(PATHS.configFile, 0o600); // writeFileSync mode is ignored if the file already exists
}

export function configExists(): boolean {
  return fs.existsSync(PATHS.configFile);
}
