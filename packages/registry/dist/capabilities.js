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
import { dataTypes, CONFIDENCE_RANK } from "./datatypes.js";
import { detectorRegistry, covers } from "./detectors.js";
import { canExecute } from "./transforms.js";
import { expandClass } from "./destinations.js";
/** Formats a network clause's resource may arrive in. Uploads may be anything;
 *  a plain endpoint call is text/JSON. Kept small and honest. */
export function formatsFor(clause) {
    const globs = clause.resource.paths?.include ?? [];
    const exts = globs.map((g) => (g.split(".").pop() ?? "").toLowerCase().replace(/\*+$/, "")).filter(Boolean);
    const wanted = new Set(["text", "json", "multipart"]);
    for (const e of exts) {
        if (["doc", "docx"].includes(e))
            wanted.add("docx");
        else if (["xls", "xlsx"].includes(e))
            wanted.add("xlsx");
        else if (["ppt", "pptx"].includes(e))
            wanted.add("pptx");
        else if (e === "pdf")
            wanted.add("pdf");
        else if (["csv"].includes(e))
            wanted.add("csv");
        else if (["tsv"].includes(e))
            wanted.add("tsv");
        else if (["html", "htm"].includes(e))
            wanted.add("html");
        else if (["yaml", "yml"].includes(e))
            wanted.add("yaml");
        else if (["xml"].includes(e))
            wanted.add("xml");
        else if (["zip", "tar", "gz", "7z", "rar"].includes(e))
            wanted.add("zip");
        else if (["png", "jpg", "jpeg", "gif", "tiff", "bmp", "heic"].includes(e))
            wanted.add("image");
        else if (["eml", "msg"].includes(e))
            wanted.add("eml");
    }
    // Content protections cover any carrier the user might upload: the common
    // office formats are required so a renamed spreadsheet cannot slip past.
    if (clause.data?.length && clause.decision !== "ALLOW") {
        wanted.add("csv");
        wanted.add("docx");
        wanted.add("xlsx");
        wanted.add("pdf");
    }
    return [...wanted];
}
export function requirements(clause) {
    const reqs = [];
    const R = (capability, facet, purpose, softenable = false) => reqs.push({ capability, facet, purpose, softenable });
    // Identity — proven subjects only; a device-only runtime enforces "employees" on the whole device (DEGRADED).
    if (clause.subject.kind !== "any")
        R(`identity.${clause.subject.kind}`, "identity", `verify the subject (${clause.subject.kind})`, true);
    // Destination.
    const d = clause.destination;
    if (d) {
        if (d.classes?.length || d.notIn?.classes?.length)
            R("destination.class", "destination", "classify the destination host");
        if (d.hosts?.length || d.services?.length || d.groups?.length || d.notIn?.hosts?.length || d.notIn?.services?.length || d.notIn?.groups?.length)
            R("destination.host", "destination", "observe the destination host");
        if (d.unresolved?.length)
            R(`destination.unresolved`, "destination", `resolve “${d.unresolved.join(", ")}” to addresses`, true);
        if (d.trust && !d.classes?.length && !d.hosts?.length && !d.services?.length && !d.groups?.length && !d.notIn)
            R("destination.class", "destination", `classify the destination as ${d.trust}`);
    }
    // Data — each type needs a detector at the clause's confidence, emitting counts.
    for (const ref of clause.data ?? []) {
        R(`content.${ref.type}@${ref.match.minConfidence}`, "data", `recognise ${ref.type} (≥${ref.match.minCount}, ${ref.match.minConfidence} confidence)`);
        if (ref.owner)
            R(`provenance.${ref.owner}`, "data", `prove the data belongs to ${ref.owner}`, true);
    }
    // Parse — every format the resource may arrive in must have an available extractor.
    if (clause.data?.length)
        for (const f of formatsFor(clause))
            R(`parse.${f}`, "parse", `read ${f} content`, f !== "text" && f !== "json" && f !== "multipart");
    // Transform — CONSTRAIN must be executable for each targeted type.
    if (clause.decision === "CONSTRAIN") {
        const ts = clause.transforms ?? [];
        if (!ts.length)
            R("transform.none", "transform", "a CONSTRAIN names no transform");
        for (const t of ts) {
            const targets = t.targets === "matched" ? (clause.data ?? []).map((r) => r.type) : (t.targets.types ?? (clause.data ?? []).map((r) => r.type));
            if (!targets.length && t.targets !== "matched" && t.targets.fields?.length)
                R(`transform.${t.handler}.fields`, "transform", `apply ${t.handler} to named fields`);
            for (const ty of targets)
                R(`transform.${t.handler}.${ty}`, "transform", `apply ${t.handler} to ${ty}`);
        }
    }
    if (clause.decision === "REVIEW")
        R("review.hold", "review", "hold the request until a human decides");
    // Authored predicates need their fields observed.
    for (const p of clause.conditions?.requires ?? [])
        R(`observe.${p.field}`, "resource", `evaluate ${p.field}`);
    // Transport: a network protection is only as complete as the transports observed.
    if (clause.decision !== "ALLOW")
        R("transport.observed", "transport", "the request must traverse a path Wrapbox controls", true);
    return reqs;
}
export function coverage(clause, rt) {
    const reqs = requirements(clause);
    const met = [];
    const unmet = [];
    const notes = [];
    const unobservableTypes = [];
    const untransformableTypes = [];
    const reg = dataTypes();
    const detReg = detectorRegistry();
    if (!rt || !rt.deployed) {
        return { status: "understood_only", met: [], unmet: reqs.map((req) => ({ req, reason: "no deployed plane" })), notes: ["no runtime is deployed for this plane"], unobservableTypes: (clause.data ?? []).map((r) => r.type), untransformableTypes: [] };
    }
    const availDet = rt.detectors.filter((d) => d.available);
    const availExt = rt.extractors.filter((e) => e.available);
    const observes = new Set(rt.observes);
    const identity = new Map(rt.identity.map((i) => [i.capability, i.proven]));
    for (const req of reqs) {
        const [head, ...rest] = req.capability.split(".");
        let ok = false;
        let reason = "";
        if (head === "identity") {
            ok = identity.get(req.capability) === true;
            reason = ok ? "" : "no trusted identity on this plane";
        }
        else if (head === "destination") {
            if (req.capability === "destination.class") {
                ok = observes.has("tool_input.destination_class");
                reason = ok ? "" : "runtime does not classify destinations";
            }
            else if (req.capability === "destination.host") {
                ok = observes.has("tool_input.host");
                reason = ok ? "" : "runtime does not observe the host";
            }
            else {
                ok = false;
                reason = req.purpose;
            }
        }
        else if (head === "content") {
            const [typeWithConf] = [rest.join(".")];
            const [type, conf] = typeWithConf.split("@");
            const known = reg.has(type) || reg.lineage(type).some((a) => reg.has(a));
            if (!known || type.startsWith("CUSTOM.") && !reg.has(type)) {
                ok = false;
                reason = `“${type}” is not a registered data type — register it (tenant type) before it can be enforced`;
            }
            else {
                const detectors = availDet.filter((d) => d.emits.some((e) => covers(e.type, type) && CONFIDENCE_RANK[e.confidence] >= CONFIDENCE_RANK[conf]));
                ok = detectors.length > 0;
                if (!ok) {
                    const declared = detReg.forType(type);
                    reason = declared.length
                        ? `no AVAILABLE detector emits ${type} at ${conf} confidence (declared: ${declared.map((d) => d.id).join(", ")})`
                        : `no detector exists for ${type}`;
                    unobservableTypes.push(type);
                }
            }
        }
        else if (head === "provenance") {
            ok = availDet.some((d) => d.id === "wrapbox.edm" || d.id === "wrapbox.label.mip");
            reason = ok ? "" : "no provenance detector (EDM index or label map) is configured";
        }
        else if (head === "parse") {
            const f = rest.join(".");
            ok = availExt.some((e) => e.formats.includes(f));
            reason = ok ? "" : `no available extractor reads ${f} — such uploads fail closed`;
        }
        else if (head === "transform") {
            if (req.capability === "transform.none") {
                ok = false;
                reason = "CONSTRAIN names no transform";
            }
            else {
                const handler = rest[0];
                const target = rest.slice(1).join(".");
                if (target === "fields") {
                    ok = rt.transforms.some((t) => t.handler === handler);
                    reason = ok ? "" : `runtime cannot execute ${handler}`;
                }
                else {
                    const support = reg.transformSupport(target, handler);
                    if (support !== "supported") {
                        ok = false;
                        reason = `${handler} is ${support === "unsafe" ? "declared unsafe" : "not applicable"} for ${target} — the runtime will block rather than forward`;
                        untransformableTypes.push(target);
                    }
                    else {
                        ok = canExecute(rt.transforms, handler, target);
                        if (!ok) {
                            reason = `runtime does not implement ${handler} for ${target}`;
                            untransformableTypes.push(target);
                        }
                    }
                }
            }
        }
        else if (head === "review") {
            ok = true;
        }
        else if (head === "observe") {
            ok = observes.has(rest.join("."));
            reason = ok ? "" : `runtime does not observe ${rest.join(".")}`;
        }
        else if (head === "transport") {
            ok = true;
            if (!rt.transport.ports.includes(443)) {
                ok = false;
                reason = "HTTPS is not captured";
            }
            if (!rt.transport.plaintextHttp)
                notes.push("plain HTTP (port 80) is not observed by this plane");
            if (rt.transport.ports.length && !rt.transport.ports.includes(8443))
                notes.push(`only TCP ports ${rt.transport.ports.join(", ")} are captured; HTTPS on other ports is not observed`);
            if (rt.transport.websocket === "bypassed") {
                ok = false;
                reason = "WebSocket upgrades bypass inspection";
            }
            // Never-decrypt classes inside the clause's destination scope.
            const classesInScope = new Set();
            for (const c of clause.destination?.classes ?? [])
                for (const x of expandClass(c))
                    classesInScope.add(x);
            if (!clause.destination)
                for (const x of ["APPROVED_AI", "KNOWN_AI_UNAPPROVED", "APPROVED_SAAS", "PARTNER", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL", "INTERNAL", "PERSONAL_EXEMPT", "INFRA_EXEMPT"])
                    classesInScope.add(x);
            const nd = rt.transport.neverDecrypt.filter((c) => classesInScope.has(c));
            if (nd.length)
                notes.push(`destinations classed ${nd.join(", ")} are never decrypted (host-level decision only) — edit the exemption list to change this`);
        }
        else {
            ok = false;
            reason = `unknown capability ${req.capability}`;
        }
        if (ok)
            met.push(req);
        else
            unmet.push({ req, reason });
    }
    // Status. A hard unmet requirement on a PINNING facet (data/destination/transform/parse) means the clause
    // cannot be enforced as written; softenable ones (identity, provenance, optional formats) degrade it.
    const hard = unmet.filter((u) => !u.req.softenable);
    let status;
    if (hard.some((u) => u.req.capability.startsWith("content.") && u.reason.includes("not a registered data type")))
        status = "pending";
    else if (hard.length)
        status = "understood_only";
    else if (unmet.length)
        status = "degraded";
    else
        status = "enforced";
    // A protection over data must have SOMETHING observable to pin on, else it can never fire.
    if (status === "enforced" && clause.data?.length && unobservableTypes.length === (clause.data?.length ?? 0))
        status = "understood_only";
    return { status, met, unmet, notes, unobservableTypes, untransformableTypes };
}
/** The activation invariant (I1/I2). Pure; the caller decides what to do with the report. */
export function checkActivation(ir, rt) {
    const blockers = [];
    const warnings = [];
    const perClause = {};
    const hasCatchAllAllow = ir.clauses.some((c) => c.catchAll && c.decision === "ALLOW");
    for (const c of ir.clauses) {
        const v = coverage(c, rt);
        perClause[c.id] = v;
        const protection = c.decision !== "ALLOW";
        if (c.decision === "REVIEW" && !(c.review?.approvers?.length)) {
            blockers.push({ clauseId: c.id, code: "review_needs_approver", message: "Configuration required — this REVIEW clause needs an approver before the contract can go live." });
        }
        if (protection && (v.status === "understood_only" || v.status === "pending")) {
            const why = v.unmet.map((u) => u.reason).join("; ");
            if (c.onUnsupported === "hold_activation") {
                blockers.push({ clauseId: c.id, code: "protection_unenforceable", message: `“${c.source.text.slice(0, 80)}” cannot be enforced (${why}). Choose what should happen: block the carrier, require review, or accept the risk with a reason.` });
            }
            else if (c.onUnsupported === "accept_risk") {
                if (!c.acceptRisk?.by || !c.acceptRisk?.reason)
                    blockers.push({ clauseId: c.id, code: "accept_risk_unsigned", message: "accept_risk requires an identity and a reason; both are recorded in evidence." });
                else
                    warnings.push({ clauseId: c.id, message: `risk accepted by ${c.acceptRisk.by}: ${c.acceptRisk.reason} (${why})` });
            }
            else {
                warnings.push({ clauseId: c.id, message: `unenforceable as written (${why}); compiled as ${c.onUnsupported.toUpperCase()} on the carrier (uploads and uninspectable bodies) to its destination scope` });
            }
            if (hasCatchAllAllow && c.onUnsupported === "hold_activation") {
                // Already a blocker; the note makes the failure mode explicit.
                warnings.push({ clauseId: c.id, message: "with a catch-all ALLOW present, activating without resolving this clause would let the protected data through silently" });
            }
        }
        if (protection && v.status === "degraded")
            warnings.push({ clauseId: c.id, message: `enforced on what Wrapbox observes; gaps: ${v.unmet.map((u) => u.reason).concat(v.notes).join("; ")}` });
    }
    return { ok: blockers.length === 0, blockers, warnings, perClause };
}
