/**
 * System-wide proxy control (macOS).
 *
 * Points every app's HTTP/HTTPS traffic at the local Wrapbox proxy by setting
 * the OS proxy on each active network service via `networksetup`. This is what
 * makes a normally-launched Safari / Chrome / VS Code route through policy —
 * no per-app flag, no special launch.
 *
 * SAFETY: while the system proxy points at 127.0.0.1:<port>, the machine has
 * network access ONLY while our proxy is listening. If the daemon exits without
 * restoring the setting, every app loses the internet. Therefore:
 *   - the daemon that turns this on MUST restore it on exit (see daemon.ts),
 *   - the previous proxy settings are captured first and put back verbatim,
 *   - `wrapboxd unprotect-network` is the always-available escape hatch.
 *
 * We do NOT terminate TLS. For an allowed HTTPS site the proxy tunnels raw
 * bytes, so the real certificate reaches the browser and there is no warning;
 * only the CONNECT hostname is inspected. Blocking is by domain, not content.
 *
 * On this macOS, `networksetup` changes the web proxy without sudo for the
 * logged-in user. In a managed fleet the same setting arrives as an MDM proxy
 * payload — no user interaction — which is the production path.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "./config.js";

const run = promisify(execFile);
const SAVED = path.join(PATHS.home, "sysproxy-prev.json");

interface SavedProxy {
  service: string;
  web: { enabled: boolean; server: string; port: string };
  secure: { enabled: boolean; server: string; port: string };
}

/** Network services that are present and not disabled (a "*" prefix = disabled). */
async function activeServices(): Promise<string[]> {
  const { stdout } = await run("networksetup", ["-listallnetworkservices"]);
  return stdout
    .split("\n")
    .slice(1) // first line is an explanatory header
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*"));
}

function parseProxy(stdout: string): { enabled: boolean; server: string; port: string } {
  const get = (k: string) => (stdout.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1] ?? "").trim();
  return { enabled: get("Enabled").toLowerCase() === "yes", server: get("Server"), port: get("Port") };
}

async function readService(service: string): Promise<SavedProxy> {
  const [web, secure] = await Promise.all([
    run("networksetup", ["-getwebproxy", service]).then((r) => parseProxy(r.stdout)),
    run("networksetup", ["-getsecurewebproxy", service]).then((r) => parseProxy(r.stdout)),
  ]);
  return { service, web, secure };
}

export interface SysProxyResult {
  services: string[];
  port: number;
}

/** Point every active service at 127.0.0.1:<port>, saving what was there first. */
export async function enableSystemProxy(port: number): Promise<SysProxyResult> {
  const services = await activeServices();

  // Capture current settings ONCE. If a save file already exists we do not
  // overwrite it — that would lose the user's real settings behind our own.
  if (!fs.existsSync(SAVED)) {
    const prev: SavedProxy[] = [];
    for (const s of services) prev.push(await readService(s));
    fs.mkdirSync(PATHS.home, { recursive: true });
    fs.writeFileSync(SAVED, JSON.stringify(prev, null, 2), { mode: 0o600 });
  }

  for (const s of services) {
    await run("networksetup", ["-setwebproxy", s, "127.0.0.1", String(port)]);
    await run("networksetup", ["-setsecurewebproxy", s, "127.0.0.1", String(port)]);
    // Never route loopback/local through ourselves — it would break the
    // control-plane call and localhost dev servers.
    await run("networksetup", ["-setproxybypassdomains", s, "localhost", "127.0.0.1", "*.local", "169.254/16"]);
  }
  return { services, port };
}

/** Restore whatever was there before enable(), or turn the proxy off. */
export async function disableSystemProxy(): Promise<string[]> {
  let saved: SavedProxy[] = [];
  try {
    saved = JSON.parse(fs.readFileSync(SAVED, "utf-8"));
  } catch {
    saved = [];
  }

  // Restore every service we have a record for; for anything else that is
  // currently pointed at us, turn it off so the machine is never left proxied
  // at a dead port.
  const services = saved.length ? saved.map((s) => s.service) : await activeServices();
  const savedByName = new Map(saved.map((s) => [s.service, s]));

  for (const service of services) {
    const rec = savedByName.get(service);
    if (rec && rec.web.enabled) {
      await run("networksetup", ["-setwebproxy", service, rec.web.server, rec.web.port]);
    } else {
      await run("networksetup", ["-setwebproxystate", service, "off"]);
    }
    if (rec && rec.secure.enabled) {
      await run("networksetup", ["-setsecurewebproxy", service, rec.secure.server, rec.secure.port]);
    } else {
      await run("networksetup", ["-setsecurewebproxystate", service, "off"]);
    }
  }

  try { fs.unlinkSync(SAVED); } catch { /* already gone */ }
  return services;
}

/** Which services currently point at our proxy port (for `status`). */
export async function systemProxyStatus(port: number): Promise<{ service: string; pointedAtUs: boolean }[]> {
  const services = await activeServices();
  const out: { service: string; pointedAtUs: boolean }[] = [];
  for (const s of services) {
    const rec = await readService(s);
    const us = (p: { enabled: boolean; server: string; port: string }) =>
      p.enabled && p.server === "127.0.0.1" && p.port === String(port);
    out.push({ service: s, pointedAtUs: us(rec.web) || us(rec.secure) });
  }
  return out;
}
