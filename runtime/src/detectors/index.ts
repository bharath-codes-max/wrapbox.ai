/**
 * Detector loader — the ONE place the runtime learns which detectors exist.
 *
 * Built-ins are always present. Plugins (secrets v2, tree-sitter code, EDM,
 * labels, semantic/ONNX) are loaded dynamically at daemon start; a plugin that
 * is missing, fails to import, or reports itself unavailable is recorded as
 * such — the capability snapshot says exactly that, and the compiler keeps the
 * clause UNDERSTOOD_ONLY. Nothing is ever assumed present.
 */

import type { DetectorImpl, DetectorAvailability, DetectInput, Finding } from "@wrapbox/registry";
import { BUILTIN_IMPLS } from "./builtin.js";

interface Loaded { impl: DetectorImpl; source: "builtin" | "plugin"; error?: string }

const loaded: Loaded[] = BUILTIN_IMPLS.map((impl) => ({ impl, source: "builtin" as const }));
const failed: Array<{ module: string; error: string }> = [];
let pluginsLoaded = false;

const PLUGINS: Array<{ module: string; init?: string }> = [
  { module: "./secrets.js" },
  { module: "./code.js", init: "initCodeDetector" },
  { module: "./edm.js" },
  { module: "./labels.js" },
  { module: "./semantic.js" },
];

/** Import every plugin once. Safe to call repeatedly. */
export async function loadPlugins(): Promise<{ loaded: string[]; failed: Array<{ module: string; error: string }> }> {
  if (!pluginsLoaded) {
    pluginsLoaded = true;
    for (const p of PLUGINS) {
      try {
        const mod = (await import(p.module)) as Record<string, unknown>;
        if (p.init && typeof mod[p.init] === "function") {
          try { await (mod[p.init] as () => Promise<void>)(); } catch (e) { failed.push({ module: p.module, error: `init: ${(e as Error).message}` }); }
        }
        const impl = mod.detector as DetectorImpl | undefined;
        if (impl && typeof impl.detect === "function") loaded.push({ impl, source: "plugin" });
        else failed.push({ module: p.module, error: "module exports no `detector`" });
      } catch (e) {
        failed.push({ module: p.module, error: (e as Error).message.split("\n")[0].slice(0, 160) });
      }
    }
  }
  return { loaded: loaded.map((l) => l.impl.descriptor.id), failed: [...failed] };
}

/** Register an implementation programmatically (tests, tenant packs). */
export function registerDetectorImpl(impl: DetectorImpl, source: "builtin" | "plugin" = "plugin"): void {
  const i = loaded.findIndex((l) => l.impl.descriptor.id === impl.descriptor.id);
  if (i >= 0) loaded[i] = { impl, source }; else loaded.push({ impl, source });
}

export function activeDetectors(): DetectorImpl[] {
  return loaded.filter((l) => l.impl.available().ok).map((l) => l.impl);
}

export function detectorAvailability(): DetectorAvailability[] {
  const out: DetectorAvailability[] = loaded.map((l) => {
    const a = l.impl.available();
    return { id: l.impl.descriptor.id, version: l.impl.descriptor.version, available: a.ok, ...(a.reason ? { reason: a.reason } : {}), emits: l.impl.descriptor.emits };
  });
  for (const f of failed) out.push({ id: f.module.replace(/^\.\//, "plugin:").replace(/\.js$/, ""), version: "0", available: false, reason: f.error, emits: [] });
  return out;
}

/** Run every available detector over one content unit; merge by type (max count wins, best confidence wins). */
export function detectAll(input: DetectInput): Finding[] {
  const merged = new Map<string, Finding>();
  for (const d of activeDetectors()) {
    if (!d.descriptor.inputs.includes(input.input) && !d.descriptor.inputs.includes("any")) continue;
    let fs: Finding[] = [];
    try { fs = d.detect(input); } catch (e) { failed.push({ module: d.descriptor.id, error: `detect threw: ${(e as Error).message.slice(0, 120)}` }); continue; }
    for (const f of fs) {
      const key = `${f.type}|${f.unitPath ?? ""}`;
      const prev = merged.get(key);
      if (!prev) { merged.set(key, f); continue; }
      const rank = { low: 0, medium: 1, high: 2 } as const;
      const better = rank[f.confidence] > rank[prev.confidence] || (rank[f.confidence] === rank[prev.confidence] && f.count > prev.count);
      merged.set(key, { ...(better ? f : prev), count: Math.max(f.count, prev.count) });
    }
  }
  return [...merged.values()];
}
