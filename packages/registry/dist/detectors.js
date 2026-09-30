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
export class DetectorRegistry {
    descriptors = new Map();
    constructor(seed = []) { for (const d of seed)
        this.register(d); }
    register(d) { this.descriptors.set(d.id, d); }
    unregister(id) { this.descriptors.delete(id); }
    get(id) { return this.descriptors.get(id); }
    all() { return [...this.descriptors.values()]; }
    /** Detectors declared for a type (prefix semantics: a detector for PII.CONTACT covers PII.CONTACT.EMAIL and vice versa). */
    forType(typeId) {
        return this.all().filter((d) => d.emits.some((e) => covers(e.type, typeId)));
    }
}
/** A detector emitting `emitted` covers a clause naming `wanted` if either is within the other. */
export function covers(emitted, wanted) {
    return emitted === wanted || emitted.startsWith(wanted + ".") || wanted.startsWith(emitted + ".");
}
/**
 * Built-in descriptors. `available` is decided by the runtime; listing here
 * only says the detector EXISTS in the product. Versions are bumped when the
 * rule corpus or model changes, and travel into evidence.
 */
export const BUILTIN_DETECTORS = [
    { id: "wrapbox.pattern.pii", version: "2.0.0", family: "pattern", label: "Pattern PII (email, phone, national ids, cards)", locality: "device", cost: "cheap", inputs: ["text", "table", "structured", "code"],
        emits: [{ type: "PII.CONTACT.EMAIL", confidence: "high" }, { type: "PII.CONTACT.PHONE", confidence: "medium" }, { type: "GOV_ID.IN.AADHAAR", confidence: "medium" }, { type: "GOV_ID.US.SSN", confidence: "medium" }, { type: "PCI.PAN", confidence: "high" }, { type: "PII.ONLINE.IP_ADDRESS", confidence: "high" }, { type: "FINANCIAL.ACCOUNT.IBAN", confidence: "high" }, { type: "FINANCIAL.ACCOUNT.US_ABA", confidence: "medium" }, { type: "PII.IDENTITY.DOB", confidence: "low" }, { type: "PII.BULK", confidence: "high" }] },
    { id: "wrapbox.secrets", version: "2.0.0", family: "secret", label: "Credentials and secrets (provider rules + entropy + keys)", locality: "device", cost: "cheap", inputs: ["text", "table", "structured", "code"],
        emits: [{ type: "CREDENTIAL", confidence: "high" }], provenance: { source: "gitleaks/gitleaks config/gitleaks.toml + Wrapbox rules", license: "MIT" } },
    { id: "wrapbox.credential_file", version: "1.1.0", family: "pattern", label: "Credential files by name", locality: "device", cost: "cheap", inputs: ["metadata"],
        emits: [{ type: "CREDENTIAL.CREDENTIAL_FILE", confidence: "high" }] },
    { id: "wrapbox.code.treesitter", version: "1.0.0", family: "code", label: "Source code (syntax-aware)", locality: "device", cost: "moderate", inputs: ["text", "code"],
        emits: [{ type: "SOURCE_CODE", confidence: "high" }, { type: "SOURCE_CODE.IAC", confidence: "medium" }, { type: "CONFIG.BUILD", confidence: "medium" }, { type: "CONFIG.APP", confidence: "medium" }], provenance: { source: "tree-sitter + tree-sitter-wasms", license: "MIT" } },
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
let defaultDetectors = null;
export function detectorRegistry() {
    if (!defaultDetectors)
        defaultDetectors = new DetectorRegistry(BUILTIN_DETECTORS);
    return defaultDetectors;
}
export function setDetectorRegistry(r) { defaultDetectors = r; }
