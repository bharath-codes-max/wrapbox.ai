/**
 * Apache Tika 4 sidecar client — the Tier 2 extractor (`wrapbox.tika`).
 *
 * WHY a sidecar: PDF, legacy Office, mail and archive parsing is exactly the
 * code that gets exploited by hostile documents. The daemon never links those
 * parsers; it hands bytes to an isolated, memory-capped, fork-supervised Tika
 * server on loopback and reads back a recursive-metadata (rmeta) tree. If the
 * sidecar is absent the runtime keeps its fail-closed behaviour for those
 * formats — `available()` says so honestly and the clause stays UNDERSTOOD_ONLY.
 *
 * Privacy boundary: the endpoint MUST be loopback. A tenant may point the
 * runtime at a remote Tika only by setting `services.tika.allowRemote=true` in
 * WRAPBOX_HOME/config.json next to `services.tika.url`, because every outbound
 * body would otherwise be copied to that host. `WRAPBOX_TIKA_URL` overrides the
 * URL (tests, multi-instance runs) but never the loopback rule.
 *
 * Header names, status codes and metadata keys follow the Tika Server docs
 * (cwiki.apache.org/confluence/display/TIKA/TikaServer): `/version`,
 * `PUT /rmeta/text`, `X-Tika-Skip-Embedded`, `maxEmbeddedResources`,
 * `writeLimit`, `unpackMaxBytes`, `X-TIKA:content`, `X-TIKA:embedded_depth`,
 * `X-TIKA:embedded_resource_path`, `X-TIKA:Exception:write_limit_reached`.
 *
 * Every failure is an explicit UNINSPECTABLE state — never an empty unit list.
 * Text extracted here is returned to the core for detection; nothing in this
 * module logs or persists content.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BUILTIN_EXTRACTORS } from "@wrapbox/registry";
import type { ContentUnit, ExtractionResult, ExtractorDescriptor, UninspectableState } from "@wrapbox/registry";

export interface ExtractorImpl {
  descriptor: ExtractorDescriptor;
  available(): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
  extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractionResult>;
}

export interface ExtractHints { filename?: string; contentType?: string; unitPath?: string; depth?: number }

export const TIKA_DESCRIPTOR: ExtractorDescriptor = BUILTIN_EXTRACTORS.find((e) => e.id === "wrapbox.tika")!;

/** Default sidecar endpoint (ops/tika/docker-compose.yml publishes exactly this). */
export const DEFAULT_TIKA_URL = "http://127.0.0.1:9998";
/** Characters of text Tika may hand back per handler (its `writeLimit`). */
export const WRITE_LIMIT = 32 * 1024 * 1024;
/** Upper bound on the rmeta reply we are willing to buffer (text + metadata for every unit). */
const MAX_REPLY_BYTES = 48 * 1024 * 1024;
/** `/version` probe budget — availability must be cheap. */
const AVAILABILITY_TIMEOUT_MS = 1500;

/* ------------------------------------------------------------------ *
 * Endpoint resolution and the loopback rule
 * ------------------------------------------------------------------ */

export interface TikaEndpoint { url: string; allowRemote: boolean; source: "env" | "config" | "default" }

interface ServicesConfig { services?: { tika?: { url?: string; allowRemote?: boolean } }; extractors?: { tika?: { url?: string; allowRemote?: boolean } } }

function readServicesConfig(): ServicesConfig {
  const home = process.env.WRAPBOX_HOME || path.join(os.homedir(), ".wrapbox");
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as ServicesConfig) : {};
  } catch {
    return {};
  }
}

/** Pure: env + config → endpoint. `extractors.tika` is accepted as the descriptor's `tenantConfig` spelling. */
export function resolveTikaEndpoint(env: NodeJS.ProcessEnv = process.env, cfg: ServicesConfig = readServicesConfig()): TikaEndpoint {
  const tenant = cfg.services?.tika ?? cfg.extractors?.tika ?? {};
  const allowRemote = tenant.allowRemote === true;
  if (env.WRAPBOX_TIKA_URL) return { url: env.WRAPBOX_TIKA_URL, allowRemote, source: "env" };
  if (tenant.url) return { url: tenant.url, allowRemote, source: "config" };
  return { url: DEFAULT_TIKA_URL, allowRemote, source: "default" };
}

export function isLoopbackUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Null when the endpoint may be used; otherwise the reason it is refused. */
export function endpointRefusal(ep: TikaEndpoint): string | null {
  let u: URL;
  try { u = new URL(ep.url); } catch { return `tika url is not a valid URL (${ep.source})`; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `tika url must be http(s), got ${u.protocol}`;
  if (isLoopbackUrl(ep.url) || ep.allowRemote) return null;
  return "tika url is not loopback and services.tika.allowRemote is not set — refusing to send content off-device";
}

/* ------------------------------------------------------------------ *
 * rmeta → ContentUnit[]
 * ------------------------------------------------------------------ */

type RmetaDoc = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

const MIME_FORMATS: Array<[RegExp, string]> = [
  [/^application\/pdf$/i, "pdf"],
  [/wordprocessingml\.document$/i, "docx"],
  [/spreadsheetml\.sheet$/i, "xlsx"],
  [/presentationml\.presentation$/i, "pptx"],
  [/^application\/msword$/i, "doc"],
  [/^application\/vnd\.ms-excel$/i, "xls"],
  [/^application\/vnd\.ms-powerpoint$/i, "ppt"],
  [/^application\/rtf$|^text\/rtf$/i, "rtf"],
  [/opendocument\.text$/i, "odt"],
  [/opendocument\.spreadsheet$/i, "ods"],
  [/opendocument\.presentation$/i, "odp"],
  [/^message\/rfc822$/i, "eml"],
  [/ms-outlook/i, "msg"],
  [/^application\/zip$/i, "zip"],
  [/x-tar$/i, "tar"],
  [/gzip$/i, "gz"],
  [/x-7z-compressed$/i, "7z"],
  [/x-rar-compressed|vnd\.rar/i, "rar"],
  [/^application\/epub\+zip$/i, "epub"],
  [/^image\//i, "image"],
  [/^text\/html$/i, "html"],
  [/^text\//i, "text"],
];

function formatFor(contentType: string | undefined, name: string | undefined): string {
  const ct = (contentType ?? "").split(";")[0].trim();
  for (const [re, f] of MIME_FORMATS) if (re.test(ct)) return f;
  const ext = name ? path.extname(name).slice(1).toLowerCase() : "";
  if (ext && (TIKA_DESCRIPTOR.formats as string[]).includes(ext)) return ext;
  return ct ? ct.split("/")[1] ?? "unknown" : "unknown";
}

/** Metadata we keep on a unit: identity, position in the tree, and MIP labels. Nothing else. */
function keepMetadata(doc: RmetaDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["Content-Type", "resourceName", "X-TIKA:embedded_resource_path", "X-TIKA:embedded_depth"]) {
    const v = str(doc[key]);
    if (v !== undefined) out[key] = v;
  }
  for (const [k, v] of Object.entries(doc)) {
    if (/(^|:)MSIP_Label_/i.test(k)) { const s = str(v); if (s !== undefined) out[k] = s; }
  }
  return out;
}

function isTruncated(doc: RmetaDoc, text: string | undefined): boolean {
  if (/^true$/i.test(str(doc["X-TIKA:content_truncated"]) ?? "")) return true;
  if (/^true$/i.test(str(doc["X-TIKA:Exception:write_limit_reached"]) ?? "")) return true;
  return text !== undefined && text.length >= WRITE_LIMIT;
}

/** Turn an rmeta array into units. Depth is checked against the limit by the caller. */
export function unitsFromRmeta(docs: RmetaDoc[], hints: ExtractHints, extractorId: string): ContentUnit[] {
  const rootPath = hints.unitPath ?? "root";
  const baseDepth = hints.depth ?? 0;
  const units: ContentUnit[] = [];
  const byResourcePath = new Map<string, ContentUnit>();
  const seenPaths = new Set<string>();

  docs.forEach((doc, i) => {
    const contentType = str(doc["Content-Type"])?.split(";")[0].trim();
    const resourceName = str(doc["resourceName"]);
    const rawText = str(doc["X-TIKA:content"]);
    const text = rawText !== undefined && rawText.trim().length > 0 ? rawText : undefined;
    const isImage = /^image\//i.test(contentType ?? "");
    const embeddedDepth = i === 0 ? 0 : Math.max(1, Number.parseInt(str(doc["X-TIKA:embedded_depth"]) ?? "1", 10) || 1);
    const resourcePath = str(doc["X-TIKA:embedded_resource_path"]);

    // Parent: the container, or the embedded doc whose resource path is our prefix.
    let parent: ContentUnit | undefined = i === 0 ? undefined : units[0];
    if (i > 0 && resourcePath) {
      const parentPath = resourcePath.slice(0, resourcePath.lastIndexOf("/"));
      const p = parentPath ? byResourcePath.get(parentPath) : undefined;
      if (p) parent = p;
    }

    let unitPath = i === 0 ? rootPath : `${parent?.unitPath ?? rootPath}/${resourceName || String(i)}`;
    if (seenPaths.has(unitPath)) unitPath = `${unitPath}[${i}]`;
    seenPaths.add(unitPath);

    const input: ContentUnit["input"] = text !== undefined ? "text" : isImage ? "image" : "metadata";
    const unit: ContentUnit = {
      id: `tika-${i}`,
      ...(parent ? { parent: parent.id } : {}),
      depth: baseDepth + embeddedDepth,
      format: formatFor(contentType, resourceName ?? (i === 0 ? hints.filename : undefined)),
      sniffedBy: "sidecar",
      input,
      ...(text !== undefined ? { text } : {}),
      metadata: keepMetadata(doc),
      ...(resourceName || (i === 0 && hints.filename) ? { filename: resourceName ?? hints.filename } : {}),
      ...(contentType ? { contentType } : {}),
      truncated: isTruncated(doc, text),
      unitPath,
      extractor: extractorId,
    };
    units.push(unit);
    if (resourcePath) byResourcePath.set(resourcePath, unit);
  });
  return units;
}

/* ------------------------------------------------------------------ *
 * The client
 * ------------------------------------------------------------------ */

export interface TikaClientOptions {
  /** Override endpoint resolution (tests). */
  endpoint?: Partial<TikaEndpoint>;
  /** Override limits (tests use a small maxBytes / short timeout). */
  limits?: Partial<ExtractorDescriptor["limits"]>;
  availabilityTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function fail(state: UninspectableState, reason: string, extra: { unitPath?: string; partialUnits?: ContentUnit[] } = {}): ExtractionResult {
  return { ok: false, uninspectable: { state, reason, ...extra }, extractor: TIKA_DESCRIPTOR.id };
}

async function readBounded(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!res.body) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > max) { try { await res.body.cancel(); } catch { /* already closed */ } return null; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function createTikaExtractor(opts: TikaClientOptions = {}): ExtractorImpl {
  const limits = { ...TIKA_DESCRIPTOR.limits, ...(opts.limits ?? {}) };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = (): TikaEndpoint => ({ ...resolveTikaEndpoint(), ...(opts.endpoint ?? {}) });
  const base = (ep: TikaEndpoint) => ep.url.replace(/\/+$/, "");

  return {
    descriptor: TIKA_DESCRIPTOR,

    async available() {
      const ep = endpoint();
      const refusal = endpointRefusal(ep);
      if (refusal) return { ok: false, reason: refusal };
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.availabilityTimeoutMs ?? AVAILABILITY_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${base(ep)}/version`, { method: "GET", signal: ac.signal });
        if (!res.ok) return { ok: false, reason: `tika sidecar /version returned HTTP ${res.status}` };
        const body = (await readBounded(res, 4096)) ?? "";
        return /tika/i.test(body) ? { ok: true } : { ok: false, reason: `endpoint at ${ep.url} does not identify as Apache Tika` };
      } catch (e) {
        const msg = e instanceof Error && e.name === "AbortError" ? "no answer within availability timeout" : (e as Error)?.message ?? String(e);
        return { ok: false, reason: `tika sidecar unreachable at ${ep.url}: ${msg}` };
      } finally {
        clearTimeout(timer);
      }
    },

    async extract(bytes, hints) {
      try {
        const ep = endpoint();
        const refusal = endpointRefusal(ep);
        if (refusal) return fail("PARSER_FAILURE", refusal, { unitPath: hints.unitPath });
        const unitPath = hints.unitPath ?? "root";
        const depth = hints.depth ?? 0;
        if (bytes.byteLength > limits.maxBytes) return fail("OVERSIZE", `${bytes.byteLength} bytes exceeds the ${limits.maxBytes}-byte inspection limit; not sent to the sidecar`, { unitPath });
        if (depth > limits.maxDepth) return fail("DEPTH_EXCEEDED", `container depth ${depth} exceeds the limit of ${limits.maxDepth}`, { unitPath });

        const remainingDepth = limits.maxDepth - depth;
        const headers: Record<string, string> = {
          Accept: "application/json",
          maxEmbeddedResources: String(limits.maxEntries ?? 0),
          writeLimit: String(WRITE_LIMIT),
          unpackMaxBytes: String(limits.maxDecompressedBytes ?? 0),
        };
        if (hints.contentType) headers["Content-Type"] = hints.contentType;
        if (remainingDepth === 0) headers["X-Tika-Skip-Embedded"] = "true";

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), limits.timeoutMs);
        let res: Response;
        try {
          res = await fetchImpl(`${base(ep)}/rmeta/text`, { method: "PUT", headers, body: new Uint8Array(bytes), signal: ac.signal });
        } catch (e) {
          clearTimeout(timer);
          if (e instanceof Error && e.name === "AbortError") return fail("TIMEOUT", `tika sidecar did not answer within ${limits.timeoutMs} ms`, { unitPath });
          return fail("PARSER_FAILURE", `tika sidecar request failed: ${(e as Error)?.message ?? String(e)}`, { unitPath });
        }

        try {
          if (res.status === 422) {
            const body = (await readBounded(res, 64 * 1024)) ?? "";
            if (/encrypt|password/i.test(body)) return fail("ENCRYPTED", "tika reported the document is encrypted or password protected", { unitPath });
            return fail("UNSUPPORTED_FORMAT", `tika could not process the document (HTTP 422)`, { unitPath });
          }
          if (res.status === 415) return fail("UNSUPPORTED_FORMAT", "tika has no parser for this media type (HTTP 415)", { unitPath });
          if (res.status >= 500) return fail("PARSER_FAILURE", `tika sidecar error HTTP ${res.status}`, { unitPath });
          if (res.status === 204) return fail("PARSER_FAILURE", "tika returned no content for the document (HTTP 204)", { unitPath });
          if (!res.ok) return fail("PARSER_FAILURE", `unexpected tika response HTTP ${res.status}`, { unitPath });

          const text = await readBounded(res, MAX_REPLY_BYTES);
          if (text === null) return fail("PARSER_FAILURE", `tika reply exceeded the ${MAX_REPLY_BYTES}-byte bound`, { unitPath });
          let docs: unknown;
          try { docs = JSON.parse(text); } catch { return fail("PARSER_FAILURE", "tika reply was not valid rmeta JSON", { unitPath }); }
          if (!Array.isArray(docs) || docs.length === 0 || docs.some((d) => !d || typeof d !== "object")) {
            return fail("PARSER_FAILURE", "tika reply was not a non-empty rmeta array", { unitPath });
          }
          const units = unitsFromRmeta(docs as RmetaDoc[], hints, TIKA_DESCRIPTOR.id);
          const tooDeep = units.find((u) => u.depth > limits.maxDepth);
          if (tooDeep) {
            return fail("DEPTH_EXCEEDED", `embedded document at depth ${tooDeep.depth} exceeds the limit of ${limits.maxDepth}`,
              { unitPath: tooDeep.unitPath, partialUnits: units.filter((u) => u.depth <= limits.maxDepth) });
          }
          return { ok: true, units, extractor: TIKA_DESCRIPTOR.id };
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return fail("TIMEOUT", `tika sidecar reply did not complete within ${limits.timeoutMs} ms`, { unitPath });
          return fail("PARSER_FAILURE", `tika reply could not be read: ${(e as Error)?.message ?? String(e)}`, { unitPath });
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        return fail("PARSER_FAILURE", `tika client failure: ${(e as Error)?.message ?? String(e)}`, { unitPath: hints.unitPath });
      }
    },
  };
}

/** The module's extractor: resolves the endpoint from env/config on every call so a config edit takes effect without a restart. */
export const extractor: ExtractorImpl = createTikaExtractor();
