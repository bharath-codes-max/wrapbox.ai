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

import { dataTypes, type TransformId, TRANSFORM_IDS, type TransformSupport } from "./datatypes.js";

export type ContentFormat = "text" | "csv" | "tsv" | "json" | "yaml" | "xml" | "html" | "multipart" | "docx" | "xlsx" | "pdf" | "image" | "code";

export interface TransformHandler {
  id: TransformId;
  label: string;
  /** Can the original value be recovered (with the vault)? */
  reversible: boolean;
  /** Does the output keep the input's shape/length (for downstream parsers)? */
  formatPreserving: boolean;
  /** Content formats this handler can rewrite in place. */
  formats: ContentFormat[];
  /** Parameters the handler understands (for the authoring UI and IR validation). */
  params: string[];
  /** The legacy wire `constraint.kind` this handler lowers to, if any. */
  legacyKind?: "reversible_tokenize" | "redact";
}

export const TRANSFORM_HANDLERS: Record<TransformId, TransformHandler> = {
  REDACT:              { id: "REDACT", label: "Redact", reversible: false, formatPreserving: false, formats: ["text", "csv", "tsv", "json"], params: ["replacement"], legacyKind: "redact" },
  MASK:                { id: "MASK", label: "Mask (keep last N)", reversible: false, formatPreserving: true, formats: ["text", "csv", "tsv", "json"], params: ["keepLast", "maskChar"] },
  REVERSIBLE_TOKENIZE: { id: "REVERSIBLE_TOKENIZE", label: "Reversible tokenize", reversible: true, formatPreserving: false, formats: ["text", "csv", "tsv", "json"], params: [], legacyKind: "reversible_tokenize" },
  HASH:                { id: "HASH", label: "Hash (HMAC)", reversible: false, formatPreserving: false, formats: ["text", "csv", "tsv", "json"], params: ["algorithm"] },
  DROP_FIELD:          { id: "DROP_FIELD", label: "Drop field / column", reversible: false, formatPreserving: false, formats: ["csv", "tsv", "json"], params: ["fields"] },
  GENERALIZE:          { id: "GENERALIZE", label: "Generalize (bucket)", reversible: false, formatPreserving: true, formats: ["csv", "tsv", "json"], params: ["buckets"] },
  DATE_SHIFT:          { id: "DATE_SHIFT", label: "Date shift", reversible: true, formatPreserving: true, formats: ["csv", "tsv", "json", "text"], params: ["maxDays"] },
  FORMAT_PRESERVING:   { id: "FORMAT_PRESERVING", label: "Format-preserving encryption (FF1)", reversible: true, formatPreserving: true, formats: ["csv", "tsv", "json", "text"], params: ["tweak"] },
  LIMIT:               { id: "LIMIT", label: "Limit (rows / lines / bytes)", reversible: false, formatPreserving: true, formats: ["text", "csv", "tsv", "json", "code"], params: ["maxRows", "maxLines", "maxBytes"] },
  REWRITE:             { id: "REWRITE", label: "Rewrite (template)", reversible: false, formatPreserving: false, formats: ["text", "json"], params: ["template"] },
};

/** Whether a (type, handler) pair is declared safe in the Data Type Registry. */
export function supportFor(typeId: string, handler: TransformId): TransformSupport {
  return dataTypes().transformSupport(typeId, handler);
}

/** Handlers declared supported for a type. */
export function supportedHandlers(typeId: string): TransformId[] {
  return TRANSFORM_IDS.filter((h) => supportFor(typeId, h) === "supported");
}

/** True iff SOME handler is declared safe for the type — "transformable at all". */
export function isTransformable(typeId: string): boolean {
  return supportedHandlers(typeId).length > 0;
}

/** Map an old `data.transform` mode onto a registry handler. */
export function handlerFromLegacyMode(mode: unknown): TransformId {
  const m = String(mode ?? "").toLowerCase();
  if (m.startsWith("redact")) return "REDACT";
  if (m.startsWith("mask")) return "MASK";
  if (m.startsWith("hash")) return "HASH";
  if (m.startsWith("drop")) return "DROP_FIELD";
  if (m.startsWith("limit") || m.startsWith("cap")) return "LIMIT";
  return "REVERSIBLE_TOKENIZE";
}

/**
 * A runtime's declaration of what it can execute: handler × format pairs it
 * has actually implemented. The capability system intersects this with the
 * registry's per-type support to decide whether a CONSTRAIN is ENFORCED.
 */
export interface TransformAvailability {
  handler: TransformId;
  formats: ContentFormat[];
  /** Data types the implementation can locate values for (prefixes allowed). */
  types: string[];
}

export function canExecute(av: TransformAvailability[], handler: TransformId, typeId: string, format?: ContentFormat): boolean {
  const reg = dataTypes();
  return av.some((a) => a.handler === handler
    && (!format || a.formats.includes(format))
    && a.types.some((p) => reg.isWithin(typeId, p) || p === "*"));
}
