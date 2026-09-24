/**
 * Transform Registry — detection and transformation are different capabilities.
 *
 * A data type can be detectable but not safely transformable (a credential is
 * never tokenised and forwarded; a legal-privilege document cannot be "masked").
 * Coverage derivation asks THIS registry, not the family name, whether a
 * CONSTRAIN clause can actually run — and the runtime registers which handlers
 * it implements for which content formats, so "declared" and "available" are
 * never confused.
 */
import { dataTypes, TRANSFORM_IDS } from "./datatypes.js";
export const TRANSFORM_HANDLERS = {
    REDACT: { id: "REDACT", label: "Redact", reversible: false, formatPreserving: false, formats: ["text", "csv", "tsv", "json"], params: ["replacement"], legacyKind: "redact" },
    MASK: { id: "MASK", label: "Mask (keep last N)", reversible: false, formatPreserving: true, formats: ["text", "csv", "tsv", "json"], params: ["keepLast", "maskChar"] },
    REVERSIBLE_TOKENIZE: { id: "REVERSIBLE_TOKENIZE", label: "Reversible tokenize", reversible: true, formatPreserving: false, formats: ["text", "csv", "tsv", "json"], params: [], legacyKind: "reversible_tokenize" },
    HASH: { id: "HASH", label: "Hash (HMAC)", reversible: false, formatPreserving: false, formats: ["text", "csv", "tsv", "json"], params: ["algorithm"] },
    DROP_FIELD: { id: "DROP_FIELD", label: "Drop field / column", reversible: false, formatPreserving: false, formats: ["csv", "tsv", "json"], params: ["fields"] },
    GENERALIZE: { id: "GENERALIZE", label: "Generalize (bucket)", reversible: false, formatPreserving: true, formats: ["csv", "tsv", "json"], params: ["buckets"] },
    DATE_SHIFT: { id: "DATE_SHIFT", label: "Date shift", reversible: true, formatPreserving: true, formats: ["csv", "tsv", "json", "text"], params: ["maxDays"] },
    FORMAT_PRESERVING: { id: "FORMAT_PRESERVING", label: "Format-preserving encryption (FF1)", reversible: true, formatPreserving: true, formats: ["csv", "tsv", "json", "text"], params: ["tweak"] },
    LIMIT: { id: "LIMIT", label: "Limit (rows / lines / bytes)", reversible: false, formatPreserving: true, formats: ["text", "csv", "tsv", "json", "code"], params: ["maxRows", "maxLines", "maxBytes"] },
    REWRITE: { id: "REWRITE", label: "Rewrite (template)", reversible: false, formatPreserving: false, formats: ["text", "json"], params: ["template"] },
};
/** Whether a (type, handler) pair is declared safe in the Data Type Registry. */
export function supportFor(typeId, handler) {
    return dataTypes().transformSupport(typeId, handler);
}
/** Handlers declared supported for a type. */
export function supportedHandlers(typeId) {
    return TRANSFORM_IDS.filter((h) => supportFor(typeId, h) === "supported");
}
/** True iff SOME handler is declared safe for the type — "transformable at all". */
export function isTransformable(typeId) {
    return supportedHandlers(typeId).length > 0;
}
/** Map an old `data.transform` mode onto a registry handler. */
export function handlerFromLegacyMode(mode) {
    const m = String(mode ?? "").toLowerCase();
    if (m.startsWith("redact"))
        return "REDACT";
    if (m.startsWith("mask"))
        return "MASK";
    if (m.startsWith("hash"))
        return "HASH";
    if (m.startsWith("drop"))
        return "DROP_FIELD";
    if (m.startsWith("limit") || m.startsWith("cap"))
        return "LIMIT";
    return "REVERSIBLE_TOKENIZE";
}
export function canExecute(av, handler, typeId, format) {
    const reg = dataTypes();
    return av.some((a) => a.handler === handler
        && (!format || a.formats.includes(format))
        && a.types.some((p) => reg.isWithin(typeId, p) || p === "*"));
}
