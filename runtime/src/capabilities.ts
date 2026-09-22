/**
 * Runtime capability self-description (§7).
 *
 * The runtime is the SOURCE OF TRUTH for what it can observe, classify, parse,
 * transform and prove. This module assembles that truth from the real modules —
 * not a hand-kept list — and emits it in one stable shape:
 *
 *   { plane, observes, classifiers, parsers, handlers, identitySignals }
 *
 * The control plane / compiler consume this to decide enforcement status. If a
 * detector or parser is added or removed, this description changes with it, and
 * a drift-guard test fails until the compiler's mirror is regenerated to match —
 * so the compiler can never claim a capability the deployed runtime lacks.
 *
 * `wrapboxd capabilities` prints this JSON; that is the artifact the CP ingests.
 */

import { RUNTIME_CONTENT_KINDS } from "./classify.js";
import { classDetectors } from "./classifiers.js";
import { allParsers } from "./parsers.js";
import { gatewayObserves, GATEWAY_HANDLERS } from "./gateway.js";

export interface ClassifierInfo {
  id: string;
  family: string;
  /** Coarse deterministic detector, or a multi-signal framework detector. */
  method: "deterministic" | "multi-signal";
  local: boolean;
  emitsConfidence: boolean;
}

export interface ParserInfo {
  id: string;
  formats: string[];
  mimeTypes: string[];
  canInspect: boolean;
  canTransform: boolean;
  maxBytes: number;
}

export interface IdentitySignal {
  capability: string;
  proven: boolean;
  source: string;
  /** Present when proven is false — what would be required to prove it. */
  requires?: string;
}

export interface RuntimeDescriptor {
  plane: "network" | "gateway" | "endpoint";
  deployed: boolean;
  observes: string[];
  classifiers: ClassifierInfo[];
  parsers: ParserInfo[];
  handlers: string[];
  identitySignals: IdentitySignal[];
  /** A one-line honest note about what "deployed" means for this plane. */
  note?: string;
}

/** Fields the deployed network plane populates on every evaluated request. */
export const NETWORK_OBSERVES = [
  "tool_name",
  "tool_input.host", "tool_input.port", "tool_input.path", "tool_input.method",
  "tool_input.content_kinds", "tool_input.findings", "tool_input.filenames",
  "tool_input.bytes", "tool_input.has_file_upload", "tool_input.agent",
  "tool_input.device_id", "tool_input.uninspected",
];

/** The transform handlers the network runtime actually executes today. */
export const NETWORK_HANDLERS = ["data.transform"];

function classifierInfos(): ClassifierInfo[] {
  const base: ClassifierInfo[] = ["secret", "source_code", "pii", "credential_file"].map((f) => ({
    id: `wrapbox.deterministic.${f}`, family: f, method: "deterministic", local: true, emitsConfidence: false,
  }));
  const extended: ClassifierInfo[] = classDetectors().map((d) => ({
    id: d.id, family: d.family, method: "multi-signal", local: d.local, emitsConfidence: true,
  }));
  return [...base, ...extended];
}

function parserInfos(): ParserInfo[] {
  return allParsers().map((p) => ({
    id: p.id, formats: p.formats, mimeTypes: p.mimeTypes,
    canInspect: p.canInspect, canTransform: p.canTransform, maxBytes: p.maxBytes,
  }));
}

/** Identity signals the runtime can and cannot prove today (§5, blocker A). */
export function identitySignals(): IdentitySignal[] {
  return [
    { capability: "identity.device", proven: true, source: "device enrollment key (per-request, verifiable)" },
    { capability: "identity.workload", proven: true, source: "enrolled daemon process" },
    { capability: "identity.user", proven: false, source: "not proven", requires: "enterprise IdP (Entra/Okta) — external blocker A" },
    { capability: "identity.group", proven: false, source: "not proven", requires: "enterprise IdP / directory group sync — external blocker A" },
  ];
}

/** The network plane's real, deployed capabilities. */
export function describeNetwork(): RuntimeDescriptor {
  return {
    plane: "network",
    deployed: true,
    observes: NETWORK_OBSERVES,
    classifiers: classifierInfos(),
    parsers: parserInfos(),
    handlers: NETWORK_HANDLERS,
    identitySignals: identitySignals(),
    note: "TLS-terminating device proxy — live.",
  };
}

/** The gateway plane foundation: logic implemented and tested, but NOT receiving
 *  live brokered traffic (that needs a broker transport; real DB/cloud brokers
 *  need vendor credentials — external blocker D). Reported deployed:false so no
 *  gateway clause is ever called enforced on traffic nothing is brokering. */
export function describeGateway(): RuntimeDescriptor {
  return {
    plane: "gateway",
    deployed: false,
    observes: gatewayObserves(),
    classifiers: [],
    parsers: [],
    handlers: [...GATEWAY_HANDLERS],
    identitySignals: [
      { capability: "identity.workload", proven: true, source: "enrolled daemon process" },
      { capability: "identity.user", proven: false, source: "not proven", requires: "enterprise IdP — external blocker A" },
    ],
    note: "Evaluator + handlers implemented and tested; no live broker transport yet (external blocker D for DB/cloud).",
  };
}

export function describeRuntime(): RuntimeDescriptor[] {
  return [describeNetwork(), describeGateway()];
}

/** The single content vocabulary the runtime emits — the value a drift-guard
 *  test compares the compiler's mirror against. */
export function contentVocabulary(): string[] {
  return [...RUNTIME_CONTENT_KINDS];
}
