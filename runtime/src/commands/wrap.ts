/**
 * `wrapboxd wrap [id...]` — install PATH shims for every detected shim-safe
 * agent (or the subset named). `wrapboxd unwrap` removes them.
 */
import { installShims, uninstallShims, SHIMS_DIR, type ShimNetMode } from "../shims.js";

export async function cmdWrap(args: string[]): Promise<number> {
  let net: ShimNetMode = "on";
  const only: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--net" && args[i + 1]) {
      const v = args[++i];
      if (v !== "proxy" && v !== "on" && v !== "off") {
        console.error(`✖ Invalid --net value: ${v} (use proxy | on | off)`);
        return 64;
      }
      net = v;
    } else if (!args[i].startsWith("-")) {
      only.push(args[i]);
    }
  }
  const res = await installShims(only.length ? only : undefined, net);
  if (res.installed.length === 0) {
    console.log(`No shim-safe agents detected. Nothing to wrap. (Shims dir: ${SHIMS_DIR})`);
    return 0;
  }
  console.log(`Wrapped ${res.installed.length} agent binary/binaries (network: ${net}):`);
  for (const s of res.installed) console.log(`  ${s.path} → ${s.registryId} (sha256 ${s.sha256.slice(0, 16)}…)`);
  if (net === "on") {
    console.log("");
    console.log("Note: --net on keeps kernel file rules and leaves egress alone.");
    console.log("      Use --net proxy to also force every connection through the policy proxy");
    console.log("      (stronger, but an agent that ignores HTTP_PROXY will lose network).");
  }
  console.log("");
  console.log(res.hint);
  return 0;
}

export async function cmdUnwrap(_args: string[]): Promise<number> {
  const res = uninstallShims();
  if (res.removed.length === 0) {
    console.log("No shims to remove.");
    return 0;
  }
  console.log(`Removed ${res.removed.length} shim(s):`);
  for (const p of res.removed) console.log(`  ${p}`);
  return 0;
}
