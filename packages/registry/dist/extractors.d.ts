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
    limits: {
        maxBytes: number;
        maxDepth: number;
        timeoutMs: number;
        maxDecompressedBytes?: number;
        maxEntries?: number;
    };
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
    table?: {
        headers: string[];
        rows: string[][];
    };
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
export type ExtractionResult = {
    ok: true;
    units: ContentUnit[];
    extractor: string;
} | {
    ok: false;
    uninspectable: Uninspectable;
    extractor: string;
};
export interface ExtractorAvailability {
    id: string;
    version: string;
    available: boolean;
    reason?: string;
    formats: string[];
    canTransform: boolean;
}
export declare const BUILTIN_EXTRACTORS: ExtractorDescriptor[];
export declare class ExtractorRegistry {
    private map;
    constructor(seed?: ExtractorDescriptor[]);
    register(e: ExtractorDescriptor): void;
    all(): ExtractorDescriptor[];
    get(id: string): ExtractorDescriptor | undefined;
    forFormat(format: string): ExtractorDescriptor[];
}
export declare function extractorRegistry(): ExtractorRegistry;
