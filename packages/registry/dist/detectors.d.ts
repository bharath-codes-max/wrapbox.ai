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
export type DetectorFamily = "pattern" | "checksum" | "context" | "ner" | "secret" | "edm" | "regex_custom" | "dictionary" | "fingerprint" | "code" | "ocr" | "semantic" | "label" | "tenant";
export interface DetectorDescriptor {
    id: string;
    version: string;
    family: DetectorFamily;
    label: string;
    /** Registry types (or prefixes) this detector can emit, with the best confidence it reaches. */
    emits: Array<{
        type: string;
        confidence: Confidence;
    }>;
    inputs: ContentInput[];
    locality: Locality;
    cost: "cheap" | "moderate" | "heavy";
    /** Tenant configuration key that must exist before the detector is usable. */
    tenantConfig?: string;
    /** Provenance of the rule corpus (for evidence and licensing). */
    provenance?: {
        source: string;
        license: string;
        ref?: string;
    };
}
/** One recognised occurrence class inside a content unit. NEVER carries the value. */
export interface Finding {
    type: string;
    count: number;
    confidence: Confidence;
    detector: string;
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
    format: string;
    input: ContentInput;
    filename?: string;
    contentType?: string;
    /** Structured view when available (table rows, JSON object) so column names can be reported. */
    table?: {
        headers: string[];
        rows: string[][];
    };
    json?: unknown;
    metadata?: Record<string, string>;
    unitPath?: string;
}
export interface DetectorImpl {
    descriptor: DetectorDescriptor;
    /** True when the detector can run here and now (config present, model loaded…). */
    available(): {
        ok: boolean;
        reason?: string;
    };
    detect(input: DetectInput): Finding[];
}
/** Availability as reported by a runtime, for the capability system. */
export interface DetectorAvailability {
    id: string;
    version: string;
    available: boolean;
    reason?: string;
    emits: Array<{
        type: string;
        confidence: Confidence;
    }>;
}
export declare class DetectorRegistry {
    private descriptors;
    constructor(seed?: DetectorDescriptor[]);
    register(d: DetectorDescriptor): void;
    unregister(id: string): void;
    get(id: string): DetectorDescriptor | undefined;
    all(): DetectorDescriptor[];
    /** Detectors declared for a type (prefix semantics: a detector for PII.CONTACT covers PII.CONTACT.EMAIL and vice versa). */
    forType(typeId: string): DetectorDescriptor[];
}
/** A detector emitting `emitted` covers a clause naming `wanted` if either is within the other. */
export declare function covers(emitted: string, wanted: string): boolean;
/**
 * Built-in descriptors. `available` is decided by the runtime; listing here
 * only says the detector EXISTS in the product. Versions are bumped when the
 * rule corpus or model changes, and travel into evidence.
 */
export declare const BUILTIN_DETECTORS: DetectorDescriptor[];
export declare function detectorRegistry(): DetectorRegistry;
export declare function setDetectorRegistry(r: DetectorRegistry | null): void;
