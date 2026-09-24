/**
 * Content classification for outbound traffic — the compatibility surface over
 * the inspection pipeline (inspect.ts).
 *
 * Detection itself now lives in registry-driven detectors (detectors/*): each
 * emits canonical data TYPES with a count of distinct values and a confidence.
 * This module keeps the shape the rest of the daemon has always consumed —
 * `kinds`, `findings`, `inspectable` — derived from those typed findings, and
 * adds the typed view (`typed`, `types`, `inspection`, `state`) that the v2
 * rules and evidence use. One pipeline, two views; never two detectors.
 *
 * NEVER RETURNS SECRET VALUES. Findings carry a type, a label, a count and a
 * location, never the matched text.
 */

import { dataTypes, type Finding as TypedFinding, type UninspectableState } from "@wrapbox/registry";
import { inspectSync, inspectAsync, type Inspection } from "./inspect.js";
import type { ParseFormat } from "./parsers.js";

export { MAX_SCAN_BYTES } from "./inspect.js";

/**
 * The coarse content vocabulary older rules match on (`content_kinds`). It is
 * DERIVED from the registry's per-type legacy kinds — no longer a list of its
 * own — so the compiler's mirror and the runtime cannot drift.
 */
export const RUNTIME_CONTENT_KINDS: string[] = [...new Set(dataTypes().all().map((d) => d.legacyKind).filter((k): k is string => !!k))].sort();

export type ContentKind = string;

/** Legacy finding view: label + coarse kind. */
export interface Finding {
  /** What was found, e.g. "aws_access_key" or the registry type. Never the value itself. */
  label: string;
  kind: ContentKind;
  count: number;
  /** Detector confidence as a number 0–1 (evidence strength only). */
  confidence?: number;
  /** The canonical registry type behind this finding. */
  type?: string;
}

export interface Classification {
  kinds: ContentKind[];
  findings: Finding[];
  /** Filenames seen in multipart uploads — useful in the block message. */
  filenames: string[];
  bytes: number;
  truncated: boolean;
  /** True when the body carried a file upload rather than just form/JSON fields. */
  hasFileUpload: boolean;
  /** The parse format the body was recognised as (parsers.ts). */
  format: ParseFormat | string;
  /** False when at least one part of the body is in a format the runtime cannot
   *  read. A content protection must then fail closed rather than trust an
   *  empty finding set (§4). */
  inspectable: boolean;
  inspectReason?: string;

  // ── typed view (v2) ──
  typed: TypedFinding[];
  types: string[];
  inspection: "inspected" | "uninspectable" | "host_only";
  state?: UninspectableState;
  extractor: string;
  detectorVersions: Record<string, string>;
  unitCount: number;
}

const CONF_NUM = { low: 0.4, medium: 0.7, high: 0.95 } as const;

/** Project the pipeline's result onto both views. */
export function fromInspection(i: Inspection): Classification {
  const reg = dataTypes();
  const kinds = new Set<string>();
  const findings: Finding[] = [];
  for (const f of i.findings) {
    const kind = f.type.startsWith("UNINSPECTABLE") ? null : (reg.legacyKind(f.type) ?? f.type.split(".")[0].toLowerCase());
    if (kind) kinds.add(kind);
    // A credential file is a secret whatever the bytes look like (kept from v1).
    if (kind === "credential_file") kinds.add("secret");
    findings.push({ label: f.label ?? f.type, kind: kind ?? "uninspectable", count: f.count, confidence: CONF_NUM[f.confidence], type: f.type });
  }
  return {
    kinds: [...kinds].sort(), findings, filenames: i.filenames, bytes: i.bytes, truncated: i.truncated, hasFileUpload: i.hasFileUpload,
    format: i.format, inspectable: i.inspection === "inspected", ...(i.reason ? { inspectReason: i.reason } : {}),
    typed: i.findings, types: i.types, inspection: i.inspection, ...(i.state ? { state: i.state } : {}),
    extractor: i.extractor, detectorVersions: i.detectorVersions, unitCount: i.units.length,
  };
}

/** A classification for a body that was never read (oversize, undecodable, WebSocket, host-only). */
export function uninspectableClassification(state: UninspectableState, reason: string, bytes = 0, inspection: "uninspectable" | "host_only" = "uninspectable"): Classification {
  return {
    kinds: [], findings: [{ label: reason.slice(0, 120), kind: "uninspectable", count: 1, type: `UNINSPECTABLE.${state}` }], filenames: [], bytes, truncated: bytes > 0,
    hasFileUpload: false, format: "unknown", inspectable: false, inspectReason: reason,
    typed: [{ type: `UNINSPECTABLE.${state}`, count: 1, confidence: "high", detector: "wrapbox.tier0", version: "1", label: reason.slice(0, 120) }],
    types: [`UNINSPECTABLE.${state}`], inspection, state, extractor: "wrapbox.tier0", detectorVersions: {}, unitCount: 0,
  };
}

/** Synchronous, Tier-0-only classification (tests, self-checks, gateway). */
export function classifyContent(body: Buffer, contentType = ""): Classification {
  return fromInspection(inspectSync(body, contentType));
}

/** Full classification with optional extractors — the daemon's path. */
export async function classifyContentAsync(body: Buffer, contentType = ""): Promise<Classification> {
  return fromInspection(await inspectAsync(body, contentType));
}

/**
 * Every finding LABEL the runtime can emit, for rules keyed on
 * `tool_input.findings` labels (v1) and for the fail-closed gate's worst case.
 * Typed rules use registry ids instead (see allTypes()).
 */
export const RUNTIME_FINDING_LABELS: string[] = [
  "private_key", "openssh_private_key", "pgp_private_key", "aws_access_key", "github_token", "slack_token", "openai_key", "anthropic_key",
  "google_api_key", "stripe_key", "jwt", "bearer_token", "assigned_secret", "credential_file", "source_code",
  "email_addresses", "phone_numbers", "aadhaar_numbers", "card_numbers", "financial_data", "protected_health_information", "legal_document", "classified_document",
  ...dataTypes().ids(),
];

/** One human-readable line for a block page or a notification. */
export function describeClassification(c: Classification): string {
  if (!c.findings.length) return c.inspectable ? "no sensitive content detected" : (c.inspectReason ?? "content could not be inspected");
  return c.findings
    .filter((f) => !f.type?.startsWith("UNINSPECTABLE"))
    .map((f) => (f.count > 1 ? `${f.label} (${f.count})` : f.label))
    .concat(c.inspectable ? [] : [`uninspectable: ${c.inspectReason ?? c.state ?? "unknown"}`])
    .join(", ");
}
