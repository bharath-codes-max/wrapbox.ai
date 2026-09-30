/**
 * `wrapboxd run [--project ID] [--net on|off|loopback:PORT] [--deny path]... -- <cmd...>`
 *
 * Wraps a command in a kernel-enforced Seatbelt profile compiled from the
 * cached policy, watches the unified log for sandbox denials, and records
 * each relevant denial as a signed "violation" receipt.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { loadConfig, PATHS } from "../config.js";
import { makeReceipt, appendToSpool } from "../receipts.js";
import { compileProfile, rulesToDenies, matchesSecretPattern, type NetworkMode } from "../seatbelt.js";
import { startViolationWatch, showViolationsSince, violationKey, type Violation } from "../logwatch.js";
import { writeProxySession, clearProxySession, DEFAULT_PROXY_PORT } from "../proxy.js";

export async function cmdRun(args: string[]): Promise<number> {
  let project: string | undefined;
  let network: NetworkMode = "on";
  const denyExtras: string[] = [];
  let cmd: string[] = [];
  let agentTag: string | undefined;
  let proxyEnv: { host: string; port: number } | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      cmd = args.slice(i + 1);
      break;
    } else if (a === "--project" && args[i + 1]) {
      project = args[++i];
    } else if (a === "--agent" && args[i + 1]) {
      agentTag = args[++i];
    } else if (a === "--net" && args[i + 1]) {
      const v = args[++i];
      if (v === "on" || v === "off") network = v;
      else if (v === "proxy") {
        // Route through the local proxy: allow loopback egress in the sandbox
        // and set HTTP_PROXY/HTTPS_PROXY on the child env.
        const port = DEFAULT_PROXY_PORT;
        network = { loopbackPort: port };
        proxyEnv = { host: "127.0.0.1", port };
      } else if (v.startsWith("loopback:")) network = { loopbackPort: Number(v.slice("loopback:".length)) };
      else {
        console.error(`✖ Invalid --net value: ${v} (use on | off | proxy | loopback:PORT)`);
        return 64;
      }
    } else if (a === "--deny" && args[i + 1]) {
      denyExtras.push(args[++i]);
    } else {
      console.error(`✖ Unknown argument before --: ${a}`);
      return 64;
    }
  }
  if (cmd.length === 0) {
    console.error("Usage: wrapboxd run [--project ID] [--net on|off|loopback:PORT] [--deny path]... -- <cmd...>");
    return 64;
  }

  // Fail closed: wrapping requires enrollment AND a cached policy.
  const cfg = loadConfig();
  if (!cfg) {
    console.error("✖ Not enrolled — refusing to run unwrapped (fail closed). Run: wrapboxd enroll ...");
    return 1;
  }
  const policy = await import("../policy.js");
  const cached = policy.loadCachedRules();
  if (!cached) {
    console.error("✖ No cached policy — refusing to run unwrapped (fail closed). Run: wrapboxd pull");
    return 1;
  }
  const projectRules = policy.applyProjectFilter(cached.rules, project);
  const derived = rulesToDenies(projectRules);

  // --deny extras: absolute paths become kernel subpath denies; anything else
  // is treated as a literal fragment (escaped into a regex by compile step
  // callers) — here we take absolute-only to avoid guessing.
  const denySubpaths: string[] = [];
  const extraRegexes: string[] = [...derived.extraDenyRead];
  for (const d of denyExtras) {
    if (d.startsWith("/")) denySubpaths.push(d);
    else extraRegexes.push(d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }

  const cwd = process.cwd();
  const session = nanoid();
  const profile = compileProfile({
    cwd,
    extraDenyRead: extraRegexes,
    denySubpaths: [...derived.denySubpaths, ...denySubpaths],
    network,
  });
  fs.mkdirSync(PATHS.profilesDir, { recursive: true });
  const profilePath = path.join(PATHS.profilesDir, `${session}.sb`);
  fs.writeFileSync(profilePath, profile);

  let receiptsWritten = 0;
  const seen = new Set<string>();
  const startedAt = new Date();
  const onDeny = (v: Violation) => {
    // Only evidence denials that are plausibly ours: under this cwd or a
    // secret pattern. (Counts are approximate — the kernel coalesces repeats.)
    const relevant = v.path !== "" && (v.path.startsWith(cwd + path.sep) || v.path === cwd || matchesSecretPattern(v.path));
    if (!relevant || seen.has(violationKey(v))) return;
    seen.add(violationKey(v));
    try {
      const receipt = makeReceipt(cfg, {
        agent: "seatbelt",
        session,
        tool_name: "",
        tool_input: { op: v.op, path: v.path, proc: v.proc, pid: v.pid },
        target: v.path,
        effect: "violation",
        reason: `kernel denial: ${v.op}`,
        rule_id: null,
        ruleset_pulled_at: cached.pulled_at,
        enforcement: "seatbelt",
        degraded: false,
      });
      appendToSpool(receipt);
      receiptsWritten++;
    } catch (err) {
      console.error(`wrapboxd: failed to write violation receipt: ${(err as Error).message}`);
    }
  };
  const stopWatch = startViolationWatch(onDeny);

  const childEnv: NodeJS.ProcessEnv = { ...process.env, WRAPBOX_SESSION: session };
  if (agentTag) childEnv.WRAPBOX_AGENT = agentTag;
  if (proxyEnv) {
    const url = `http://${proxyEnv.host}:${proxyEnv.port}`;
    childEnv.HTTP_PROXY = url;
    childEnv.HTTPS_PROXY = url;
    childEnv.http_proxy = url;
    childEnv.https_proxy = url;
    childEnv.NO_PROXY = "localhost,127.0.0.1,::1";
    childEnv.no_proxy = childEnv.NO_PROXY;
    if (agentTag) writeProxySession(agentTag, session);
  }

  const child = spawn("/usr/bin/sandbox-exec", ["-f", profilePath, ...cmd], {
    stdio: "inherit",
    env: childEnv,
  });

  const code: number = await new Promise((resolve) => {
    child.on("exit", (c, sig) => resolve(c ?? (sig ? 1 : 0)));
    child.on("error", (err) => {
      console.error(`✖ sandbox-exec failed to start: ${err.message}`);
      resolve(127);
    });
  });

  // Kernel denials reach the log store with a lag of a couple of seconds, and
  // `log stream` may not have attached before a fast child (cat .env) already
  // exited. Linger, then backfill from the store; `seen` dedups the overlap.
  await new Promise((r) => setTimeout(r, 2500));
  stopWatch();
  showViolationsSince(startedAt, onDeny);
  if (proxyEnv && agentTag) clearProxySession();
  const tag = agentTag ? ` agent=${agentTag}` : "";
  console.error(`wrapboxd: session ${session}${tag} exited ${code}; ${receiptsWritten} violation receipt(s) written`);
  return code;
}
