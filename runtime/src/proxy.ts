/**
 * Universal network gate — a local HTTP proxy on 127.0.0.1.
 *
 * Reached two ways. Wrapped agents get HTTP_PROXY/HTTPS_PROXY from the shim;
 * everything else on the machine — a browser opened from the Dock, an IDE, a
 * desktop app — arrives because `sysproxy` pointed the OS proxy here. The
 * second path is what makes this browser-independent: no per-browser
 * integration, and no requirement that Wrapbox launched the program.
 *
 * TWO LEVELS OF ENFORCEMENT, chosen per host:
 *
 *   proxy  — hostname only. The CONNECT target is judged, then raw bytes are
 *            tunnelled. Used for hosts we decline to decrypt (an employee's
 *            bank) and when inspection is switched off.
 *
 *   mitm   — TLS is terminated here, the body is buffered, classified and
 *            judged BEFORE any upstream connection exists. This is what sees
 *            prompt text and file uploads. See mitm.ts.
 *
 * Both write a signed receipt through the same evaluator the hook uses.
 */

import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { loadConfig, PATHS, type Config } from "./config.js";
import { loadCachedRules, evaluate, applyProjectFilter, type ToolCall, type Rule, type CachedRule } from "./policy.js";
import { makeReceipt, appendToSpool } from "./receipts.js";
import { interceptTls, shouldInspect, closeMitm, type EgressRequest, type EgressVerdict } from "./mitm.js";
import { caExists } from "./ca.js";
import { describeClassification, RUNTIME_CONTENT_KINDS, RUNTIME_FINDING_LABELS } from "./classify.js";
import { tenantDestinations } from "./tenant.js";
import { dataTypes, registryPins, type EvidenceV2, type DestinationClass } from "@wrapbox/registry";
import { describeTransform, type TransformReport } from "./transform.js";
import { identifyClient, identifyService, isSignificant, isNoisePath } from "./identify.js";
import { openApproval, readApproval } from "./api.js";

export const DEFAULT_PROXY_PORT = Number(process.env.WRAPBOX_PROXY_PORT || 4180);

// Known model API hosts — baked in so the daemon can raise the "unknown
// process reached a model API" alarm even when no rule mentions them.
export const MODEL_API_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.cohere.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.perplexity.ai",
  "api.deepseek.com",
  "api.x.ai",
  "api.fireworks.ai",
]);

interface ProxySession {
  agent: string;
  session: string;
  registeredAt: number;
}

const SESSION_FILE = () => path.join(PATHS.home, "proxy-session.json");

/**
 * Prototype attribution: `wrapboxd run --agent X --net proxy` writes a session
 * record here on start and removes it on exit. The proxy stamps concurrent
 * connections with that agent. Production would peer-lookup by socket (via
 * netstat/lsof) — noted as a known limitation.
 */
export function writeProxySession(agent: string, session: string): void {
  fs.mkdirSync(PATHS.home, { recursive: true });
  fs.writeFileSync(SESSION_FILE(), JSON.stringify({ agent, session, registeredAt: Date.now() }));
}
export function clearProxySession(): void {
  try { fs.unlinkSync(SESSION_FILE()); } catch { /* nothing to clear */ }
}
function readProxySession(): ProxySession | null {
  try {
    const raw = fs.readFileSync(SESSION_FILE(), "utf-8");
    const s = JSON.parse(raw);
    if (!s || typeof s.agent !== "string") return null;
    // stale after 6 hours
    if (Date.now() - (s.registeredAt || 0) > 6 * 3600_000) return null;
    return s as ProxySession;
  } catch { return null; }
}

interface Decision {
  effect: "allow" | "block";
  reason: string;
  rule_id: string | null;
  degraded: boolean;
  pulled_at: string | null;
  matchedRule?: Rule | null;
}

/**
 * @param deferModelApiGuard  True when this flow is about to be TLS-inspected.
 *   The unknown-process → model-API guard exists because, with only a hostname
 *   to go on, an unattributed process reaching a model provider is the most
 *   suspicious thing we can see. Once we can read the body that reasoning no
 *   longer applies: a browser opened from the Dock is ALWAYS an unattributed
 *   process, and blocking it at CONNECT would mean never inspecting any
 *   browser traffic — the exact case this product exists to govern. So when
 *   inspection is available, the guard stands down and the content decides.
 */
function decide(host: string, port: number, agent: string, deferModelApiGuard = false): Decision {
  const cached = loadCachedRules();
  if (!cached) {
    return {
      effect: "block",
      reason: "No cached ruleset — proxy failing closed",
      rule_id: null,
      degraded: true,
      pulled_at: null,
    };
  }
  const rules = applyProjectFilter(cached.rules, undefined);
  const dest = tenantDestinations().classify(host);
  const call: ToolCall = {
    tool_name: "network.connect",
    tool_input: {
      host, port, agent,
      // The destination CLASS is known before any byte is decrypted, so a
      // class-scoped rule ("nothing to KNOWN_AI_UNAPPROVED") fires here too.
      destination_class: dest.class, ...(dest.service ? { service: dest.service } : {}),
      inspection: "host_only", carrier: "connect",
    },
  };
  const r = evaluate(call, rules);
  const matched = r.matched_rule_id ? cached.rules.find((x) => x.id === r.matched_rule_id) : undefined;
  const isModelApi = MODEL_API_HOSTS.has(host);
  const unknownProc = agent === "unknown";

  // Special alarm: an unattributed process reaching a model API. Only an
  // EXPLICIT rule — one whose condition actually targets host/tool_input —
  // counts as authorisation. A catch-all allow (no condition, or a condition
  // that doesn't mention the host field) leaves the model-API guard in force
  // and the connection is blocked with the loud reason. This is the whole
  // point of the guard: default-allow policies must not silently open every
  // model provider to unattributed local processes.
  if (isModelApi && unknownProc && !deferModelApiGuard) {
    if (r.effect === "allow" && matched && ruleTargetsHost(matched)) {
      return { effect: "allow", reason: matched.name || r.reason, rule_id: matched.id, degraded: !cached.fresh, pulled_at: cached.pulled_at };
    }
    // If a rule DID block this call, preserve its name in the reason — the
    // rule and the guard both fired; the operator wants to see both.
    const guard = "unknown-process → model-API";
    const reason = r.effect === "block" && matched
      ? `${matched.name} — ${guard}`
      : guard;
    return { effect: "block", reason, rule_id: matched?.id ?? null, degraded: !cached.fresh, pulled_at: cached.pulled_at };
  }
  return {
    effect: r.effect === "allow" ? "allow" : "block",
    reason: matched?.name || r.reason,
    rule_id: matched?.id ?? null,
    degraded: !cached.fresh,
    pulled_at: cached.pulled_at,
  };
}

/**
 * Is this rule specific enough to authorise a model-API host? True only when
 * its condition explicitly names the host field — a catch-all with no
 * condition, or one that only filters e.g. tool_name, is not.
 */
function ruleTargetsHost(rule: { condition: unknown }): boolean {
  const c = rule.condition;
  if (!c) return false;
  const parts: unknown[] = Array.isArray(c) ? c : [c];
  return parts.some((p) => {
    if (!p || typeof p !== "object") return false;
    const field = (p as Record<string, unknown>).field;
    return typeof field === "string" && (field === "tool_input.host" || field.endsWith(".host"));
  });
}

function writeReceipt(cfg: Config, host: string, port: number, agent: string, session: string, d: Decision, enforcement: "proxy") {
  // Never record loopback: 127.0.0.1 / localhost / ::1 / .local are how the
  // daemon reaches its OWN Control Plane and how a dev tests locally. Writing
  // receipts for them fills the trail with noise about the security tool
  // talking to itself, which reads as "3 pages of unknown → localhost:4100"
  // and buries the actual decisions.
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return;
  try {
    // Attribute what we can from the hostname alone. Connect receipts fire
    // before the TLS handshake, so there is no User-Agent to read the client
    // from — but the destination is enough to render a Claude / ChatGPT icon
    // instead of the generic terminal one, which is what a reader needs.
    const service = identifyService(host);
    const receipt = makeReceipt(cfg, {
      agent,
      session,
      tool_name: "network.connect",
      tool_input: { host, port },
      target: `${host}:${port}`,
      effect: d.effect,
      reason: d.reason,
      rule_id: d.rule_id,
      ruleset_pulled_at: d.pulled_at,
      enforcement,
      degraded: d.degraded,
      ...(service.id ? { service: service.id, service_label: service.label } : {}),
    });
    appendToSpool(receipt);
  } catch (err) {
    console.error(`proxy: failed to write receipt: ${(err as Error).message}`);
  }
}

/**
 * The pure egress judgement — the exact code the daemon runs, exported so the
 * coverage matrix tests it with no socket in the way.
 *
 * The facts handed to the engine are ABOUT the content, never the content:
 * typed findings with counts and confidence, the destination CLASS the
 * registry resolved for this host, the carrier (body / upload / uninspectable)
 * and, for compatibility, the coarse kinds and labels older rules match on.
 *
 * FAIL-CLOSED INSPECTION GATE (§4): a body we could not fully read is judged
 * as if it held every registry type in bulk at high confidence on an
 * uninspectable carrier. If any protection would fire for this destination,
 * the request is blocked; if none could, allowing it is consistent with
 * policy and an unreadable body is not punished needlessly.
 */
export function judgeEgress(
  allRules: CachedRule[],
  r: Pick<EgressRequest, "host" | "port" | "method" | "path" | "classification">,
  agent: string,
  destinationRegistry = tenantDestinations(),
  deviceId?: string,
): { call: ToolCall; decision: ReturnType<typeof evaluate>; matched: CachedRule | undefined; failClosed: boolean; dest: ReturnType<typeof destinationRegistry.classify> } {
  const rules = applyProjectFilter(allRules, undefined);
  const dest = destinationRegistry.classify(r.host, r.path);
  const c2 = r.classification;
  const carrier = c2.inspection !== "inspected" ? "uninspectable" : c2.hasFileUpload ? "upload" : "body";
  const call: ToolCall = {
    tool_name: "network.egress",
    tool_input: {
      host: r.host,
      port: r.port,
      method: r.method,
      path: r.path,
      agent,
      ...(deviceId ? { device_id: deviceId } : {}),
      // ── v2: what registry-driven rules match on ──
      destination_class: dest.class, ...(dest.service ? { service: dest.service } : {}),
      findings_v2: c2.typed.map((f) => ({ type: f.type, count: f.count, confidence: f.confidence })),
      finding_types: c2.types,
      inspection: c2.inspection, ...(c2.state ? { uninspectable_state: c2.state } : {}),
      carrier,
      extractor: c2.extractor,
      // ── v1 (kept for older rules) ──
      content_kinds: c2.kinds,
      findings: c2.findings.map((f) => f.label),
      filenames: c2.filenames,
      bytes: c2.bytes,
      has_file_upload: c2.hasFileUpload,
      uninspected: !c2.inspectable,
    },
  };

  let d = evaluate(call, rules);
  let matched = d.matched_rule_id ? allRules.find((x) => x.id === d.matched_rule_id) : undefined;
  let failClosed = false;
  if (!c2.inspectable) {
    const worst = evaluate(
      { ...call, tool_input: { ...call.tool_input, content_kinds: RUNTIME_CONTENT_KINDS, findings: RUNTIME_FINDING_LABELS, has_file_upload: true,
        findings_v2: [...dataTypes().ids().map((t) => ({ type: t, count: 1_000_000, confidence: "high" })), ...c2.typed.map((f) => ({ type: f.type, count: f.count, confidence: f.confidence }))],
        finding_types: dataTypes().ids(), carrier: "uninspectable" } },
      rules,
    );
    if (worst.effect === "block" || worst.effect === "review" || worst.effect === "constrain") {
      failClosed = true;
      d = { ...worst, effect: "block" };
      matched = worst.matched_rule_id ? allRules.find((x) => x.id === worst.matched_rule_id) : undefined;
    }
  }
  return { call, decision: d, matched, failClosed, dest };
}

/**
 * Content-level decision, taken once TLS has been terminated and the whole
 * body is in hand — but before any upstream connection exists.
 *
 * The facts handed to the engine are deliberately ABOUT the content rather
 * than the content itself: kinds, finding labels, filenames, byte count. A
 * rule therefore reads "content_kinds contains secret", which is true of a
 * service we have integrated and equally true of one that launched this
 * morning. It also keeps the secret out of the receipt.
 */
function decideEgress(
  cfg: Config,
  r: EgressRequest,
  agent: string,
  session: string,
  recordAll = false,
): EgressVerdict {
  const cached = loadCachedRules();
  if (!cached) {
    const v: EgressVerdict = {
      effect: "block",
      reason: "No cached ruleset — proxy failing closed",
      rule_id: null,
      degraded: true,
      pulled_at: null,
    };
    writeEgressReceipt(cfg, r, agent, session, v);
    return v;
  }

  const { call, decision: d, matched, failClosed, dest } = judgeEgress(cached.rules, r, agent, tenantDestinations(), cfg.device_id);
  void call;

  const detected = describeClassification(r.classification);
  const baseReason = failClosed
    ? `cannot inspect ${r.classification.format} content (${r.classification.inspectReason ?? "unreadable format"}) and a protection could apply — failing closed`
    : (matched?.name || d.reason);
  const withFindings = r.classification.findings.length ? `${baseReason} — ${detected}` : baseReason;
  // Surface a degraded rule's coverage note so Evidence states the known
  // bypass alongside what was enforced — never letting a partial-coverage
  // enforcement read as complete.
  const note = (matched as { coverageNote?: string | null } | undefined)?.coverageNote;
  const reason = note ? `${withFindings} · ${note}` : withFindings;

  const v: EgressVerdict = {
    // Every effect the engine can return travels through intact. An unknown
    // one falls to block, which is the fail-closed default — but allow,
    // constrain and review each reach the enforcement path that implements
    // them. Collapsing constrain here is what would turn a masking rule into
    // a silent block (or worse, a silent allow) without anyone noticing.
    effect: d.effect === "allow" ? "allow"
      : d.effect === "review" ? "review"
      : d.effect === "constrain" ? "constrain"
      : "block",
    // CONSTRAIN needs to know WHAT to protect. Carried from the matched rule;
    // mitm refuses to forward if it is missing.
    ...(d.effect === "constrain" ? { constraint: d.constraint ?? null } : {}),
    reason: r.uninspected ? `${baseReason} — payload too large to inspect` : reason,
    rule_id: matched?.id ?? null,
    degraded: !cached.fresh,
    pulled_at: cached.pulled_at,
    evidence: buildEvidence(r, dest.class, dest.service, matched, d.effect, failClosed, r.classification.inspectable ? undefined : worstCauseOf(r)),
  };

  // Attribution for the evidence trail — never an input to the decision above.
  const client = identifyClient(r.headers["user-agent"] as string | undefined);
  const service = identifyService(r.host);

  // Background chatter is counted, not recorded. Writing a signed receipt for
  // every telemetry ping buries the handful of decisions a human needs to see.
  const worthRecording = isSignificant({
    effect: v.effect,
    contentKinds: r.classification.kinds,
    hasFileUpload: r.classification.hasFileUpload,
    service,
    bytes: r.classification.bytes,
    method: r.method,
    recordAll,
  }) && !(v.effect === "allow" && isNoisePath(r.path));

  // A CONSTRAIN receipt has to say WHAT was protected, and that is only known
  // once the transform has run. Writing it here would produce an unqualified
  // "constrain" with no fields — indistinguishable from a rule that matched
  // but masked nothing. So the write is deferred to onTransform, and the
  // caller supplies the report.
  if (v.effect === "constrain") {
    pendingConstrain = worthRecording ? { r, agent, session, v, client, service } : null;
    return v;
  }

  if (!worthRecording) {
    skipped++;
  } else if (shouldRecordAgain(`e|${r.host}|${r.method}|${v.effect}|${v.reason}|${r.classification.kinds.join(",")}`)) {
    writeEgressReceipt(cfg, r, agent, session, v, client, service);
  }

  return v;
}

/**
 * Collapse repeated identical decisions.
 *
 * During a misconfiguration — a contract with no catch-all ALLOW, say — every
 * connection on the machine is refused, and a browser retries hard. That wrote
 * hundreds of byte-identical "blocked claude.ai:443" receipts in seconds,
 * burying everything else and making the trail useless exactly when someone
 * needs to read it.
 *
 * So the same host + effect + reason inside the window is counted, not
 * re-recorded. The first one is always written, and the suppressed count is
 * reported — the event is never hidden, only de-duplicated.
 */
const DEDUPE_WINDOW_MS = 60_000;
const lastSeen = new Map<string, number>();
let suppressed = 0;

function shouldRecordAgain(key: string): boolean {
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev !== undefined && now - prev < DEDUPE_WINDOW_MS) {
    suppressed++;
    return false;
  }
  lastSeen.set(key, now);
  // Keep the map from growing without bound on a long-running daemon.
  if (lastSeen.size > 2000) {
    for (const [k, t] of lastSeen) if (now - t > DEDUPE_WINDOW_MS) lastSeen.delete(k);
  }
  return true;
}

export function takeSuppressedCount(): number {
  const n = suppressed;
  suppressed = 0;
  return n;
}

/** Routine allows we chose not to record, reported by the daemon periodically. */
let skipped = 0;
export function takeSkippedCount(): number {
  const n = skipped;
  skipped = 0;
  return n;
}

/**
 * Hold a request while a human answers in the dashboard.
 *
 * Polls rather than holds a socket open to the Control Plane, so a restart of
 * either side cannot strand the request. Every failure path denies: an
 * unreachable control plane, an expired window and a rejection all mean the
 * bytes do not leave.
 */
async function awaitApproval(
  cfg: Config,
  r: EgressRequest,
  v: EgressVerdict,
  client: { id: string; label: string },
  service: { id: string; label: string; ai: boolean },
): Promise<{ ok: boolean; reason: string }> {
  const detected = describeClassification(r.classification);
  let opened: { id: string; expires_in_ms: number };
  try {
    opened = await openApproval(cfg, {
      org_id: cfg.org_id,
      rule_id: v.rule_id,
      rule_name: v.reason,
      summary: `${client.label} → ${service.label || r.host}: ${r.method} ${r.path.slice(0, 80)}`,
      destination: r.host,
      method: r.method,
      path: r.path.slice(0, 300),
      client_label: client.label,
      service_label: service.label || r.host,
      content_kinds: r.classification.kinds,
      findings: r.classification.findings.map((f) => f.label),
      bytes: r.classification.bytes,
    });
  } catch (err) {
    return { ok: false, reason: `${v.reason} — could not reach an approver (${(err as Error).message})` };
  }

  console.log(`review: holding ${r.method} ${r.host}${r.path.slice(0, 60)} — ${detected} — waiting for a human`);

  const deadline = Date.now() + Math.min(opened.expires_in_ms, 120_000);
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 1500));
    try {
      const a = await readApproval(cfg, opened.id);
      if (a.state === "approved") {
        console.log(`review: APPROVED by ${a.decided_by ?? "admin"} — forwarding`);
        return { ok: true, reason: `approved by ${a.decided_by ?? "admin"}` };
      }
      if (a.state === "rejected") {
        console.log(`review: REJECTED by ${a.decided_by ?? "admin"}`);
        return { ok: false, reason: `${v.reason} — rejected by ${a.decided_by ?? "admin"}` };
      }
      if (a.state === "expired") break;
    } catch {
      // Keep polling; a transient failure is not an answer either way.
    }
  }
  console.log("review: no answer in time — denied");
  return { ok: false, reason: `${v.reason} — nobody approved it in time` };
}

/**
 * The constrain receipt waiting for its transform report.
 *
 * Safe as a single slot because mitm calls decide() and then onTransform()
 * synchronously inside one request handler — nothing can interleave between
 * them. It is cleared on consumption so a transform that never happens cannot
 * attach its report to a later request.
 */
let pendingConstrain: {
  r: EgressRequest; agent: string; session: string; v: EgressVerdict;
  client?: { id: string; label: string }; service?: { id: string; label: string; ai: boolean };
} | null = null;

/** Called by mitm once a CONSTRAIN transform has run. */
function recordConstrain(cfg: Config, report: TransformReport): void {
  const p = pendingConstrain;
  pendingConstrain = null;
  if (!p) return;
  if (!shouldRecordAgain(`c|${p.r.host}|${p.r.method}|${p.v.reason}|${report.fields.join(",")}`)) return;
  writeEgressReceipt(cfg, p.r, p.agent, p.session, p.v, p.client, p.service, report);
}

/** Evidence v2 for one egress decision. Values never appear here. */
function buildEvidence(
  r: EgressRequest, destClass: DestinationClass, service: string | undefined,
  matched: (Rule & { meta?: unknown; clause_id?: string | null; contract_id?: string | null; description?: string | null }) | undefined,
  effect: EgressVerdict["effect"], failClosed: boolean, failCause?: EvidenceV2["fail_closed"],
): EvidenceV2 {
  const c = r.classification;
  const meta = (matched as { meta?: { clause_id?: string; contract_id?: string; kind?: "clause" | "carrier"; coverage?: EvidenceV2["capability_status"] } } | undefined)?.meta;
  return {
    ev: 2,
    ...(meta?.contract_id ? { contract_id: meta.contract_id } : {}),
    ...(meta?.clause_id ? { clause_id: meta.clause_id } : {}),
    ...(meta?.kind ? { rule_kind: meta.kind } : {}),
    types: c.types,
    findings: c.typed.map((f) => ({ type: f.type, count: f.count, confidence: f.confidence, detector: f.detector, version: f.version, ...(f.label ? { label: f.label } : {}), ...(f.unitPath ? { unitPath: f.unitPath } : {}), ...(f.fields?.length ? { fields: f.fields } : {}) })),
    extractor: c.extractor,
    inspection: c.inspection,
    ...(c.state ? { uninspectable_state: c.state } : {}),
    destination_class: destClass,
    ...(service ? { service } : {}),
    plane: "network",
    final_action: effect,
    ...(meta?.coverage ? { capability_status: meta.coverage } : {}),
    ...(failClosed && failCause ? { fail_closed: failCause } : {}),
    ...(meta?.kind === "carrier" ? { fail_closed: { cause: "carrier_rule", detail: (matched?.description ?? "unenforceable clause — carrier rule") } } : {}),
    pins: registryPins(),
  };
}

function worstCauseOf(r: EgressRequest): EvidenceV2["fail_closed"] {
  return { cause: "uninspectable", detail: `${r.classification.state ?? "UNKNOWN"}: ${r.classification.inspectReason ?? "body could not be inspected"} — a protection could apply here, so it was not forwarded` };
}

function writeEgressReceipt(
  cfg: Config,
  r: EgressRequest,
  agent: string,
  session: string,
  v: EgressVerdict,
  client?: { id: string; label: string },
  service?: { id: string; label: string; ai: boolean },
  transform?: TransformReport,
): void {
  try {
    const receipt = makeReceipt(cfg, {
      agent,
      session,
      tool_name: "network.egress",
      tool_input: {
        host: r.host,
        port: r.port,
        method: r.method,
        path: r.path,
        content_kinds: r.classification.kinds,
        findings: r.classification.findings.map((f) => f.label),
        filenames: r.classification.filenames,
        bytes: r.classification.bytes,
        // What the CONSTRAIN transform actually protected. Field NAMES and
        // COUNTS only — putting the protected values in the evidence trail
        // would defeat the entire point of masking them.
        ...(transform ? {
          protected_fields: transform.fields,
          protected_counts: transform.protected.map((x) => `${x.kind.toLowerCase()}:${x.count}`),
          protected_total: transform.total,
          ...(transform.lookalikes ? { neutralised_tokens: transform.lookalikes } : {}),
        } : {}),
      },
      target: `${r.method} ${r.host}${r.path}`,
      effect: v.effect,
      reason: transform ? `${v.reason} — protected ${describeTransform(transform)}` : v.reason,
      rule_id: v.rule_id,
      ruleset_pulled_at: v.pulled_at,
      enforcement: "mitm",
      degraded: v.degraded,
      ...(client ? { client: client.id, client_label: client.label } : {}),
      ...(service?.id ? { service: service.id, service_label: service.label } : {}),
      ...(v.evidence ? { evidence: transform ? { ...v.evidence, transform: { handler: (v.constraint as { handler?: string } | null | undefined)?.handler ?? (v.constraint?.kind === "redact" ? "REDACT" : "REVERSIBLE_TOKENIZE"), protected: transform.protected.map((x) => ({ type: x.kind, count: x.count })), fields: transform.fields } } : v.evidence } : {}),
    });
    appendToSpool(receipt);
  } catch (err) {
    console.error(`proxy: failed to write egress receipt: ${(err as Error).message}`);
  }
}

function parseHostPort(hostHeader: string, defaultPort: number): { host: string; port: number } {
  // hostHeader may be "host", "host:port", or "[v6]:port".
  const m = hostHeader.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (m) return { host: m[1], port: m[2] ? Number(m[2]) : defaultPort };
  const idx = hostHeader.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(hostHeader.slice(idx + 1))) {
    return { host: hostHeader.slice(0, idx), port: Number(hostHeader.slice(idx + 1)) };
  }
  return { host: hostHeader, port: defaultPort };
}

export interface ProxyHandle {
  server: http.Server;
  port: number;
  /** True when TLS interception is active for inspectable hosts. */
  inspecting: boolean;
  stop: () => Promise<void>;
}

export interface ProxyOptions {
  port?: number;
  /**
   * Terminate TLS and inspect request bodies. Requires the CA to exist and be
   * trusted; without it every HTTPS handshake would fail, so we refuse to turn
   * inspection on rather than silently break the machine's network.
   */
  inspect?: boolean;
  /** Extra host patterns that must never be decrypted, beyond the defaults. */
  noInspect?: RegExp[];
  /** Record a receipt for EVERY inspected request, not only the risky ones. */
  recordAll?: boolean;
}

export async function startProxy(opts: ProxyOptions | number = {}): Promise<ProxyHandle> {
  const o: ProxyOptions = typeof opts === "number" ? { port: opts } : opts;
  const port = o.port ?? DEFAULT_PROXY_PORT;
  const noInspect = o.noInspect ?? [];
  const recordAll = Boolean(o.recordAll);

  const cfg = loadConfig();
  if (!cfg) throw new Error("proxy: not enrolled — cannot sign receipts (run: wrapboxd enroll ...)");

  // Inspection is only safe once the CA exists. Turning it on without one
  // would break every HTTPS connection on the device.
  const inspecting = Boolean(o.inspect) && caExists();
  if (o.inspect && !inspecting) {
    console.error("proxy: inspection requested but no CA found — falling back to hostname-level enforcement");
  }

  // Universal safety net — one connection must never crash the daemon.
  //
  // try/catch alone is NOT that net: a socket reset arrives asynchronously as
  // an 'error' event, and an unhandled one takes the whole process down. Every
  // socket therefore gets an error listener attached BEFORE any I/O on it.
  const server = http.createServer((req, res) => {
    req.on("error", () => { /* client hung up mid-request */ });
    res.on("error", () => { /* client hung up mid-response */ });
    try { handleHttp(req, res); } catch (err) {
      console.error(`proxy handler: ${(err as Error).message}`);
      try { res.destroy(); } catch { /* ignore */ }
    }
  });
  // Malformed request line / TLS sent to the plain port: answer if we still can,
  // otherwise drop quietly. Without this listener Node throws on the socket.
  server.on("clientError", (_err, socket) => {
    try {
      if ((socket as net.Socket).writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      else socket.destroy();
    } catch { /* ignore */ }
  });
  const handleHttp = (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Plain HTTP forward. req.url may be absolute (proxy request) or relative.
    let target: URL;
    try {
      target = new URL(req.url && /^https?:\/\//i.test(req.url) ? req.url : `http://${req.headers.host}${req.url}`);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad request");
      return;
    }
    const host = target.hostname;
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    const session = readProxySession();
    const agent = session?.agent || "unknown";
    const sid = session?.session || "";
    const d = decide(host, port, agent);
    writeReceipt(cfg, host, port, agent, sid, d, "proxy");

    if (d.effect === "block") {
      // HTTP header values must be printable ASCII (RFC 7230 §3.2.6); strip anything else.
      const safeReason = d.reason.replace(/[^\x20-\x7e]/g, "?");
      res.writeHead(403, { "Content-Type": "text/plain", "X-Wrapbox-Reason": safeReason });
      res.end(`Wrapbox proxy: blocked - ${d.reason}\n`);
      return;
    }

    // Allow: forward. Strip hop-by-hop headers per RFC 7230 §6.1.
    const outgoingHeaders = { ...req.headers } as Record<string, any>;
    delete outgoingHeaders["proxy-connection"];
    delete outgoingHeaders["proxy-authorization"];
    const outReq = http.request({
      host,
      port,
      method: req.method,
      path: target.pathname + target.search,
      headers: outgoingHeaders,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    outReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`upstream error: ${err.message}\n`);
    });
    req.pipe(outReq);
  };

  server.on("connect", (req, clientSocket, head) => {
    // Attach FIRST: a browser that is refused a tunnel typically resets the
    // socket immediately, and that reset must not reach the process as an
    // unhandled 'error'.
    clientSocket.on("error", () => { /* client reset the tunnel */ });
    try { handleConnect(req, clientSocket, head); } catch (err) {
      console.error(`proxy connect: ${(err as Error).message}`);
      try { clientSocket.destroy(); } catch { /* ignore */ }
    }
  });
  const handleConnect = (req: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    const { host, port } = parseHostPort(req.url || "", 443);
    const session = readProxySession();
    const agent = session?.agent || "unknown";
    const sid = session?.session || "";

    // Hostname-level decision first — it is cheap, and a host that is banned
    // outright should never reach the cost of a TLS handshake.
    const canInspect = inspecting && shouldInspect(host, noInspect);
    const d = decide(host, port, agent, canInspect);

    // "allow" here is the CONNECT-level decision (host only). A constrain rule
    // matches on CONTENT, which is invisible until the body is decrypted — so
    // the session must be inspected for the transform to ever run.
    const willInspect = canInspect && d.effect === "allow";

    // Record the connection-level decision only when it IS the decision and it
    // mattered. When we are about to inspect, the per-request receipts carry
    // the real verdicts. And a plain allow to a non-AI host we never decrypt
    // (an OS update server, a CDN) is background chatter, not evidence.
    if (d.effect === "block") {
      if (shouldRecordAgain(`c|${host}|block|${d.reason}`)) {
        writeReceipt(cfg, host, port, agent, sid, d, "proxy");
      }
    } else if (!willInspect && identifyService(host).ai) {
      if (shouldRecordAgain(`c|${host}|allow|${d.reason}`)) {
        writeReceipt(cfg, host, port, agent, sid, d, "proxy");
      }
    } else if (!willInspect) {
      skipped++;
    }

    if (willInspect) {
      try {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      } catch {
        return; // client vanished between CONNECT and our reply
      }
      interceptTls(clientSocket, head, {
        host,
        port,
        decide: (r) => decideEgress(cfg, r, agent, sid, recordAll),
        onTransform: (report) => recordConstrain(cfg, report),
        review: (r, v) => awaitApproval(cfg, r, v, identifyClient(r.headers["user-agent"] as string | undefined), identifyService(r.host)),
      });
      return;
    }

    if (d.effect === "block") {
      const safeReason = d.reason.replace(/[^\x20-\x7e]/g, "?");
      try {
        clientSocket.write(`HTTP/1.1 403 Forbidden\r\nX-Wrapbox-Reason: ${safeReason}\r\n\r\n`);
        clientSocket.end();
      } catch { /* client already gone — the receipt is already written */ }
      return;
    }
    const upstream = net.connect(port, host);
    upstream.on("error", () => {
      try {
        if ((clientSocket as net.Socket).writable) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        else clientSocket.destroy();
      } catch { /* ignore */ }
    });
    upstream.on("connect", () => {
      try {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      } catch { try { upstream.destroy(); } catch { /* ignore */ } }
    });
    clientSocket.on("close", () => { try { upstream.destroy(); } catch { /* ignore */ } });
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });

  const stop = async () => {
    await closeMitm();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { server, port, inspecting, stop };
}
