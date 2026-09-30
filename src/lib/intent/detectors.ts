/**
 * Detector availability, as the compiler sees it.
 *
 * The descriptors live in @wrapbox/registry; whether each is AVAILABLE on the
 * deployed device comes from the runtime snapshot (snapshot.ts). This module
 * answers one question for the capability system: "which registry TYPES can a
 * detector that is actually running emit, and at what confidence?" Nothing
 * here is a list of classes — the registry owns the vocabulary.
 */

import { CONFIDENCE_RANK, covers, dataTypes, detectorRegistry, type Confidence, type DetectorDescriptor } from "@wrapbox/registry";
import { runtimeSnapshot } from "./snapshot";

export interface Emitted { type: string; confidence: Confidence; detector: string }

/** Every (type, confidence) an AVAILABLE detector emits. */
export function availableEmissions(): Emitted[] {
  const out: Emitted[] = [];
  for (const d of runtimeSnapshot().detectors) {
    if (!d.available) continue;
    for (const e of d.emits) out.push({ type: e.type, confidence: e.confidence, detector: d.id });
  }
  return out;
}

/** Types (registry ids) observable right now — any type covered by an available emission. */
export function detectableFamilies(): Set<string> {
  const out = new Set<string>();
  for (const e of availableEmissions()) out.add(e.type);
  return out;
}

/** Can some available detector produce `type` at ≥ `minConfidence`? */
export function isObservable(type: string, minConfidence: Confidence = "low"): boolean {
  return availableEmissions().some((e) => covers(e.type, type) && CONFIDENCE_RANK[e.confidence] >= CONFIDENCE_RANK[minConfidence]);
}

/** Descriptors declared for a type — available or not (for honest "declared but not deployed" messages). */
export function detectorsForClass(type: string): DetectorDescriptor[] {
  return detectorRegistry().forType(type);
}

/**
 * Split a clause's classes into what the deployed runtime can observe and what it
 * cannot. Input classes are registry ids (the validator resolves phrases);
 * a class no available detector covers is returned as unobservable — never
 * mapped to something adjacent.
 */
export function observableKinds(classes: string[], minConfidence: Confidence = "low"): { types: string[]; kinds: string[]; unobservable: string[] } {
  const reg = dataTypes();
  const types: string[] = [];
  const kinds = new Set<string>();
  const unobservable: string[] = [];
  for (const c of classes) {
    if (isObservable(c, minConfidence)) { types.push(c); const k = reg.legacyKind(c); if (k) kinds.add(k); }
    else unobservable.push(c);
  }
  return { types, kinds: [...kinds], unobservable };
}
