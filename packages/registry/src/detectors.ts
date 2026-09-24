/**
 * Detector Registry — DESCRIPTORS of what can be recognised, and by what.
 *
 * Implementations live in the runtime (they need the bytes); this package holds
 * the contract they implement and the descriptor list the compiler consults.
 * A detector declares the registry TYPES it emits (with the confidence it can
 * reach), the content inputs it consumes, where it may run, and any tenant
 * configuration it depends on. The runtime reports which descriptors are
 * actually AVAILABLE on this device right now (a model loaded, an EDM index
 * present, the Tika sidecar reachable) — declared ≠ available, and only
 * available counts for ENFORCED.
 *
 * NO DETECTOR OWNS A POLICY THRESHOLD. Detectors emit every hit with a count
 * and a confidence; the clause's `match.minCount` / `minConfidence` decides.
 */

import type { Confidence, ContentInput, Locality } from "./datatypes.js";

export type DetectorFamily =
  | "pattern" | "checksum" | "context" | "ner" | "secret" | "edm" | "regex_custom"
  | "dictionary" | "fingerprint" | "code" | "ocr" | "semantic" | "label" | "tenant";

export interface DetectorDescriptor {
  id: string;
  version: string;
  family: DetectorFamily;
  label: string;
  /** Registry types (or prefixes) this detector can emit, with the best confidence it reaches. */
  emits: Array<{ type: string; confidence: Confidence }>;
  inputs: ContentInput[];
  locality: Locality;
  cost: "cheap" | "moderate" | "heavy";
  /** Tenant configuration key that must exist before the detector is usable. */
  tenantConfig?: string;
  /** Provenance of the rule corpus (for evidence and licensing). */
  provenance?: { source: string; license: string; ref?: string };
}

/** One recognised occurrence class inside a content unit. NEVER carries the value. */
export interface Finding {
  type: string;                 // registry id, e.g. "PII.CONTACT.EMAIL"
  count: number;                // distinct values found
  confidence: Confidence;
  detector: string;             // descriptor id
  version: string;
  /** Sub-label for evidence, e.g. the Gitleaks rule id or the label name. Never a value. */
  label?: string;
  /** Column / key names the values sat in (structured input only). */
  fields?: string[];
  /** Where in a container tree the unit was, e.g. "zip[1]/report.xlsx/sheet1". */
  unitPath?: string;
}

/** What a detector implementation sees. Text is decoded; bytes only for binary detectors. */
export interface DetectInput {
  text?: string;
  bytes?: Uint8Array;
  format: string;               // ContentFormat-ish, sniffed by the extractor
  input: ContentInput;          // text | table | structured | image | code | metadata
  filename?: string;
  contentType?: string;
  /** Structured view when available (table rows, JSON object) so column names can be reported. */
  table?: { headers: string[]; rows: string[][] };
  json?: unknown;
  metadata?: Record<string, string>;
  unitPath?: string;
}

export interface DetectorImpl {
  descriptor: DetectorDescriptor;
  /** True when the detector can run here and now (config present, model loaded…). */
  available(): { ok: boolean; reason?: string };
  detect(input: DetectInput): Finding[];
}

/** Availability as reported by a runtime, for the capability system. */
export interface DetectorAvailability {
  id: string;
  version: string;
  available: boolean;
  reason?: string;
  emits: Array<{ type: string; confidence: Confidence }>;
}

export class DetectorRegistry {
  private descriptors = new Map<string, DetectorDescriptor>();
  constructor(seed: DetectorDescriptor[] = []) { for (const d of seed) this.register(d); }
  register(d: DetectorDescriptor): void { this.descriptors.set(d.id, d); }
  unregister(id: string): void { this.descriptors.delete(id); }
  get(id: string): DetectorDescriptor | undefined { return this.descriptors.get(id); }
  all(): DetectorDescriptor[] { return [...this.descriptors.values()]; }

  /** Detectors declared for a type (prefix semantics: a detector for PII.CONTACT covers PII.CONTACT.EMAIL and vice versa). */
  forType(typeId: string): DetectorDescriptor[] {
    return this.all().filter((d) => d.emits.some((e) => covers(e.type, typeId)));
  }
}

/** A detector emitting `emitted` covers a clause naming `wanted` if either is within the other. */
export function covers(emitted: string, wanted: string): boolean {
  return emitted === wanted || emitted.startsWith(wanted + ".") || wanted.startsWith(emitted + ".");
}

/**
 * Built-in descriptors. `available` is decided by the runtime; listing here
 * only says the detector EXISTS in the product. Versions are bumped when the
 * rule corpus or model changes, and travel into evidence.
 */
export const BUILTIN_DETECTORS: DetectorDescriptor[] = [
  { id: "wrapbox.pattern.pii", version: "2.0.0", family: "pattern", label: "Pattern PII (email, phone, national ids, cards)", locality: "device", cost: "cheap", inputs: ["text", "table", "structured", "code"],
    emits: [{ type: "PII.CONTACT.EMAIL", confidence: "high" }, { type: "PII.CONTACT.PHONE", confidence: "medium" }, { type: "GOV_ID.IN.AADHAAR", confidence: "medium" }, { type: "GOV_ID.US.SSN", confidence: "medium" }, { type: "PCI.PAN", confidence: "high" }, { type: "PII.ONLINE.IP_ADDRESS", confidence: "high" }, { type: "FINANCIAL.ACCOUNT.IBAN", confidence: "high" }, { type: "FINANCIAL.ACCOUNT.US_ABA", confidence: "medium" }, { type: "PII.IDENTITY.DOB", confidence: "low" }, { type: "PII.BULK", confidence: "high" }] },
  { id: "wrapbox.secrets", version: "2.0.0", family: "secret", label: "Credentials and secrets (provider rules + entropy + keys)", locality: "device", cost: "cheap", inputs: ["text", "table", "structured", "code"],
    emits: [{ type: "CREDENTIAL", confidence: "high" }], provenance: { source: "gitleaks/gitleaks config/gitleaks.toml + Wrapbox rules", license: "MIT" } },
  { id: "wrapbox.credential_file", version: "1.1.0", family: "pattern", label: "Credential files by name", locality: "device", cost: "cheap", inputs: ["metadata"],
    emits: [{ type: "CREDENTIAL.CREDENTIAL_FILE", confidence: "high" }] },
  { id: "wrapbox.code.treesitter", version: "1.0.0", family: "code", label: "Source code (syntax-aware)", locality: "device", cost: "moderate", inputs: ["text", "code"],
    emits: [{ type: "SOURCE_CODE", confidence: "high" }, { type: "SOURCE_CODE.IAC", confidence: "medium" }, { type: "SOURCE_CODE.BUILD_CONFIG", confidence: "medium" }], provenance: { source: "tree-sitter + tree-sitter-wasms", license: "MIT" } },
  { id: "wrapbox.code.heuristic", version: "1.1.0", family: "code", label: "Source code (heuristic fallback)", locality: "device", cost: "cheap", inputs: ["text", "code"],
    emits: [{ type: "SOURCE_CODE", confidence: "medium" }] },
  { id: "wrapbox.financial", version: "1.1.0", family: "semantic", label: "Financial data (multi-signal)", locality: "device", cost: "cheap", inputs: ["text", "table"], emits: [{ type: "FINANCIAL", confidence: "medium" }, { type: "FINANCIAL.STATEMENT", confidence: "medium" }] },
  { id: "wrapbox.phi", version: "1.1.0", family: "semantic", label: "Protected health information (multi-signal)", locality: "device", cost: "cheap", inputs: ["text", "table"], emits: [{ type: "PHI", confidence: "medium" }, { type: "PHI.ICD10", confidence: "high" }, { type: "PHI.CPT", confidence: "medium" }, { type: "PHI.NPI", confidence: "medium" }, { type: "PHI.MRN", confidence: "medium" }] },
  { id: "wrapbox.legal", version: "1.1.0", family: "semantic", label: "Legal documents (multi-signal)", locality: "device", cost: "cheap", inputs: ["text"], emits: [{ type: "LEGAL", confidence: "medium" }, { type: "LEGAL.PRIVILEGED", confidence: "high" }, { type: "LEGAL.CONTRACT", confidence: "medium" }] },
  { id: "wrapbox.confidential", version: "1.1.0", family: "context", label: "Confidentiality markings", locality: "device", cost: "cheap", inputs: ["text"], emits: [{ type: "COMPANY_IP.CONFIDENTIAL_MARKING", confidence: "high" }] },
  { id: "wrapbox.label.mip", version: "1.0.0", family: "label", label: "Microsoft Purview / MIP sensitivity labels", locality: "device", cost: "cheap", inputs: ["metadata"], emits: [{ type: "LABEL.MIP", confidence: "high" }], tenantConfig: "labels.mip" },
  { id: "wrapbox.edm", version: "1.0.0", family: "edm", label: "Exact Data Match (tenant hashed index)", locality: "device", cost: "cheap", inputs: ["text", "table", "structured"], emits: [{ type: "CUSTOM", confidence: "high" }, { type: "HR.EMPLOYEE_ID", confidence: "high" }, { type: "CUSTOMER.ID", confidence: "high" }, { type: "PHI.MRN", confidence: "high" }, { type: "CUSTOMER.NAME", confidence: "high" }, { type: "COMPANY_IP.CODENAME", confidence: "high" }], tenantConfig: "edm.index" },
  { id: "wrapbox.dictionary", version: "1.0.0", family: "dictionary", label: "Tenant dictionaries", locality: "device", cost: "cheap", inputs: ["text", "table", "structured"], emits: [{ type: "CUSTOM", confidence: "medium" }, { type: "COMPANY_IP.CODENAME", confidence: "medium" }], tenantConfig: "dictionaries" },
  { id: "wrapbox.regex.custom", version: "1.0.0", family: "regex_custom", label: "Tenant regex identifiers", locality: "device", cost: "cheap", inputs: ["text", "table", "structured", "code"], emits: [{ type: "CUSTOM", confidence: "medium" }], tenantConfig: "regex" },
  { id: "wrapbox.fingerprint", version: "1.0.0", family: "fingerprint", label: "Document fingerprints (template hashes)", locality: "device", cost: "cheap", inputs: ["text"], emits: [{ type: "COMPANY_IP", confidence: "high" }, { type: "LEGAL.CONTRACT", confidence: "high" }, { type: "CUSTOM", confidence: "high" }], tenantConfig: "fingerprints" },
  { id: "wrapbox.semantic.onnx", version: "1.0.0", family: "semantic", label: "Local semantic classifier (ONNX)", locality: "device", cost: "heavy", inputs: ["text"], emits: [{ type: "SEMANTIC", confidence: "medium" }], tenantConfig: "models.semantic" },
  { id: "wrapbox.ner.presidio", version: "1.0.0", family: "ner", label: "Named-entity PII (Presidio service)", locality: "tenant_service", cost: "heavy", inputs: ["text"], emits: [{ type: "PII.CONTACT.NAME", confidence: "medium" }, { type: "PII.CONTACT.ADDRESS", confidence: "medium" }, { type: "PHI.DIAGNOSIS", confidence: "medium" }, { type: "PHI.MEDICATION", confidence: "medium" }], tenantConfig: "services.presidio", provenance: { source: "data-privacy-stack/presidio", license: "MIT" } },
  { id: "wrapbox.ocr.vision", version: "1.0.0", family: "ocr", label: "On-device OCR (Apple Vision)", locality: "device", cost: "moderate", inputs: ["image"], emits: [] },
];

let defaultDetectors: DetectorRegistry | null = null;
export function detectorRegistry(): DetectorRegistry {
  if (!defaultDetectors) defaultDetectors = new DetectorRegistry(BUILTIN_DETECTORS);
  return defaultDetectors;
}
export function setDetectorRegistry(r: DetectorRegistry | null): void { defaultDetectors = r; }
