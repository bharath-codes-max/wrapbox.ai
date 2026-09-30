/**
 * `wrapboxd enroll --server URL --org ORG --token WBXE...`
 * Generates the device keypair, registers with the control plane, pins the
 * server URL into config.json. After this, env WRAPBOX_SERVER is ignored.
 */

import os from "node:os";
import { configExists, saveConfig, PATHS } from "../config.js";
import { ensureKeypair } from "../receipts.js";
import { enroll as apiEnroll } from "../api.js";

export async function cmdEnroll(args: string[]): Promise<number> {
  let server = "";
  let org = "";
  let token = "";
  let force = false;
  let noWrap = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" && args[i + 1]) server = args[++i];
    else if (args[i] === "--org" && args[i + 1]) org = args[++i];
    else if (args[i] === "--token" && args[i + 1]) token = args[++i];
    else if (args[i] === "--force") force = true;
    else if (args[i] === "--no-wrap") noWrap = true;
  }
  if (!server || !org || !token) {
    console.error("Usage: wrapboxd enroll --server URL --org ORG_ID --token WBXE... [--force]");
    return 64;
  }
  if (configExists() && !force) {
    console.error(`✖ Already enrolled (${PATHS.configFile} exists). Use --force to re-enroll.`);
    return 1;
  }

  const { publicPem, keyId } = ensureKeypair();
  let res;
  try {
    res = await apiEnroll(server.replace(/\/+$/, ""), {
      org_id: org,
      enroll_token: token,
      hostname: os.hostname(),
      os: process.platform === "darwin" ? "macos" : process.platform,
      arch: process.arch,
      public_key: publicPem,
    });
  } catch (err) {
    console.error(`✖ Enrollment failed: ${(err as Error).message}`);
    return 1;
  }

  saveConfig({
    server: server.replace(/\/+$/, ""),
    org_id: org,
    device_id: res.id,
    api_key: res.api_key,
    key_id: res.key_id ?? keyId,
    pullInterval: 60,
    heartbeatInterval: 30,
  });

  console.log(`✔ Enrolled. Device id: ${res.id}`);
  console.log(`  Key id: ${res.key_id ?? keyId}`);
  console.log(`  Config: ${PATHS.configFile} (0600 — the API key is never printed)`);

  if (!noWrap) {
    try {
      const shims = await import("../shims.js");
      const wrapRes = await shims.installShims();
      if (wrapRes.installed.length > 0) {
        console.log(`\n✔ Auto-wrapped ${wrapRes.installed.length} agent binary/binaries.`);
        for (const s of wrapRes.installed) console.log(`  ${s.path} → ${s.registryId}`);
        console.log("");
        console.log(wrapRes.hint);
      } else {
        console.log(`\nNo shim-safe agents detected on PATH. Install one, then run \`wrapboxd wrap\`.`);
      }
    } catch (err) {
      console.error(`(auto-wrap skipped: ${(err as Error).message})`);
    }
  }

  console.log("\nNext steps:");
  console.log("  wrapboxd pull                     # fetch this device's policy");
  console.log("  wrapboxd protect claude-code      # install the PreToolUse governor hooks");
  console.log("  wrapboxd daemon                   # heartbeat, rule sync, evidence drain, proxy");
  return 0;
}
