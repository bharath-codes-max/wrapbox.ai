/**
 * Evidence v2 — what a decision must be able to prove, offline, later.
 *
 * These fields ride inside the signed receipt (additively; v1 fields stay).
 * Values are NEVER recorded: types, counts, confidences, detector versions,
 * unit paths and registry pins are enough to re-derive the decision from the
 * pinned registries and the rule that matched.
 */
export {};
