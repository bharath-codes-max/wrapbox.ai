/**
 * Content Detector Registry (§5, §6, §24).
 *
 * Replaces the fixed 4-class worldview with a plugin registry. A detector
 * DECLARES which classes it can produce and how (deterministic pattern, ML,
 * dictionary, exact-data, metadata…). The compiler asks the registry "is class
 * X producible?" — it never hard-codes an answer. Register a `content.financial`
 * detector tomorrow and FINANCIAL contracts enforce with no compiler change.
 *
 * This module holds the REGISTRY and the mapping from a semantic class to the
 * detector family that would produce it. The actual runtime detection lives in
 * the daemon (runtime/src/classify.ts); here we mirror only which FAMILIES a
 * deployed detector covers, so status derivation is honest about what exists.
 *
 * We are NOT building ONNX/Presidio detectors now — only the interface and the
 * registration of the ONE real deterministic detector. Everything else is a
 * declared-but-absent capability, which the status system reports honestly.
 */

/** How a detector reaches its conclusion — for Evidence and confidence policy. */
export type EvidenceType = "pattern" | "checksum" | "entropy" | "dictionary" | "context" | "ner" | "ml" | "exact_data" | "metadata";

export interface DetectionResult {
  /** The class family produced, e.g. "pii", "secret", "financial". */
  class: string;
  /** A finer label, e.g. "email_address" — never the value. */
  subtype?: string;
  /** 0–1. Kept SEPARATE from any security-decision confidence (§17). */
  confidence: number;
  evidenceType: EvidenceType;
  detector: string;
  /** Number of distinct hits — counts only, never values. */
  count?: number;
}

export interface ContentDetector {
  id: string;
  version: string;
  /** The class FAMILIES this detector emits (what a capability is named after). */
  classes: string[];
  supportedMimeTypes: string[];   // ["*"] for content-agnostic
  supportedEncodings: string[];
  /** Whether this runs locally in the daemon (§14) — a cloud detector is an
   *  opt-in enterprise integration and must be flagged so raw content is never
   *  sent to a third party by default. */
  local: boolean;
  /** The interface a real detector implements. The registry does not call this
   *  during authoring; the daemon does at enforcement time. Present so an ONNX
   *  or exact-data detector plugs in without touching the registry. */
  inspect?: (input: Uint8Array, mime: string) => DetectionResult[];
}

/* ------------------------------------------------------------------ *
 * The registry.
 * ------------------------------------------------------------------ */

const DETECTORS = new Map<string, ContentDetector>();

/**
 * The one detector that genuinely exists today: the deterministic content
 * classifier in runtime/src/classify.ts. It emits four coarse families. Its
 * `classes` here MUST match ContentKind there — a drift-guard test asserts it.
 */
export const DETERMINISTIC_DETECTOR: ContentDetector = {
  id: "wrapbox.deterministic",
  version: "1.0.0",
  classes: ["pii", "secret", "source_code", "credential_file"],
  supportedMimeTypes: ["*"],
  supportedEncodings: ["utf-8", "gzip", "deflate", "br"],
  local: true,
};

registerDetector(DETERMINISTIC_DETECTOR);

export function registerDetector(d: ContentDetector): void {
  DETECTORS.set(d.id, d);
}
export function unregisterDetector(id: string): void {
  DETECTORS.delete(id);
}
export function allDetectors(): ContentDetector[] {
  return [...DETECTORS.values()];
}

/** Every class FAMILY at least one registered detector can produce. This is
 *  the set the capability system treats as observable content. */
export function detectableFamilies(): Set<string> {
  const out = new Set<string>();
  for (const d of DETECTORS.values()) for (const c of d.classes) out.add(c);
  return out;
}

/** The detectors that cover a given family (may be several — a request can get
 *  findings from multiple recognizers, Presidio-style). */
export function detectorsForClass(family: string): ContentDetector[] {
  return [...DETECTORS.values()].filter((d) => d.classes.includes(family));
}

/**
 * The runtime content kinds that a set of semantic classes actually reduce to,
 * given the registered detectors. A class whose family no detector covers is
 * returned as unobservable — never mapped to something adjacent.
 *
 * This replaces the old fixed CLASS_BRIDGE: the bridge is now "does a detector
 * for this family exist?", so adding a detector changes the answer with no
 * edit here.
 */
export function observableKinds(classes: string[], familyOf: (c: string) => string): { kinds: string[]; unobservable: string[] } {
  const detectable = detectableFamilies();
  const kinds = new Set<string>();
  const unobservable: string[] = [];
  for (const c of classes) {
    const fam = familyOf(c);
    if (detectable.has(fam)) kinds.add(fam);
    else unobservable.push(c);
  }
  return { kinds: [...kinds], unobservable };
}
