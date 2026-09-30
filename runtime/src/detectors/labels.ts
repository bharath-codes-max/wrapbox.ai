/**
 * Detector `wrapbox.label.mip` — Microsoft Purview / MIP sensitivity labels.
 *
 * WHY A DETECTOR AND NOT A LOOKUP. A label is the tenant's own classification
 * decision, already made and stamped on the file by Office, Outlook or the
 * AIP client. Reading it back is the cheapest, highest-precision signal the
 * runtime has — but the label GUID means nothing until the tenant tells us
 * which registry type it stands for. That mapping is tenant configuration:
 *
 *   WRAPBOX_HOME/labels.json
 *   { "mip": { "<label guid>": { "name": "Highly Confidential",
 *                                "type": "LABEL.MIP.HIGHLY_CONFIDENTIAL" } } }
 *
 * WHAT IS EMITTED (one Finding per distinct label, never a value):
 *   mapped GUID     → the mapped type, label = the configured name
 *   unmapped GUID   → LABEL.MIP, label = "unmapped:<guid>" plus the document's
 *                     own _Name so an admin can map it (a label NAME is
 *                     classification vocabulary, not content — SiteId, SetDate
 *                     and ActionId never leave this module)
 *   ContentBits&0x8 → LABEL.MIP.PROTECTED (the file is RMS-encrypted; the
 *                     extractor will not see its body, so the label is the
 *                     only thing policy can act on)
 *
 * The map is loaded at detect time and re-read when the file changes, so a
 * tenant can add a mapping without restarting the daemon. A mapping whose
 * type is not in the registry is treated as unmapped rather than inventing a
 * type — the registry is the only vocabulary. `Enabled=false` or a LabelInfo
 * `removed="1"` means the label was taken off; nothing is emitted for it.
 *
 * Reading needs nothing beyond this process, so `available()` is always ok;
 * it reports whether the tenant map exists because a clause on LABEL.MIP.* is
 * ENFORCED only when the descriptor's `tenantConfig: "labels.mip"` is met.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILTIN_DETECTORS, dataTypes } from "@wrapbox/registry";
import type { DetectorImpl, DetectInput, Finding } from "@wrapbox/registry";
import { extractLabelMetadata, groupLabelMetadata } from "../extract/label-metadata.js";

export let lastError: string | null = null;

const DESCRIPTOR = BUILTIN_DETECTORS.find((d) => d.id === "wrapbox.label.mip")!;
const CONTENT_BIT_ENCRYPTED = 0x8;
const MAX_LABEL_CHARS = 96;

interface LabelMapEntry { name: string; type: string }
interface LabelMap { byGuid: Map<string, LabelMapEntry>; present: boolean; path: string; problem?: string }

/** Resolved at call time (not import time) so tests and multi-instance runs can point WRAPBOX_HOME elsewhere. */
export function labelMapPath(): string {
  return path.join(process.env.WRAPBOX_HOME || path.join(os.homedir(), ".wrapbox"), "labels.json");
}

let cache: { path: string; mtimeMs: number; size: number; map: LabelMap } | null = null;

export function loadLabelMap(): LabelMap {
  const p = labelMapPath();
  let st: fs.Stats;
  try { st = fs.statSync(p); } catch { cache = null; return { byGuid: new Map(), present: false, path: p }; }
  if (cache && cache.path === p && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.map;
  const byGuid = new Map<string, LabelMapEntry>();
  let problem: string | undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as { mip?: Record<string, { name?: unknown; type?: unknown }> };
    const reg = dataTypes();
    for (const [guid, e] of Object.entries(raw?.mip ?? {})) {
      if (!e || typeof e !== "object") continue;
      const type = typeof e.type === "string" ? e.type : "";
      const name = typeof e.name === "string" ? e.name : "";
      // Only registry types under LABEL.MIP are legal targets; anything else is
      // a config error, surfaced through available() and treated as unmapped.
      if (!reg.has(type) || !reg.isWithin(type, "LABEL.MIP")) { problem = `labels.json: ${guid} maps to unknown type "${type}"`; continue; }
      byGuid.set(guid.toLowerCase().replace(/^\{|\}$/g, ""), { name: name || type, type });
    }
  } catch (e) {
    problem = `labels.json unreadable: ${(e as Error).message}`;
  }
  const map: LabelMap = { byGuid, present: true, path: p, ...(problem ? { problem } : {}) };
  cache = { path: p, mtimeMs: st.mtimeMs, size: st.size, map };
  return map;
}

function isTrue(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1";
}

function contentBits(v: string | undefined): number {
  if (!v) return 0;
  const s = v.trim();
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** A label NAME is vocabulary, but we still bound it and strip anything that is not printable. */
function cleanName(v: string | undefined): string {
  if (!v) return "";
  const s = v.replace(/[^\x20-\x7e -￿]/g, "").replace(/\s+/g, " ").trim();
  return s.length > MAX_LABEL_CHARS ? s.slice(0, MAX_LABEL_CHARS) : s;
}

export function detectLabels(input: DetectInput): Finding[] {
  let pairs: Record<string, string> = {};
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) if (k.startsWith("MSIP_Label_") && typeof v === "string") pairs[k] = v;
  }
  if (Object.keys(pairs).length === 0 && input.bytes && input.bytes.length > 0) {
    pairs = extractLabelMetadata(Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength), { filename: input.filename, contentType: input.contentType });
  }
  const groups = groupLabelMetadata(pairs);
  if (groups.size === 0) return [];

  const map = loadLabelMap();
  const base = { confidence: "high" as const, detector: DESCRIPTOR.id, version: DESCRIPTOR.version, ...(input.unitPath ? { unitPath: input.unitPath } : {}) };
  // Dedupe by type+label: two label GUIDs mapped to the same type count as two
  // distinct labels on one finding, matching the "count = distinct values" rule.
  const byKey = new Map<string, Finding>();
  const add = (type: string, label: string) => {
    const key = `${type}\u0000${label}`;
    const f = byKey.get(key);
    if (f) f.count++;
    else byKey.set(key, { type, count: 1, label, ...base });
  };
  let protectedCount = 0;
  for (const [guid, g] of groups) {
    // Absent Enabled (e.g. a partial XMP block) is treated as applied — a
    // label stamped on the file is a claim we would rather over-read than
    // miss; an explicit false / removed is the only opt-out.
    if (g.Enabled !== undefined && !isTrue(g.Enabled)) continue;
    if (isTrue(g.Removed)) continue;
    const mapped = map.byGuid.get(guid);
    if (mapped) add(mapped.type, cleanName(mapped.name));
    else {
      const nm = cleanName(g.Name);
      add("LABEL.MIP", nm ? `unmapped:${guid} (${nm})` : `unmapped:${guid}`);
    }
    if (contentBits(g.ContentBits) & CONTENT_BIT_ENCRYPTED) protectedCount++;
  }
  if (protectedCount > 0) byKey.set("PROTECTED", { type: "LABEL.MIP.PROTECTED", count: protectedCount, label: "rms-encrypted", ...base });
  return [...byKey.values()];
}

export const detector: DetectorImpl = {
  descriptor: DESCRIPTOR,
  available() {
    const map = loadLabelMap();
    const cfg = map.present
      ? `tenantConfig labels.mip: present (${map.byGuid.size} mapped label${map.byGuid.size === 1 ? "" : "s"} at ${map.path})${map.problem ? "; " + map.problem : ""}`
      : `tenantConfig labels.mip: absent (${map.path}); labels are read and reported as unmapped LABEL.MIP`;
    return { ok: true, reason: `label reading: ok (no MIP SDK; OOXML custom.xml/LabelInfo.xml, PDF Info/XMP, msip_labels header); ${cfg}` };
  },
  detect(input: DetectInput): Finding[] {
    try {
      lastError = null;
      return detectLabels(input);
    } catch (e) {
      lastError = `wrapbox.label.mip: ${(e as Error).message}`;
      return [];
    }
  },
};
