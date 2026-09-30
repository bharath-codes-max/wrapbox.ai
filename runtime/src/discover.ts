/**
 * Agent discovery — walks every registry signature and returns the resolved
 * absolute paths / bundle hits / extension ids on this machine. Best effort,
 * fail-open on individual signature errors so one bad probe never masks the
 * rest.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REGISTRY, expandHome, extensionsDirFor, type RegistryEntry } from "./registry.js";

export interface AgentSighting {
  registryId: string;
  name: string;
  kind: RegistryEntry["kind"];
  detected: "bin" | "app" | "path" | "extension";
  where: string;
  version?: string;
}

function whichAll(name: string): string[] {
  // Skip our own shim dir so we don't detect the shims themselves as the agent.
  const shimDir = process.env.WRAPBOX_HOME
    ? path.join(process.env.WRAPBOX_HOME, "shims")
    : path.join(process.env.HOME || "", ".wrapbox", "shims");
  const originalPath = process.env.WRAPBOX_ORIGINAL_PATH || process.env.PATH || "";
  const dirs = originalPath.split(":").filter((d) => d && d !== shimDir);
  const hits: string[] = [];
  for (const d of dirs) {
    const full = path.join(d, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && (st.mode & 0o111) !== 0) hits.push(full);
    } catch { /* not here */ }
  }
  return hits;
}

function mdfindBundle(bundleId: string): string[] {
  // https://developer.apple.com/library/archive/documentation/Darwin/Reference/ManPages/man1/mdfind.1.html
  const res = spawnSync("/usr/bin/mdfind", [`kMDItemCFBundleIdentifier == "${bundleId}"`], {
    timeout: 4000,
    encoding: "utf-8",
  });
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

function tryVersion(bin: string): string | undefined {
  const res = spawnSync(bin, ["--version"], { timeout: 2500, encoding: "utf-8" });
  if (res.status !== 0) return undefined;
  const out = (res.stdout || res.stderr || "").split("\n")[0].trim();
  return out || undefined;
}

function extensionMatches(host: "vscode" | "cursor" | "windsurf", ids: string[]): { id: string; where: string }[] {
  const dir = extensionsDirFor(host);
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const wanted = new Set(ids.map((s) => s.toLowerCase()));
  const hits: { id: string; where: string }[] = [];
  for (const name of entries) {
    // Extension folders are named "<publisher>.<name>-<version>"; match by prefix.
    const lower = name.toLowerCase();
    for (const w of wanted) {
      if (lower === w || lower.startsWith(w + "-")) {
        hits.push({ id: w, where: path.join(dir, name) });
        break;
      }
    }
  }
  return hits;
}

export async function detectAgents(): Promise<AgentSighting[]> {
  const out: AgentSighting[] = [];
  const seen = new Set<string>();
  const push = (s: AgentSighting) => {
    const key = `${s.registryId}|${s.detected}|${s.where}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  for (const entry of REGISTRY) {
    for (const sig of entry.detect) {
      try {
        if (sig.kind === "bin") {
          for (const name of sig.names) {
            for (const hit of whichAll(name)) {
              const version = entry.versionSafe ? tryVersion(hit) : undefined;
              push({ registryId: entry.id, name: entry.name, kind: entry.kind, detected: "bin", where: hit, version });
            }
          }
        } else if (sig.kind === "app") {
          for (const b of sig.bundleIds) {
            for (const p of mdfindBundle(b)) {
              push({ registryId: entry.id, name: entry.name, kind: entry.kind, detected: "app", where: p });
            }
          }
        } else if (sig.kind === "path") {
          for (const raw of sig.paths) {
            const p = expandHome(raw);
            if (fs.existsSync(p)) push({ registryId: entry.id, name: entry.name, kind: entry.kind, detected: "path", where: p });
          }
        } else if (sig.kind === "extension") {
          for (const hit of extensionMatches(sig.host, sig.ids)) {
            push({ registryId: entry.id, name: entry.name, kind: entry.kind, detected: "extension", where: hit.where });
          }
        }
      } catch { /* one bad signature must not kill the scan */ }
    }
  }
  return out;
}

/** Registry entries that should get a PATH shim installed. */
export function shimTargets(sightings: AgentSighting[]): { entry: RegistryEntry; binNames: string[] }[] {
  const byId = new Map<string, { entry: RegistryEntry; binNames: Set<string> }>();
  for (const s of sightings) {
    if (s.detected !== "bin") continue;
    const entry = REGISTRY.find((e) => e.id === s.registryId);
    if (!entry || !entry.shimmable) continue;
    const acc = byId.get(entry.id) ?? { entry, binNames: new Set<string>() };
    acc.binNames.add(path.basename(s.where));
    byId.set(entry.id, acc);
  }
  return [...byId.values()].map((v) => ({ entry: v.entry, binNames: [...v.binNames] }));
}
