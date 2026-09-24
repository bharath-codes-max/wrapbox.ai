/**
 * Evidence v2 — what a decision must be able to prove, offline, later.
 *
 * These fields ride inside the signed receipt (additively; v1 fields stay).
 * Values are NEVER recorded: types, counts, confidences, detector versions,
 * unit paths and registry pins are enough to re-derive the decision from the
 * pinned registries and the rule that matched.
 */

import type { Confidence } from "./datatypes.js";
import type { DestinationClass } from "./destinations.js";
import type { CoverageStatus } from "./capabilities.js";

export interface EvidenceFinding { type: string; count: number; confidence: Confidence; detector: string; version: string; label?: string; unitPath?: string; fields?: string[] }

export interface EvidenceV2 {
  ev: 2;
  contract_id?: string;
  clause_id?: string;
  rule_kind?: "clause" | "carrier";
  /** Canonical data types found (registry ids). */
  types: string[];
  findings: EvidenceFinding[];
  extractor?: string;
  inspection: "inspected" | "host_only" | "uninspectable";
  uninspectable_state?: string;
  destination_class: DestinationClass | "UNCLASSIFIED";
  service?: string;
  transform?: { handler: string; protected: Array<{ type: string; count: number }>; fields: string[] };
  plane: "network" | "gateway" | "endpoint";
  final_action: "allow" | "constrain" | "review" | "block";
  capability_status?: CoverageStatus;
  /** Why a fail-closed action happened, when it did. */
  fail_closed?: { cause: "uninspectable" | "unsupported_transform" | "no_rule" | "carrier_rule" | "review_failed" | "no_constraint"; detail: string };
  pins: { dataTypes: string; destinations: string; detectors: string; transforms: string; extractors: string };
}
