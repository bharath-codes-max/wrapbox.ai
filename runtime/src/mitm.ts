/**
 * TLS interception — the part that makes "blocked before it left the device"
 * literally true rather than marketing.
 *
 * Without this, an HTTPS CONNECT can only be judged by its hostname: we can
 * say "no traffic to claude.ai" but not "no SOURCE CODE to claude.ai". Since
 * the whole product is about what is inside the request, the proxy has to
 * terminate TLS itself.
 *
 * THE CENTRAL GUARANTEE — buffer before forward. The entire request body is
 * read into memory and the upstream connection is NOT opened until a verdict
 * exists. Streaming the body upstream while deciding would mean the bytes had
 * already left; the decision would be a log entry, not a control.
 *
 * WHY THE CLIENT ACCEPTS OUR CERTIFICATE: we present a leaf minted for the
 * requested host and signed by the Wrapbox root, which the device trusts.
 * Browsers deliberately exempt locally-installed roots from pinning — that
 * carve-out exists for exactly this case. Applications that pin in their own
 * code will refuse; see the handshake-failure path below, which fails closed.
 */

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import net from "node:net";
import type { Duplex } from "node:stream";
import { secureContextFor } from "./ca.js";
import { classifyContentAsync, describeClassification, uninspectableClassification, type Classification } from "./classify.js";
import { tenantDestinations } from "./tenant.js";
import type { EvidenceV2 } from "@wrapbox/registry";
import { boundedInflate } from "./parsers.js";
import { transformBody, describeTransform, type Constraint, type TransformReport } from "./transform.js";
import { createStreamRestorer, hasTokens, restore } from "./tokenize.js";

/**
 * Largest body we will hold in memory to inspect.
 *
 * Anything larger cannot be inspected, and is reported to the policy engine as
 * uninspected rather than quietly forwarded. The engine blocks by default, so
 * "upload a 300 MB file" does not become the documented way around Wrapbox —
 * which is the shape of bug that has embarrassed real DLP products.
 */
export const MAX_INSPECT_BYTES = 64 * 1024 * 1024;

/**
 * Hosts we decline to decrypt, by policy rather than by technical limitation.
 *
 * Inspecting everything is technically possible and ethically wrong. An
 * employee's bank, doctor and payroll are not the company's business, and a
 * product that reads them will lose the argument with a works council, a DPO,
 * or a journalist. These ship as defaults so a customer does not have to
 * remember to add them.
 */
export const DEFAULT_NO_INSPECT: RegExp[] = [
  // Financial
  /(^|\.)bank(ing)?\./i, /(^|\.)chase\.com$/i, /(^|\.)hdfcbank\.com$/i, /(^|\.)icicibank\.com$/i,
  /(^|\.)sbi\.co\.in$/i, /(^|\.)paypal\.com$/i, /(^|\.)stripe\.com$/i, /(^|\.)razorpay\.com$/i,
  // Health
  /(^|\.)health\./i, /(^|\.)nhs\.uk$/i, /(^|\.)practo\.com$/i,
  // Payroll and HR
  /(^|\.)payroll\./i, /(^|\.)adp\.com$/i, /(^|\.)gusto\.com$/i, /(^|\.)workday\.com$/i,
  // OS, certificate and update infrastructure — these pin or hard-fail, and
  // breaking them breaks the machine rather than protecting it.
  /(^|\.)apple\.com$/i, /(^|\.)icloud\.com$/i, /(^|\.)mzstatic\.com$/i,
  /(^|\.)windowsupdate\.com$/i, /(^|\.)microsoft\.com$/i,
  /(^|\.)ocsp\./i, /(^|\.)crl\./i, /(^|\.)pki\./i,
  // Local
  /^localhost$/i, /^127\./, /^::1$/, /\.local$/i,
];

export function shouldInspect(host: string, extraBypass: RegExp[] = []): boolean {
  // The never-decrypt decision lives in the Destination Registry now (a
  // catalogue service always beats an exemption pattern, so Copilot on
  // copilot.microsoft.com is inspected while update.microsoft.com is not).
  // DEFAULT_NO_INSPECT is retained only as the seed the registry was built
  // from and for operator --no-inspect overrides.
  if (extraBypass.some((re) => re.test(host))) return false;
  return tenantDestinations().shouldInspect(host);
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface EgressRequest {
  host: string;
  port: number;
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  classification: Classification;
  /** True when the body was too large to inspect. */
  uninspected: boolean;
}

export interface EgressVerdict {
  effect: "allow" | "constrain" | "block" | "review";
  reason: string;
  rule_id: string | null;
  degraded: boolean;
  pulled_at: string | null;
  /** Present when effect is "constrain" — what the body transform must protect. */
  constraint?: Constraint | null;
  /** Evidence v2 for the receipt (built by the decision, enriched by the transform). */
  evidence?: EvidenceV2;
}

export interface MitmContext {
  host: string;
  port: number;
  /** Called once per decrypted request, after the body is fully buffered. */
  decide: (req: EgressRequest) => EgressVerdict;
  /** Called after a CONSTRAIN transform, with what was protected (labels only). */
  onTransform?: (report: TransformReport) => void;
  /**
   * Hold the request while a human answers. Resolves "approved" or "denied".
   * Present only when the daemon can reach the Control Plane; without it a
   * review verdict has nobody to ask and must deny.
   */
  review?: (req: EgressRequest, v: EgressVerdict) => Promise<{ ok: boolean; reason: string }>;
}

/** Stashed on the TLSSocket so the shared inner server knows the destination. */
const CTX = Symbol("wrapbox.mitm.ctx");

interface TaggedSocket extends tls.TLSSocket {
  [CTX]?: MitmContext;
}

/* ------------------------------------------------------------------ *
 * The inner server — one instance, reused for every intercepted flow
 * ------------------------------------------------------------------ */

let innerServer: http.Server | null = null;

function getInnerServer(): http.Server {
  if (innerServer) return innerServer;

  innerServer = http.createServer((req, res) => {
    req.on("error", () => { /* client vanished mid-request */ });
    res.on("error", () => { /* client vanished mid-response */ });

    const ctx = (req.socket as TaggedSocket)[CTX];
    if (!ctx) {
      // Should be unreachable: nothing reaches this server except through
      // interceptTls(), which always tags the socket.
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("wrapbox: missing interception context\n");
      return;
    }
    handleDecrypted(ctx, req, res);
  });

  // A client that rejects our certificate (pinning) surfaces here. Never let
  // it reach the process as an unhandled error.
  innerServer.on("clientError", (_err, socket) => {
    try { (socket as net.Socket).destroy(); } catch { /* already gone */ }
  });

  // WebSocket and other protocol upgrades inside the TLS tunnel.
  innerServer.on("upgrade", (req, socket, head) => {
    socket.on("error", () => { /* peer gone */ });
    const ctx = (socket as unknown as TaggedSocket)[CTX];
    if (!ctx) { try { socket.destroy(); } catch { /* ignore */ } return; }
    handleUpgrade(ctx, req, socket as Duplex, head);
  });

  return innerServer;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Take the raw client socket of an already-accepted CONNECT and terminate TLS
 * on it, presenting a certificate for `ctx.host`.
 *
 * The caller must already have written "200 Connection Established".
 */
export function interceptTls(clientSocket: Duplex, head: Buffer, ctx: MitmContext): void {
  // Any bytes the client sent immediately after CONNECT are the start of its
  // TLS ClientHello. They must go back in front of the stream before the TLS
  // layer reads it, or the handshake sees a truncated hello.
  if (head && head.length) {
    (clientSocket as net.Socket).unshift(head);
  }

  let tlsSocket: TaggedSocket;
  try {
    tlsSocket = new tls.TLSSocket(clientSocket as net.Socket, {
      isServer: true,
      // Bind the certificate to the host from the CONNECT line. This is more
      // reliable than an SNI callback: we already know the destination, and a
      // client that omits SNI still gets the right certificate.
      secureContext: secureContextFor(ctx.host),
    }) as TaggedSocket;
  } catch (err) {
    // Minting failed (an invalid hostname, or openssl unavailable). Fail
    // closed — dropping the connection is the safe direction.
    try { clientSocket.destroy(); } catch { /* ignore */ }
    console.error(`mitm: could not intercept ${ctx.host}: ${(err as Error).message}`);
    return;
  }

  tlsSocket[CTX] = ctx;
  tlsSocket.on("error", () => {
    // Most commonly: the client refused our certificate because it pins.
    // The connection dies here and nothing is forwarded — fail closed.
    try { tlsSocket.destroy(); } catch { /* ignore */ }
  });

  getInnerServer().emit("connection", tlsSocket);
}

/* ------------------------------------------------------------------ *
 * The decision path
 * ------------------------------------------------------------------ */

/**
 * Decompress a request body before classifying it.
 *
 * Without this, any client that gzips its upload is invisible: the classifier
 * would scan compressed bytes, find no readable text, and report "nothing
 * sensitive" for a payload that is entirely secrets. Compression would be a
 * one-line bypass of the whole product, so a body we cannot decode must be
 * treated as unread rather than as clean — the caller decides what to do with
 * an empty classification, and the engine's default is to block.
 */
function decodeBody(body: Buffer, headers: http.IncomingHttpHeaders): Buffer {
  const enc = String(headers["content-encoding"] ?? "").toLowerCase().trim();
  if (!enc || enc === "identity" || body.length === 0) return body;
  // Bounded decompression (§4): a body that inflates past the limit is a
  // zip-bomb shape and throws inside boundedInflate → null here. We return the
  // RAW bytes in that case, which the classifier reads as opaque/uninspectable,
  // so the fail-closed gate blocks it rather than trusting an empty scan of a
  // bomb we refused to expand.
  const out = boundedInflate(body, enc);
  return out ?? body;
}

function handleDecrypted(ctx: MitmContext, req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let oversize = false;

  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_INSPECT_BYTES) {
      // Stop accumulating, but keep draining so the client is not left
      // hanging. The verdict is decided on `oversize`, not on the bytes.
      oversize = true;
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    const body = oversize ? Buffer.alloc(0) : Buffer.concat(chunks);

    // A body with a content-encoding that could NOT be safely decompressed
    // (bounded-inflate refused it as a zip-bomb, or it was corrupt) is unread,
    // not clean. Marking it uninspectable routes it through the fail-closed
    // gate rather than letting the classifier scan raw compressed bytes and
    // report "nothing found" for a payload it never actually decoded (§4).
    const enc = String(req.headers["content-encoding"] ?? "").toLowerCase().trim();
    const decodeRefused = !oversize && !!enc && enc !== "identity" && body.length > 0 && boundedInflate(body, enc) === null;

    // ── Nothing has been forwarded. The upstream connection does not exist
    //    yet. Everything is still recoverable at this point. ──
    const classified: Promise<Classification> = oversize
      ? Promise.resolve(uninspectableClassification("OVERSIZE", "payload too large to inspect", size))
      : decodeRefused
      ? Promise.resolve(uninspectableClassification("DECOMPRESSION_REFUSED", `content-encoding ${enc} could not be safely decompressed (possible decompression bomb)`, size))
      : classifyContentAsync(decodeBody(body, req.headers), String(req.headers["content-type"] ?? ""))
          // A pipeline failure is not "clean": fail closed with an explicit state.
          .catch((e: Error) => uninspectableClassification("PARSER_FAILURE", `inspection failed: ${e.message.slice(0, 120)}`, size));

    void classified.then((classification) => afterClassification(ctx, req, res, body, size, oversize, classification));
  });
}

function afterClassification(ctx: MitmContext, req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, size: number, oversize: boolean, classification: Classification): void {
  {
    void size;
    if (process.env.WRAPBOX_DEBUG_BODY && body.length > 0) {
      const enc = String(req.headers["content-encoding"] ?? "none");
      const decoded = decodeBody(body, req.headers);
      console.error(`[body] ${ctx.host}${req.url} enc=${enc} raw=${body.length} decoded=${decoded.length} kinds=${JSON.stringify(classification.kinds)}`);
      console.error(`[body] ${JSON.stringify(decoded.subarray(0, 400).toString("utf-8"))}`);
    }

    const verdict = ctx.decide({
      host: ctx.host,
      port: ctx.port,
      method: req.method || "GET",
      path: req.url || "/",
      headers: req.headers,
      classification,
      uninspected: oversize,
    });

    if (verdict.effect === "block") {
      // Scrub the buffered copy: we are about to refuse to send this, so we
      // should not keep it lying in memory either.
      body.fill(0);
      sendBlockPage(res, ctx.host, verdict, classification, oversize);
      return;
    }

    if (verdict.effect === "review") {
      // The socket stays open and the body stays here. Nothing is forwarded
      // while a person decides — that is the whole point of REVIEW. If it were
      // forwarded first, the data would already be gone and the approval would
      // be theatre.
      if (!ctx.review) {
        body.fill(0);
        sendBlockPage(res, ctx.host, { ...verdict, effect: "block", reason: `${verdict.reason} — no approver reachable` }, classification, oversize);
        return;
      }
      void ctx.review({
        host: ctx.host, port: ctx.port, method: req.method || "GET", path: req.url || "/",
        headers: req.headers, classification, uninspected: oversize,
      }, verdict).then((outcome) => {
        if (outcome.ok) {
          forwardUpstream(ctx, req, res, body);
        } else {
          body.fill(0);
          sendBlockPage(res, ctx.host, { ...verdict, effect: "block", reason: outcome.reason }, classification, oversize);
        }
      }).catch(() => {
        // An error while waiting is not consent.
        body.fill(0);
        sendBlockPage(res, ctx.host, { ...verdict, effect: "block", reason: `${verdict.reason} — approval failed` }, classification, oversize);
      });
      return;
    }

    if (verdict.effect === "constrain") {
      // THE INVARIANT: a constrain rule that cannot be applied must NOT be
      // forwarded. Anything else silently turns CONSTRAIN into ALLOW, which is
      // the failure mode where the dashboard says "protected" and the model
      // received the raw spreadsheet.
      if (!verdict.constraint) {
        body.fill(0);
        sendBlockPage(res, ctx.host, { ...verdict, effect: "block", reason: `${verdict.reason} — the rule names no fields to protect, so nothing could be masked` }, classification, oversize);
        return;
      }

      // Transform the DECODED bytes: a gzipped body cannot be pattern-matched.
      const decoded = decodeBody(body, req.headers);
      const result = transformBody(decoded, String(req.headers["content-type"] ?? ""), verdict.constraint);

      if (!result.ok) {
        body.fill(0);
        sendBlockPage(res, ctx.host, { ...verdict, effect: "block", reason: `${verdict.reason} — ${result.reason}` }, classification, oversize);
        return;
      }

      // Tell the caller what was actually protected, so the receipt records a
      // CONSTRAIN with real field names rather than an unqualified "allow".
      ctx.onTransform?.(result.report);
      body.fill(0);
      forwardUpstream(ctx, req, res, result.body, { decoded: true });
      return;
    }

    forwardUpstream(ctx, req, res, body);
  }
}

function sendBlockPage(
  res: http.ServerResponse,
  host: string,
  verdict: EgressVerdict,
  classification: Classification,
  oversize: boolean,
): void {
  const what = oversize ? "payload too large to inspect" : describeClassification(classification);
  // Header values must be printable ASCII (RFC 7230 §3.2.6).
  const safe = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 400);

  const payload = JSON.stringify({
    error: "blocked_by_wrapbox",
    destination: host,
    reason: verdict.reason,
    detected: what,
    rule_id: verdict.rule_id,
  }, null, 2);

  try {
    res.writeHead(403, {
      "content-type": "application/json",
      "x-wrapbox-decision": "block",
      "x-wrapbox-rule": safe(verdict.rule_id ?? ""),
      "x-wrapbox-reason": safe(verdict.reason),
      "x-wrapbox-detected": safe(what),
    });
    res.end(payload + "\n");
  } catch { /* client already gone; the receipt is written either way */ }
}

/** True for an IPv4/IPv6 literal — SNI must be omitted for these (RFC 6066 §3). */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || /^\[.*\]$/.test(host);
}

function forwardUpstream(
  ctx: MitmContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
  opts: { decoded?: boolean } = {},
): void {
  // Strip hop-by-hop headers (RFC 7230 §6.1) and fix the length, since we
  // are re-sending a body we buffered rather than streaming the original.
  const headers: Record<string, unknown> = { ...req.headers };
  delete headers["proxy-connection"];
  delete headers["proxy-authorization"];
  delete headers["connection"];
  delete headers["keep-alive"];
  delete headers["transfer-encoding"];

  // A transformed body is plaintext even when the original was compressed.
  // Leaving content-encoding in place would tell the server to gunzip bytes
  // that are no longer gzipped, and it would reject the request.
  if (opts.decoded) delete headers["content-encoding"];

  // Unconditional: a transform can legitimately empty a body, and the old
  // `length > 0` guard left a stale Content-Length behind when it did.
  headers["content-length"] = String(body.length);

  const upstream = https.request({
    host: ctx.host,
    port: ctx.port,
    method: req.method,
    path: req.url,
    headers: headers as http.OutgoingHttpHeaders,
    // Present the real hostname to the real server so its certificate validates
    // normally. SNI is defined for hostnames only — Node throws if servername
    // is an IP literal (RFC 6066 §3), so omit it for a bare IP destination.
    ...(isIpLiteral(ctx.host) ? {} : { servername: ctx.host }),
  }, (upRes) => {
    try {
      pipeWithRestore(upRes, res);
    } catch {
      try { upRes.destroy(); } catch { /* ignore */ }
    }
  });

  upstream.on("error", (err) => {
    try {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`wrapbox: upstream error: ${err.message}\n`);
    } catch { /* client gone */ }
  });

  if (body.length > 0) upstream.write(body);
  upstream.end();
}

/**
 * Forward the response, swapping our tokens back for the real values before
 * the browser ever sees them. This is the half that makes reversible
 * tokenization reversible: the vendor only ever held <WB_EMAIL_001_a3f9>, and
 * the person reading the reply gets their actual data.
 *
 * Three things make this harder than a pipe:
 *
 *  1. STREAMING. Every current chat vendor streams replies as SSE, so a token
 *     routinely straddles a chunk boundary ("<WB_EMA" + "IL_001_a3f9>"). The
 *     stream restorer holds back a tail until it can see a whole token.
 *  2. COMPRESSION. A gzipped response cannot be pattern-matched, so when we
 *     need to rewrite one we decompress, restore, and drop content-encoding.
 *  3. LENGTH. Restoring changes the byte count, so Content-Length must go and
 *     the response must be chunked instead.
 *
 * When the vault holds nothing there is nothing to restore, so the common case
 * is still a straight pipe with no buffering and no added latency.
 */
function pipeWithRestore(upRes: http.IncomingMessage, res: http.ServerResponse): void {
  const headers = { ...upRes.headers };
  const enc = String(headers["content-encoding"] ?? "").toLowerCase();
  const ctype = String(headers["content-type"] ?? "");

  // Only text can contain a token. Images, audio and binary downloads stream
  // through untouched — decompressing them would be pure waste.
  const isText = /text\/|json|event-stream|javascript|xml/i.test(ctype);
  if (!isText) { res.writeHead(upRes.statusCode || 502, upRes.headers); upRes.pipe(res); return; }

  // An identity-encoded stream can be restored incrementally, which keeps SSE
  // streaming token-by-token instead of arriving in one lump at the end.
  if (!enc || enc === "identity") {
    delete headers["content-length"];   // restoring changes the length
    res.writeHead(upRes.statusCode || 502, headers);
    const r = createStreamRestorer();
    upRes.setEncoding("utf-8");
    upRes.on("data", (c: string) => { try { res.write(r.push(c)); } catch { /* client gone */ } });
    upRes.on("end", () => { try { res.write(r.end()); res.end(); } catch { /* client gone */ } });
    upRes.on("error", () => { try { res.end(); } catch { /* ignore */ } });
    return;
  }

  // Compressed: buffer, decompress, restore, send as plaintext. Buffering a
  // compressed stream is unavoidable — a gzip member cannot be inflated in
  // arbitrary pieces without holding state across them.
  const chunks: Buffer[] = [];
  let total = 0;
  let tooBig = false;
  upRes.on("data", (c: Buffer) => {
    total += c.length;
    if (total > MAX_INSPECT_BYTES) { tooBig = true; return; }
    chunks.push(c);
  });
  upRes.on("end", () => {
    try {
      if (tooBig) {
        // Too large to hold. Nothing was modified, so passing it through is
        // honest — the outbound protection already happened.
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        res.end(Buffer.concat(chunks));
        return;
      }
      const raw = Buffer.concat(chunks);
      const text = decodeBody(raw, upRes.headers).toString("utf-8");
      if (!hasTokens(text)) {
        // Untouched — send the original compressed bytes back verbatim.
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        res.end(raw);
        return;
      }
      const out = Buffer.from(restore(text).text, "utf-8");
      delete headers["content-encoding"];
      headers["content-length"] = String(out.length);
      res.writeHead(upRes.statusCode || 502, headers);
      res.end(out);
    } catch {
      try { res.writeHead(upRes.statusCode || 502, upRes.headers); res.end(Buffer.concat(chunks)); } catch { /* client gone */ }
    }
  });
  upRes.on("error", () => { try { res.end(); } catch { /* ignore */ } });
}

/* ------------------------------------------------------------------ *
 * Protocol upgrades (WebSocket)
 * ------------------------------------------------------------------ */

/**
 * An upgrade carries no body to inspect at this point, so the decision is made
 * on the destination and path alone, then the streams are joined.
 */
function handleUpgrade(ctx: MitmContext, req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  const verdict = ctx.decide({
    host: ctx.host,
    port: ctx.port,
    method: "UPGRADE",
    path: req.url || "/",
    headers: req.headers,
    // Frames inside a WebSocket are not inspected. Say so: the decision runs
    // through the fail-closed gate, which BLOCKS wherever a content protection
    // could apply to this destination and allows only where none could.
    classification: uninspectableClassification("TRANSPORT", "WebSocket upgrade — frames are not inspected", 0),
    uninspected: true,
  });

  // CONSTRAIN cannot rewrite frames and REVIEW has no body to show an approver:
  // both are refusals here, never a pass-through.
  if (verdict.effect !== "allow") {
    try { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); } catch { /* ignore */ }
    return;
  }

  const headers = Object.entries(req.headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("\r\n");

  const up = tls.connect({ host: ctx.host, port: ctx.port, servername: ctx.host }, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });

  up.on("error", () => { try { socket.destroy(); } catch { /* ignore */ } });
  socket.on("error", () => { try { up.destroy(); } catch { /* ignore */ } });
  socket.on("close", () => { try { up.destroy(); } catch { /* ignore */ } });
}

/** Shut the shared inner server down (used on daemon stop and in tests). */
export function closeMitm(): Promise<void> {
  return new Promise((resolve) => {
    if (!innerServer) return resolve();
    innerServer.close(() => { innerServer = null; resolve(); });
  });
}
