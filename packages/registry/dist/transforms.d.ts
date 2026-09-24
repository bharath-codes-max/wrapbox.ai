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
import { type TransformId, type TransformSupport } from "./datatypes.js";
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
export declare const TRANSFORM_HANDLERS: Record<TransformId, TransformHandler>;
/** Whether a (type, handler) pair is declared safe in the Data Type Registry. */
export declare function supportFor(typeId: string, handler: TransformId): TransformSupport;
/** Handlers declared supported for a type. */
export declare function supportedHandlers(typeId: string): TransformId[];
/** True iff SOME handler is declared safe for the type — "transformable at all". */
export declare function isTransformable(typeId: string): boolean;
/** Map an old `data.transform` mode onto a registry handler. */
export declare function handlerFromLegacyMode(mode: unknown): TransformId;
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
export declare function canExecute(av: TransformAvailability[], handler: TransformId, typeId: string, format?: ContentFormat): boolean;
