/**
 * Capability coverage — the mechanical answer to "is this clause enforced?"
 *
 * A clause DECLARES requirements (derived from its IR, never hand-written per
 * concept); a runtime DECLARES what it has AVAILABLE right now (its
 * self-description, `wrapboxd capabilities`); this module intersects the two
 * and yields one of ENFORCED / DEGRADED / UNDERSTOOD_ONLY / PENDING plus the
 * exact unmet requirements. Nothing here has a per-type branch.
 *
 * The security invariants live in `checkActivation`:
 *   I1  no protected clause may be silently unenforced: a protection whose
 *       status is not enforced/degraded must carry a resolved `onUnsupported`
 *       (hold_activation blocks the contract; block/review compile a carrier
 *       rule; accept_risk needs an identity + reason and is written into
 *       evidence).
 *   I2  no clause may be reported ENFORCED with any required parser, detector,
 *       transformer, destination resolver or transport unavailable.
 *   I3  a content requirement is met only by a detector that emits the type
 *       at ≥ the clause's minConfidence AND emits counts.
 */
import { type DetectorAvailability } from "./detectors.js";
import type { ExtractorAvailability } from "./extractors.js";
import { type TransformAvailability } from "./transforms.js";
import { type DestinationClass } from "./destinations.js";
import type { ClauseIR, PolicyIR } from "./ir.js";
export type CoverageStatus = "enforced" | "degraded" | "understood_only" | "pending";
export type Facet = "destination" | "data" | "transform" | "review" | "identity" | "transport" | "parse" | "resource";
export interface Requirement {
    capability: string;
    facet: Facet;
    purpose: string;
    /** Unmet ⇒ DEGRADED (enforced on what is observed) rather than UNDERSTOOD_ONLY. */
    softenable: boolean;
}
/** What a deployed network runtime reports about itself. */
export interface RuntimeSnapshot {
    plane: "network";
    deployed: boolean;
    detectors: DetectorAvailability[];
    extractors: ExtractorAvailability[];
    transforms: TransformAvailability[];
    /** Fields populated on every evaluated request. */
    observes: string[];
    identity: Array<{
        capability: string;
        proven: boolean;
    }>;
    transport: {
        /** TCP ports the plane captures (the NE routes 443 only). */
        ports: number[];
        /** Whether plain HTTP is observed. */
        plaintextHttp: boolean;
        /** How WebSocket upgrades are handled. */
        websocket: "inspected" | "fail_closed" | "bypassed";
        /** Destination classes the runtime never decrypts (host-level decision only). */
        neverDecrypt: DestinationClass[];
    };
    registryVersions: {
        dataTypes: string;
        destinations: string;
        detectors: string;
        transforms: string;
        extractors: string;
    };
}
/** Formats a network clause's resource may arrive in. Uploads may be anything;
 *  a plain endpoint call is text/JSON. Kept small and honest. */
export declare function formatsFor(clause: ClauseIR): string[];
export declare function requirements(clause: ClauseIR): Requirement[];
export interface CoverageVerdict {
    status: CoverageStatus;
    met: Requirement[];
    unmet: Array<{
        req: Requirement;
        reason: string;
    }>;
    /** Human notes (never-decrypt classes in scope, ports not observed, …). */
    notes: string[];
    /** Types the clause names that no available detector covers. */
    unobservableTypes: string[];
    /** Types the clause wants transformed that no available handler covers. */
    untransformableTypes: string[];
}
export declare function coverage(clause: ClauseIR, rt: RuntimeSnapshot | null): CoverageVerdict;
export interface ActivationReport {
    ok: boolean;
    blockers: Array<{
        clauseId: string;
        code: string;
        message: string;
    }>;
    warnings: Array<{
        clauseId: string;
        message: string;
    }>;
    perClause: Record<string, CoverageVerdict>;
}
/** The activation invariant (I1/I2). Pure; the caller decides what to do with the report. */
export declare function checkActivation(ir: PolicyIR, rt: RuntimeSnapshot | null): ActivationReport;
