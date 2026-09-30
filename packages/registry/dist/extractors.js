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
export const BUILTIN_EXTRACTORS = [
    { id: "wrapbox.tier0", version: "2.0.0", tier: "in_process", label: "In-process text/JSON/CSV/YAML/XML/HTML/multipart/OOXML", formats: ["text", "json", "csv", "tsv", "yaml", "xml", "html", "multipart", "docx", "xlsx"], canTransform: true,
        limits: { maxBytes: 64 * 1024 * 1024, maxDepth: 2, timeoutMs: 5000, maxDecompressedBytes: 96 * 1024 * 1024, maxEntries: 1024 }, local: true },
    { id: "wrapbox.tika", version: "1.0.0", tier: "sidecar", label: "Apache Tika 4 sidecar (isolated)", formats: ["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "rtf", "odt", "ods", "odp", "eml", "msg", "zip", "tar", "gz", "7z", "rar", "epub", "image"], canTransform: false,
        limits: { maxBytes: 64 * 1024 * 1024, maxDepth: 5, timeoutMs: 30000, maxDecompressedBytes: 256 * 1024 * 1024, maxEntries: 2000 }, local: true, tenantConfig: "extractors.tika.url" },
    { id: "wrapbox.ocr.vision", version: "1.0.0", tier: "device_helper", label: "Apple Vision OCR helper", formats: ["image", "pdf-scanned"], canTransform: false,
        limits: { maxBytes: 32 * 1024 * 1024, maxDepth: 1, timeoutMs: 20000 }, local: true, tenantConfig: "extractors.ocr.helper" },
];
export class ExtractorRegistry {
    map = new Map();
    constructor(seed = BUILTIN_EXTRACTORS) { for (const e of seed)
        this.map.set(e.id, e); }
    register(e) { this.map.set(e.id, e); }
    all() { return [...this.map.values()]; }
    get(id) { return this.map.get(id); }
    forFormat(format) { return this.all().filter((e) => e.formats.includes(format)); }
}
let defaultExtractors = null;
export function extractorRegistry() {
    if (!defaultExtractors)
        defaultExtractors = new ExtractorRegistry();
    return defaultExtractors;
}
