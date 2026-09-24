/**
 * `wrapboxd daemon` — foreground loop (Ctrl-C to stop):
 *   heartbeat every heartbeatInterval, rule pull every pullInterval,
 *   evidence drain every 10s, hooks tamper-watch every 5s.
 * All failures log and continue — the loop never crashes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, PATHS } from "../config.js";
import { heartbeat, pullRules, pushAgents } from "../api.js";
import { loadState, makeReceipt, appendToSpool, drainSpool, spoolDepth } from "../receipts.js";
import { loadCachedRules, canAllowOrdinaryTraffic } from "../policy.js";
import { sha256hex } from "../canonical.js";
import { installHooks } from "./protect.js";
import { startProxy, DEFAULT_PROXY_PORT, takeSkippedCount, takeSuppressedCount, type ProxyHandle } from "../proxy.js";
import { detectAgents } from "../discover.js";
import { checkShimTamper, installShims } from "../shims.js";
import { enableSystemProxy, disableSystemProxy } from "../sysproxy.js";
import { loadPlugins } from "../detectors/index.js";
import { loadExtractors, refreshAvailability } from "../extract/index.js";
import { describeSnapshot } from "../capabilities.js";
import { saveTenantDestinations } from "../tenant.js";

function daemonVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "..", "..", "package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function cachedPulledAt(): string | undefined {
  try {
    const body = JSON.parse(fs.readFileSync(PATHS.rulesCache, "utf-8"));
    return typeof body.pulled_at === "string" ? body.pulled_at : undefined;
  } catch {
    return undefined;
  }
}

export async function cmdDaemon(args: string[] = []): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("✖ Not enrolled. Run: wrapboxd enroll --server URL --org ORG --token WBXE...");
    return 1;
  }
  // --protect-network makes the daemon set the macOS system proxy so EVERY app
  // (Safari, Chrome, VS Code…) routes through the gate — and, crucially,
  // restore it on exit so stopping the daemon never leaves the Mac offline.
  const protectNetwork = args.includes("--protect-network");
  // Content inspection: terminate TLS and judge the body, not just the host.
  // Off unless asked for, because it requires a trusted CA and it is a
  // meaningful escalation in what the product reads.
  const inspect = args.includes("--inspect");
  // By default the evidence trail records risky decisions only. --record-all
  // keeps a receipt for every inspected request, for customers who need the
  // complete log rather than the readable one.
  const recordAll = args.includes("--record-all");
  const version = daemonVersion();
  console.log(`wrapboxd ${version} — daemon started (server ${cfg.server}). Ctrl-C to stop.`);

  // Last-resort net. An enforcement daemon that exits stops enforcing, so a
  // stray async error must degrade to a log line, never to a dead process.
  // Anything reaching here is a bug worth fixing — it is logged loudly.
  process.on("uncaughtException", (err) => {
    console.error(`wrapboxd: uncaught exception (daemon continues): ${err?.stack || err}`);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(`wrapboxd: unhandled rejection (daemon continues): ${reason}`);
  });

  // Registry-driven detectors and extractors. Missing plugins and unreachable
  // sidecars are REPORTED (in the log and in the capability snapshot the
  // control plane receives), never assumed present.
  {
    const p = await loadPlugins();
    await loadExtractors();
    const snap = describeSnapshot();
    const on = snap.detectors.filter((d) => d.available).map((d) => d.id);
    const off = snap.detectors.filter((d) => !d.available).map((d) => `${d.id} (${d.reason ?? "unavailable"})`);
    console.log(`detectors: ${on.length} available — ${on.join(", ")}`);
    if (off.length) console.log(`detectors unavailable: ${off.join("; ")}`);
    const ex = snap.extractors.map((e) => `${e.id}${e.available ? "" : ` (unavailable: ${e.reason ?? ""})`}`);
    console.log(`extractors: ${ex.join(", ")}`);
    console.log(`vault key: ${snap.vault.keychain ? "macOS Keychain" : "key file (Keychain unavailable)"} · destinations: ${snap.destinations.source === "file" ? "tenant configuration" : "seed catalogue (nothing approved)"}`);
    if (p.failed.length) console.log(`plugins not loaded: ${p.failed.map((f) => `${f.module}: ${f.error}`).join("; ")}`);
  }

  const timers: NodeJS.Timeout[] = [];
  let lastRulesHash = "";
  try {
    lastRulesHash = sha256hex(fs.readFileSync(PATHS.rulesCache, "utf-8"));
  } catch { /* no cache yet */ }

  // Report what we deliberately did NOT record. Staying silent about skipped
  // traffic would be dishonest; a count is not.
  const reportSkipped = () => {
    const n = takeSkippedCount();
    if (n > 0) console.log(`evidence: ${n} clean request(s) allowed, not recorded (nothing sensitive found; use --record-all for the full log)`);
    const dup = takeSuppressedCount();
    if (dup > 0) console.log(`evidence: ${dup} repeat(s) of decisions already recorded this minute, collapsed`);
  };

  const doHeartbeat = async () => {
    try {
      const state = loadState();
      await refreshAvailability();
      await heartbeat(cfg, {
        daemon_version: version,
        ruleset_pulled_at: cachedPulledAt(),
        chain_head_seq: state.seq,
        // The capability snapshot travels with every heartbeat so the compiler
        // judges coverage against THIS device's real state, not a static mirror.
        capabilities: describeSnapshot(),
      });
    } catch (err) {
      console.error(`heartbeat failed: ${(err as Error).message}`);
    }
  };

  const doPull = async () => {
    try {
      const body = await pullRules(cfg);
      if (body.destinations && typeof body.destinations === "object") {
        try { saveTenantDestinations(body.destinations); } catch (e) { console.error(`destinations cache failed: ${(e as Error).message}`); }
      }
      const text = JSON.stringify(body, null, 2) + "\n";
      const hash = sha256hex(text);
      fs.mkdirSync(PATHS.cacheDir, { recursive: true });
      fs.writeFileSync(PATHS.rulesCache, text);
      if (hash !== lastRulesHash) {
        console.log(`rules updated: ${body.rules.length} rule(s) @ ${body.pulled_at}`);
        lastRulesHash = hash;
      }
    } catch (err) {
      console.error(`rule pull failed: ${(err as Error).message}`);
    }
  };

  const doDrain = async () => {
    reportSkipped();
    try {
      if (spoolDepth().unsent > 0) {
        const res = await drainSpool(cfg);
        console.log(`evidence drained: ${res.accepted} accepted, ${res.duplicates} duplicate(s), ${res.rejected.length} rejected`);
      }
    } catch (err) {
      console.error(`evidence drain failed: ${(err as Error).message}`);
    }
  };

  const doTamperCheck = () => {
    try {
      const state = loadState();
      if (!state.hooks_hash || !state.hooks_path) return; // hooks were never installed
      let current = "";
      try {
        current = sha256hex(fs.readFileSync(state.hooks_path, "utf-8"));
      } catch { /* file deleted counts as drift */ }
      if (current === state.hooks_hash) return;
      installHooks(); // rewrite our entries; also re-records the new hash
      const receipt = makeReceipt(cfg, {
        agent: "claude-code",
        session: "",
        tool_name: "",
        tool_input: { file: state.hooks_path },
        target: state.hooks_path,
        effect: "tamper",
        reason: "claude-code hooks modified — restored",
        rule_id: null,
        ruleset_pulled_at: cachedPulledAt() ?? null,
        enforcement: "hook",
        degraded: false,
      });
      appendToSpool(receipt);
      console.log("tamper: claude-code hooks modified — restored (receipt written)");
    } catch (err) {
      console.error(`tamper check failed: ${(err as Error).message}`);
    }
  };

  // Universal network gate — supervise with a small exponential backoff so a
  // one-off crash doesn't leave the fabric ungoverned.
  let proxy: ProxyHandle | null = null;
  let proxyBackoffMs = 500;
  const superviseProxy = async () => {
    try {
      proxy = await startProxy({ inspect, recordAll });
      proxyBackoffMs = 500;
      console.log(`proxy: listening on 127.0.0.1:${proxy.port}`);
      console.log(proxy.inspecting
        ? "proxy: CONTENT INSPECTION ON — prompts and uploads are read before they leave"
        : "proxy: hostname-level enforcement (no content inspection)");
      proxy.server.on("close", () => {
        proxy = null;
        setTimeout(() => { void superviseProxy(); }, proxyBackoffMs);
        proxyBackoffMs = Math.min(proxyBackoffMs * 2, 30_000);
      });
    } catch (err) {
      console.error(`proxy failed to start: ${(err as Error).message}`);
      setTimeout(() => { void superviseProxy(); }, proxyBackoffMs);
      proxyBackoffMs = Math.min(proxyBackoffMs * 2, 30_000);
    }
  };
  await superviseProxy();

  if (protectNetwork) {
    // Pull FIRST. The guard below reads the cached ruleset, and at startup that
    // cache is whatever the last run left behind — so checking it before a pull
    // judged the contract the admin had already fixed, and refused to start.
    await doPull();

    // Refuse to take over the system proxy when the contract cannot allow
    // ordinary traffic. Doing it anyway refuses every connection on the
    // machine — including the one needed to reach the console and fix it.
    const cached = loadCachedRules();
    if (!cached || !canAllowOrdinaryTraffic(cached.rules)) {
      console.error("");
      console.error("✖ REFUSING to turn on system-wide protection.");
      console.error("");
      console.error("  Your contract has no rule that can allow ordinary traffic, and Wrapbox");
      console.error("  is fail-closed — every connection on this Mac would be refused, including");
      console.error("  the dashboard you would need to fix it.");
      console.error("");
      console.error("  Add this rule first, then start again:");
      console.error("      name     : Ordinary traffic is allowed");
      console.error("      effect   : ALLOW");
      console.error("      when     : everything else");
      console.error("      priority : 10");
      console.error("");
      console.error("  The proxy is still running on 127.0.0.1:4180 for anything pointed at it;");
      console.error("  only the machine-wide takeover was refused. Nothing was changed.");
      console.error("");
      return 1;
    }
    try {
      const res = await enableSystemProxy(DEFAULT_PROXY_PORT);
      console.log(`system proxy: ON — every app routes through Wrapbox (services: ${res.services.join(", ")})`);
      console.log("system proxy: will be restored automatically when this daemon stops.");
    } catch (err) {
      console.error(`system proxy: failed to enable (${(err as Error).message}) — continuing without it`);
    }
  }

  const doInventory = async () => {
    try {
      const sightings = await detectAgents();
      if (sightings.length === 0) {
        console.log("inventory: no agent sightings on this device");
        return;
      }
      // Push what we found so the Fleet page can show it. Without this the
      // device shows up on the Control Plane with no agents listed, which
      // reads as "the runtime cannot see anything" when the truth is "the
      // runtime never told the Control Plane". Discovery is inventory, not
      // enforcement — it never claims that a listed agent is governed.
      try {
        const res = await pushAgents(cfg, sightings.map((s) => ({
          registry_id: s.registryId,
          name: s.name,
          kind: s.kind,
          detected_via: s.detected,
          where: s.where,
          ...(s.version ? { version: s.version } : {}),
        })));
        console.log(`inventory: ${sightings.length} sighting(s) — ${res.upserted} upserted, ${res.seen} total on record`);
      } catch (err) {
        // Fail-open: the local scan already happened. A push failure means the
        // Fleet page shows a slightly stale list, not that the runtime is broken.
        console.error(`inventory: local scan found ${sightings.length} sighting(s), but push to control plane failed (${(err as Error).message})`);
      }
    } catch (err) {
      console.error(`inventory scan failed: ${(err as Error).message}`);
    }
  };

  const doShimTamper = () => {
    try {
      const report = checkShimTamper();
      if (report.drifted.length === 0 && report.missing.length === 0) return;
      console.log(`shim tamper: ${report.drifted.length} drifted, ${report.missing.length} missing — regenerating`);
      void installShims();
    } catch (err) {
      console.error(`shim tamper check failed: ${(err as Error).message}`);
    }
  };

  // Kick everything once at start, then on their intervals.
  await doHeartbeat();
  await doPull();
  await doDrain();
  doTamperCheck();
  await doInventory();
  doShimTamper();

  timers.push(setInterval(doHeartbeat, cfg.heartbeatInterval * 1000));
  timers.push(setInterval(doPull, cfg.pullInterval * 1000));
  timers.push(setInterval(doDrain, 10_000));
  timers.push(setInterval(doTamperCheck, 5_000));
  timers.push(setInterval(doInventory, 15 * 60_000));
  timers.push(setInterval(doShimTamper, 5 * 60_000));

  return new Promise<number>((resolve) => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      timers.forEach(clearInterval);
      if (proxy) proxy.server.removeAllListeners("close");
      void proxy?.stop();
      // CRITICAL: restore networking BEFORE we exit, or every app on the Mac
      // is left pointed at a dead proxy port with no internet.
      if (protectNetwork) {
        try {
          const svcs = await disableSystemProxy();
          console.log(`system proxy: restored on ${svcs.join(", ")}`);
        } catch (err) {
          console.error(`system proxy: FAILED to restore (${(err as Error).message}) — run: wrapboxd unprotect-network`);
        }
      }
      console.log("wrapboxd daemon stopped.");
      resolve(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    // Belt-and-braces: if the process is about to exit for any other reason
    // while the system proxy is ours, the synchronous-only exit hook cannot run
    // networksetup, so we rely on SIGINT/SIGTERM above and the unprotect-network
    // escape hatch. Document that plainly rather than pretend exit covers it.
  });
}
