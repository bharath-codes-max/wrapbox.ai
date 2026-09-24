/**
 * OCR extractor (Tier 1, device helper) — descriptor `wrapbox.ocr.vision`.
 *
 * Images and scanned PDFs carry text the Tier 0 parsers cannot see, so without
 * OCR a screenshot of a customer list sails past every content clause. Apple
 * Vision does the recognition on-device, but it only exists as a native
 * framework, and the daemon never loads native code into the process that
 * parses untrusted bytes. The recognition therefore runs in a short-lived,
 * time-boxed child (`macos/ocr/wrapbox-ocr`) that reads one temp file and
 * prints one JSON line per page. This module owns the boundary: it writes the
 * bytes to a 0600 temp file, spawns the helper with the descriptor's timeout,
 * turns the lines into ContentUnits and always removes the file.
 *
 * FAIL CLOSED. Anything other than a clean exit with well-formed JSON becomes an
 * explicit UNINSPECTABLE state — a missing helper, a crash, a timeout, an
 * oversize body, malformed output — never an empty unit list that a clause
 * would read as "no findings". The state mapping mirrors the helper's exit
 * codes: 2 → PARSER_FAILURE, 3 → UNSUPPORTED_FORMAT, kill-on-timeout → TIMEOUT.
 *
 * Helper discovery (first hit wins): WRAPBOX_OCR_HELPER, then
 * WRAPBOX_HOME/bin/wrapbox-ocr, then the repo build at macos/ocr/build/
 * wrapbox-ocr (resolved relative to this file so dist/ and src/ agree).
 * `available()` reports the real state; nothing here pretends.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_EXTRACTORS } from "@wrapbox/registry";
import type { ContentUnit, ExtractionResult, ExtractorDescriptor, UninspectableState } from "@wrapbox/registry";

/** Plugin contract from runtime/src/detectors/PLUGIN-SPEC.md (not yet in the registry package). */
export interface ExtractorImpl {
  descriptor: ExtractorDescriptor;
  available(): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
  extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractionResult>;
}
export interface ExtractHints { filename?: string; contentType?: string; unitPath?: string; depth?: number }

export const DESCRIPTOR: ExtractorDescriptor = BUILTIN_EXTRACTORS.find((e) => e.id === "wrapbox.ocr.vision")!;

/** Page cap the helper enforces (MAX_PAGES in wrapbox-ocr.swift); hitting it marks the last unit truncated. */
export const HELPER_MAX_PAGES = 50;
/** Hard cap on helper stdout: 50 pages of dense text is well under 1 MiB; anything near this is not OCR output. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 4096;

export let lastError: string | null = null;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_BUILD = path.resolve(HERE, "..", "..", "..", "macos", "ocr", "build", "wrapbox-ocr");

function homeDir(): string {
  return process.env.WRAPBOX_HOME || path.join(os.homedir(), ".wrapbox");
}

/** Candidate helper locations in precedence order (unset env entries are skipped). */
export function helperCandidates(): string[] {
  const out: string[] = [];
  if (process.env.WRAPBOX_OCR_HELPER) out.push(process.env.WRAPBOX_OCR_HELPER);
  out.push(path.join(homeDir(), "bin", "wrapbox-ocr"), REPO_BUILD);
  return out;
}

/** First candidate that exists and is executable, or null. */
export function helperPath(): string | null {
  for (const p of helperCandidates()) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch { /* try the next one */ }
  }
  return null;
}

export function available(): { ok: boolean; reason?: string } {
  if (process.platform !== "darwin") return { ok: false, reason: "Apple Vision OCR runs only on macOS" };
  const p = helperPath();
  if (!p) return { ok: false, reason: `wrapbox-ocr helper not found (looked in: ${helperCandidates().join(", ")})` };
  return { ok: true };
}

function fail(state: UninspectableState, reason: string, unitPath?: string): ExtractionResult {
  lastError = `${state}: ${reason}`;
  return { ok: false, uninspectable: { state, reason, ...(unitPath ? { unitPath } : {}) }, extractor: DESCRIPTOR.id };
}

interface HelperPage { page: number; text: string; confidence: number }

/** Parse the helper's JSON lines strictly: any malformed line poisons the whole result (fail closed). */
function parsePages(stdout: string): HelperPage[] | string {
  const pages: HelperPage[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { return "helper emitted a non-JSON line"; }
    if (!obj || typeof obj !== "object") return "helper emitted a non-object line";
    const { page, text, confidence } = obj as Record<string, unknown>;
    if (!Number.isInteger(page) || (page as number) < 1) return "helper page number invalid";
    if (typeof text !== "string") return "helper page text missing";
    if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)) return "helper confidence out of range";
    pages.push({ page: page as number, text, confidence });
  }
  if (pages.length === 0) return "helper exited 0 without emitting a page";
  return pages;
}

interface RunResult { code: number | null; timedOut: boolean; overflowed: boolean; spawnError?: string; stdout: string; stderr: string }

function runHelper(helper: string, file: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = []; let outLen = 0;
    const err: Buffer[] = []; let errLen = 0;
    let timedOut = false, overflowed = false, killed = false, done = false, spawnError: string | undefined;
    // Own process group so a kill reaches anything the helper spawned; a
    // grandchild holding our pipes must not be able to outlive the time box.
    const child = spawn(helper, [file], { stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" }, detached: true });
    const killGroup = () => {
      killed = true;
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    };
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, timedOut, overflowed, spawnError, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8").slice(0, MAX_STDERR_BYTES) });
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      outLen += b.length;
      if (outLen > MAX_OUTPUT_BYTES) { overflowed = true; killGroup(); return; }
      out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => { if (errLen < MAX_STDERR_BYTES) { err.push(b); errLen += b.length; } });
    child.on("error", (e) => { spawnError = e.message; finish(null); });
    // Normal path waits for the pipes to drain ("close"); after a kill the
    // process exit is the end of the story — whatever is left in the pipes is
    // discarded output from a helper we no longer trust.
    child.on("exit", (code) => { if (killed) finish(code); });
    child.on("close", (code) => finish(code));
  });
}

/** Full extraction with an explicit helper/timeout — the test hook; `extractor.extract` uses the descriptor's values. */
export async function extractWith(bytes: Buffer, hints: ExtractHints, opts: { helper?: string | null; timeoutMs?: number } = {}): Promise<ExtractionResult> {
  lastError = null;
  const timeoutMs = opts.timeoutMs ?? DESCRIPTOR.limits.timeoutMs;
  if (bytes.length > DESCRIPTOR.limits.maxBytes) return fail("OVERSIZE", `body ${bytes.length} bytes exceeds OCR limit ${DESCRIPTOR.limits.maxBytes}`, hints.unitPath);
  if (bytes.length === 0) return fail("MALFORMED", "empty body", hints.unitPath);
  if (process.platform !== "darwin") return fail("PARSER_FAILURE", "Apple Vision OCR runs only on macOS", hints.unitPath);
  const helper = opts.helper === undefined ? helperPath() : opts.helper;
  if (!helper) return fail("PARSER_FAILURE", "wrapbox-ocr helper unavailable", hints.unitPath);

  // 0700 dir + 0600 file: the body may be sensitive and the helper is the only
  // reader. No extension — the helper sniffs the format from the bytes.
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrapbox-ocr-"));
    const file = path.join(dir, "input");
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    const r = await runHelper(helper, file, timeoutMs);
    const stderrLine = r.stderr.split("\n")[0]?.trim() ?? "";
    if (r.spawnError) return fail("PARSER_FAILURE", `helper could not start: ${r.spawnError}`, hints.unitPath);
    if (r.timedOut) return fail("TIMEOUT", `OCR helper exceeded ${timeoutMs} ms`, hints.unitPath);
    if (r.overflowed) return fail("OVERSIZE", `helper output exceeded ${MAX_OUTPUT_BYTES} bytes`, hints.unitPath);
    if (r.code === 3) return fail("UNSUPPORTED_FORMAT", stderrLine || "helper: unsupported input", hints.unitPath);
    if (r.code !== 0) return fail("PARSER_FAILURE", stderrLine || `helper exited ${r.code ?? "by signal"}`, hints.unitPath);
    const pages = parsePages(r.stdout);
    if (typeof pages === "string") return fail("PARSER_FAILURE", pages, hints.unitPath);

    const depth = hints.depth ?? 0;
    const base = hints.unitPath ? `${hints.unitPath}/` : "";
    const capped = pages.length >= HELPER_MAX_PAGES;
    const units: ContentUnit[] = pages.map((p, i): ContentUnit => ({
      id: `${base}ocr[${p.page}]`,
      depth,
      format: "ocr",
      sniffedBy: "magic",
      input: "text",
      text: p.text,
      metadata: {
        source: "ocr",
        page: String(p.page),
        confidence: p.confidence.toFixed(3),
        ...(capped && i === pages.length - 1 ? { pageCap: String(HELPER_MAX_PAGES) } : {}),
      },
      ...(hints.filename ? { filename: hints.filename } : {}),
      ...(hints.contentType ? { contentType: hints.contentType } : {}),
      truncated: capped && i === pages.length - 1,
      unitPath: `${base}ocr[${p.page}]`,
      extractor: DESCRIPTOR.id,
    }));
    return { ok: true, units, extractor: DESCRIPTOR.id };
  } catch (e) {
    return fail("PARSER_FAILURE", `OCR boundary error: ${(e as Error).message}`, hints.unitPath);
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort; the dir is 0700 in tmp */ } }
  }
}

export const extractor: ExtractorImpl = {
  descriptor: DESCRIPTOR,
  available,
  extract: (bytes, hints) => extractWith(bytes, hints),
};
