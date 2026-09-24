/**
 * Extractor loader — Tier 0 is the daemon's own parsers (always present);
 * Tier 1/2 helpers (OCR, the Tika sidecar) are optional and reported honestly.
 */

import type { ExtractorAvailability, ExtractorDescriptor, ExtractionResult, BUILTIN_EXTRACTORS as _B } from "@wrapbox/registry";
import { BUILTIN_EXTRACTORS } from "@wrapbox/registry";

export interface ExtractorImpl {
  descriptor: ExtractorDescriptor;
  available(): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
  extract(bytes: Buffer, hints: { filename?: string; contentType?: string; unitPath?: string; depth?: number }): Promise<ExtractionResult>;
}

const impls: ExtractorImpl[] = [];
const failed: Array<{ module: string; error: string }> = [];
let loadedOnce = false;
const availability = new Map<string, { ok: boolean; reason?: string }>();

const PLUGINS = ["./tika.js", "./ocr.js"];

export async function loadExtractors(): Promise<void> {
  if (loadedOnce) return;
  loadedOnce = true;
  for (const m of PLUGINS) {
    try {
      const mod = (await import(m)) as Record<string, unknown>;
      const impl = (mod.extractor ?? mod.default) as ExtractorImpl | undefined;
      if (impl && typeof impl.extract === "function") impls.push(impl);
      else failed.push({ module: m, error: "module exports no `extractor`" });
    } catch (e) { failed.push({ module: m, error: (e as Error).message.split("\n")[0].slice(0, 160) }); }
  }
  await refreshAvailability();
}

/** Re-probe sidecars/helpers (cheap; called at start and every few minutes). */
export async function refreshAvailability(): Promise<void> {
  for (const i of impls) {
    try { availability.set(i.descriptor.id, await i.available()); }
    catch (e) { availability.set(i.descriptor.id, { ok: false, reason: (e as Error).message.slice(0, 120) }); }
  }
}

export function registerExtractorImpl(impl: ExtractorImpl, avail: { ok: boolean; reason?: string } = { ok: true }): void {
  const i = impls.findIndex((x) => x.descriptor.id === impl.descriptor.id);
  if (i >= 0) impls[i] = impl; else impls.push(impl);
  availability.set(impl.descriptor.id, avail);
}

/** The first available optional extractor that handles a format. */
export function extractorFor(format: string): ExtractorImpl | null {
  for (const i of impls) {
    if ((i.descriptor.formats as string[]).includes(format) && availability.get(i.descriptor.id)?.ok) return i;
  }
  return null;
}

export function extractorAvailability(): ExtractorAvailability[] {
  const tier0 = BUILTIN_EXTRACTORS.find((e) => e.id === "wrapbox.tier0")!;
  const out: ExtractorAvailability[] = [{ id: tier0.id, version: tier0.version, available: true, formats: tier0.formats as string[], canTransform: true }];
  for (const i of impls) {
    const a = availability.get(i.descriptor.id) ?? { ok: false, reason: "not probed" };
    out.push({ id: i.descriptor.id, version: i.descriptor.version, available: a.ok, ...(a.reason ? { reason: a.reason } : {}), formats: i.descriptor.formats as string[], canTransform: i.descriptor.canTransform });
  }
  for (const f of failed) out.push({ id: f.module.replace(/^\.\//, "plugin:").replace(/\.js$/, ""), version: "0", available: false, reason: f.error, formats: [], canTransform: false });
  return out;
}
