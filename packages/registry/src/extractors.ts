/**
 * Parser / Extraction Registry — descriptors of what bytes can become text.
 *
 * Extraction turns an outbound body into a tree of ContentUnits (text, tables,
 * structured data, images, metadata) or an explicit UNINSPECTABLE state. The
 * daemon's own parsers are Tier 0 (in-process, dependency-free); anything
 * heavier runs behind an isolated sidecar (Tier 2, Apache Tika) or a device
 * helper (Tier 1, OCR). The capability system requires an AVAILABLE extractor
 * for every format a clause's resource may arrive in before it calls the
 * clause ENFORCED for that format; otherwise the runtime fails closed with the
 * state below, and the state itself is evaluable in policy
 * (`UNINSPECTABLE.<STATE>` is a registry type).
 */

import type { UninspectableState } from "./datatypes.js";
import type { ContentFormat } from "./transforms.js";

export type ExtractorTier = "in_process" | "device_helper" | "sidecar";

export interface ExtractorDescriptor {
  id: string;
  version: string;
  tier: ExtractorTier;
  label: string;
  /** Formats it can turn into content units. */
  formats: ContentFormat[] | string[];
  /** Whether it re-serialises after a transform (needed for CONSTRAIN on that format). */
  canTransform: boolean;
  limits: { maxBytes: number; maxDepth: number; timeoutMs: number; maxDecompressedBytes?: number; maxEntries?: number };
  local: boolean;
  /** Config key that must be present (sidecar URL, helper binary). */
  tenantConfig?: string;
}

export interface ContentUnit {
  id: string;
  parent?: string;
  depth: number;
  format: string;
  sniffedBy: "magic" | "structure" | "declared" | "sidecar";
  input: "text" | "table" | "structured" | "image" | "code" | "metadata";
  text?: string;
  table?: { headers: string[]; rows: string[][] };
  json?: unknown;
  bytes?: Uint8Array;
  metadata: Record<string, string>;
  filename?: string;
  contentType?: string;
  truncated: boolean;
  unitPath: string;
  extractor: string;
}

export interface Uninspectable {
  state: UninspectableState;
  reason: string;
  /** Where in the container the problem was, when known. */
  unitPath?: string;
  /** Units that WERE extracted before the failure (a labelled but encrypted docx still yields metadata). */
  partialUnits?: ContentUnit[];
}

export type ExtractionResult =
  | { ok: true; units: ContentUnit[]; extractor: string }
  | { ok: false; uninspectable: Uninspectable; extractor: string };

export interface ExtractorAvailability { id: string; version: string; available: boolean; reason?: string; formats: string[]; canTransform: boolean }

export const BUILTIN_EXTRACTORS: ExtractorDescriptor[] = [
  { id: "wrapbox.tier0", version: "2.0.0", tier: "in_process", label: "In-process text/JSON/CSV/YAML/XML/HTML/multipart/OOXML", formats: ["text", "json", "csv", "tsv", "yaml", "xml", "html", "multipart", "docx", "xlsx"], canTransform: true,
    limits: { maxBytes: 64 * 1024 * 1024, maxDepth: 2, timeoutMs: 5000, maxDecompressedBytes: 96 * 1024 * 1024, maxEntries: 1024 }, local: true },
  { id: "wrapbox.tika", version: "1.0.0", tier: "sidecar", label: "Apache Tika 4 sidecar (isolated)", formats: ["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "rtf", "odt", "ods", "odp", "eml", "msg", "zip", "tar", "gz", "7z", "rar", "epub", "image"], canTransform: false,
    limits: { maxBytes: 64 * 1024 * 1024, maxDepth: 5, timeoutMs: 30000, maxDecompressedBytes: 256 * 1024 * 1024, maxEntries: 2000 }, local: true, tenantConfig: "extractors.tika.url" },
  { id: "wrapbox.ocr.vision", version: "1.0.0", tier: "device_helper", label: "Apple Vision OCR helper", formats: ["image", "pdf-scanned"], canTransform: false,
    limits: { maxBytes: 32 * 1024 * 1024, maxDepth: 1, timeoutMs: 20000 }, local: true, tenantConfig: "extractors.ocr.helper" },
];

export class ExtractorRegistry {
  private map = new Map<string, ExtractorDescriptor>();
  constructor(seed: ExtractorDescriptor[] = BUILTIN_EXTRACTORS) { for (const e of seed) this.map.set(e.id, e); }
  register(e: ExtractorDescriptor): void { this.map.set(e.id, e); }
  all(): ExtractorDescriptor[] { return [...this.map.values()]; }
  get(id: string): ExtractorDescriptor | undefined { return this.map.get(id); }
  forFormat(format: string): ExtractorDescriptor[] { return this.all().filter((e) => (e.formats as string[]).includes(format)); }
}

let defaultExtractors: ExtractorRegistry | null = null;
export function extractorRegistry(): ExtractorRegistry {
  if (!defaultExtractors) defaultExtractors = new ExtractorRegistry();
  return defaultExtractors;
}
