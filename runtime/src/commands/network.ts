/**
 * `wrapboxd protect-network`   — route every app's traffic through Wrapbox.
 * `wrapboxd unprotect-network` — restore normal networking.
 *
 * These set the macOS system web proxy so a normally-launched browser or app
 * is governed without any per-app flag. The daemon must be running (it holds
 * the proxy the traffic is pointed at); protect-network warns if it is not.
 */

import { loadConfig } from "../config.js";
import { DEFAULT_PROXY_PORT } from "../proxy.js";
import { enableSystemProxy, disableSystemProxy } from "../sysproxy.js";
import { createConnection } from "node:net";

function proxyListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    sock.setTimeout(800, () => { sock.destroy(); resolve(false); });
  });
}

export async function cmdProtectNetwork(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) { console.error("✖ Not enrolled. Run: wrapboxd enroll ..."); return 1; }
  const port = DEFAULT_PROXY_PORT;

  if (!(await proxyListening(port))) {
    console.error(`✖ The Wrapbox proxy is not listening on 127.0.0.1:${port}.`);
    console.error("  Start it first (in another window):  wrapboxd daemon");
    console.error("  Turning on the system proxy without it would cut this Mac's internet.");
    return 1;
  }

  const res = await enableSystemProxy(port);
  console.log(`✔ System proxy ON — every app now routes through Wrapbox (127.0.0.1:${port}).`);
  console.log(`  Services covered: ${res.services.join(", ")}`);
  console.log("");
  console.log("  Open Safari / Chrome NORMALLY and browse — blocked AI sites will fail to load.");
  console.log("  To restore normal networking:  wrapboxd unprotect-network");
  console.log("  (The running daemon also restores it automatically when you stop it.)");
  return 0;
}

export async function cmdUnprotectNetwork(): Promise<number> {
  const services = await disableSystemProxy();
  console.log(`✔ System proxy OFF — networking restored on: ${services.join(", ") || "(none found)"}.`);
  return 0;
}
