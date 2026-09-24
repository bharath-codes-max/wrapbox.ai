/**
 * Detector "wrapbox.semantic.onnx" — local semantic (document-category) classifier.
 *
 * WHY THIS EXISTS. FINANCIAL, PHI and LEGAL keep their multi-signal built-ins;
 * this module is the EXTENSIBLE path: a tenant drops a small ONNX text
 * classifier plus a manifest under WRAPBOX_HOME/models and a SEMANTIC.* type
 * (built-in such as SEMANTIC.M_AND_A, or a tenant one, SEMANTIC.TENANT.<X>)
 * becomes ENFORCED on this device. With no model present the detector says
 * exactly that — it never guesses a category from keywords and calls it a
 * model.
 *
 * MANIFEST (WRAPBOX_HOME/models/<name>.json; relative paths resolve against
 * the manifest's directory):
 *   { "id": "acme-mna", "version": "1.0.0", "type": "SEMANTIC.M_AND_A",
 *     "labels": ["other", "m_and_a"], "negative": ["other"], "threshold": 0.6,
 *     "model": "mna.onnx",
 *     "tokenizer": { "kind": "wordpiece" | "bow", "vocab": "vocab.txt", "maxLen": 256 },
 *     "inputs": { "ids": "input_ids", "mask": "attention_mask", "typeIds": "token_type_ids" },
 *     "output": "logits", "license": "…", "provenance": "…" }
 *   `negative` names labels that mean "not this category" (a binary model's
 *   rest class); the best label being negative yields no finding. `threshold`
 *   is the MODEL'S decision boundary — the probability below which the model
 *   itself is not claiming anything — not a policy threshold; the clause's
 *   `match.minConfidence` still decides what counts.
 *
 * HOW A HIT IS FORMED. The unit text (capped at MAX_TEXT_BYTES) is tokenised
 * by the manifest's tokenizer — WordPiece (lower-case, accent-stripped, basic
 * punctuation split, ## continuations, [CLS]/[SEP], pad/truncate to maxLen)
 * or bag-of-words (vocab index → count vector, so a tiny linear model works) —
 * the session runs, the logits are soft-maxed and the best label maps to the
 * manifest's type when its probability ≥ threshold. Confidence is HIGH at
 * ≥ 0.9, MEDIUM otherwise. One finding per manifest, count 1 (a category is
 * one claim about the unit, not a value); the Finding carries the model id
 * and label name, never text.
 *
 * WHY A WORKER THREAD. `DetectorImpl.detect()` is synchronous and ORT's run()
 * is a promise, so inference runs in a worker and the main thread blocks on
 * `Atomics.wait` with the remaining budget. That is also what makes the time
 * box REAL: a synchronous native call cannot be interrupted, a worker can be
 * terminated. A timeout or a dead worker fails closed (`[]` + lastError) and
 * the worker is respawned lazily. Sessions are cached per manifest inside
 * the worker and reloaded when the model file changes.
 *
 * `available()` is honest: ok only when onnxruntime-node loads in the worker
 * AND at least one manifest validates AND its model and vocab files exist.
 * The reason lists everything missing so `wrapboxd capabilities` can show it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { DetectorImpl, DetectInput, Finding, DetectorDescriptor, DataType } from "@wrapbox/registry";
import { dataTypes, BUILTIN_DETECTORS } from "@wrapbox/registry";

const BUILTIN = BUILTIN_DETECTORS.find((d) => d.id === "wrapbox.semantic.onnx")!;
/** The registry lists "medium" as this detector's best; a calibrated model at p ≥ 0.9 is reported HIGH, so declare that. */
export const DESCRIPTOR: DetectorDescriptor = { ...BUILTIN, emits: [{ type: "SEMANTIC", confidence: "high" }] };

/** Text handed to a model per unit; anything beyond is dropped (a category is decided by the opening, not the tail). */
export const MAX_TEXT_BYTES = 64 * 1024;
/** Wall-clock budget for one detect() call across every manifest; exceeding it is a failure, not a partial answer. */
export const DETECT_BUDGET_MS = 2000;
/** How long the worker may take to load onnxruntime-node before availability is reported as failed. */
export const ORT_LOAD_BUDGET_MS = 10_000;
/** Probability at which a finding is HIGH rather than MEDIUM. */
export const HIGH_CONFIDENCE_P = 0.9;
/** Shared result buffer: 8 header bytes + logits or an error message. Bounds the label count a model may have. */
const RESULT_BYTES = 16 * 1024;
export const MAX_LABELS = (RESULT_BYTES - 8) / 4;
const MAX_MANIFESTS = 32;
const MAX_VOCAB_ENTRIES = 250_000;
const MAX_WORD_CHARS = 100;
const TENANT_TYPE_RE = /^SEMANTIC\.TENANT\.[A-Z][A-Z0-9_]*$/;

export let lastError: string | null = null;

/* ------------------------------------------------------------------ *
 * Manifests
 * ------------------------------------------------------------------ */

export const ManifestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  version: z.string().min(1).max(32),
  type: z.string().regex(/^SEMANTIC(\.[A-Z][A-Z0-9_]*)+$/),
  label: z.string().max(96).optional(),
  labels: z.array(z.string().min(1).max(64)).min(1).max(MAX_LABELS),
  negative: z.array(z.string().min(1).max(64)).optional(),
  threshold: z.number().min(0).max(1),
  model: z.string().min(1),
  tokenizer: z.object({
    kind: z.enum(["wordpiece", "bow"]),
    vocab: z.string().min(1),
    maxLen: z.number().int().min(4).max(8192),
  }),
  inputs: z.object({ ids: z.string().min(1), mask: z.string().min(1).optional(), typeIds: z.string().min(1).optional() }),
  output: z.string().min(1),
  license: z.string().max(256).optional(),
  provenance: z.string().max(512).optional(),
}).strict();
export type Manifest = z.infer<typeof ManifestSchema>;

export interface LoadedManifest {
  file: string;
  manifest: Manifest;
  modelPath: string;
  vocabPath: string;
  /** Changes when the model file changes → new worker session. */
  sessionKey: string;
  vocab: Map<string, number>;
  negative: Set<string>;
}

/** Resolved at call time so tests and multi-instance runs can point WRAPBOX_HOME elsewhere. */
export function modelsDir(): string {
  return path.join(process.env.WRAPBOX_HOME || path.join(os.homedir(), ".wrapbox"), "models");
}

/** Validate a raw manifest object; returns the parsed manifest or a one-line problem. Registers SEMANTIC.TENANT.* types. */
export function validateManifest(raw: unknown, baseDir: string): { ok: true; manifest: Manifest; modelPath: string; vocabPath: string } | { ok: false; problem: string } {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, problem: `${issue.path.join(".") || "manifest"}: ${issue.message}` };
  }
  const m = parsed.data;
  const dup = m.labels.find((l, i) => m.labels.indexOf(l) !== i);
  if (dup) return { ok: false, problem: `labels: duplicate "${dup}"` };
  const badNeg = (m.negative ?? []).find((n) => !m.labels.includes(n));
  if (badNeg) return { ok: false, problem: `negative: "${badNeg}" is not one of labels` };
  if ((m.negative ?? []).length >= m.labels.length) return { ok: false, problem: "negative: every label is negative; the model can never emit" };
  if (m.tokenizer.kind === "bow" && (m.inputs.mask || m.inputs.typeIds)) return { ok: false, problem: "inputs: a bow tokenizer feeds only `ids`" };
  const reg = dataTypes();
  if (!reg.has(m.type)) {
    if (!TENANT_TYPE_RE.test(m.type)) return { ok: false, problem: `type: ${m.type} is not in the registry (tenant types are SEMANTIC.TENANT.<NAME>)` };
    registerTenantType(m.type, m.label);
  }
  const modelPath = path.resolve(baseDir, m.model);
  const vocabPath = path.resolve(baseDir, m.tokenizer.vocab);
  if (!fs.existsSync(modelPath)) return { ok: false, problem: `model file missing: ${modelPath}` };
  if (!fs.existsSync(vocabPath)) return { ok: false, problem: `vocab file missing: ${vocabPath}` };
  return { ok: true, manifest: m, modelPath, vocabPath };
}

/** A tenant classifier type the registry does not know yet, registered as configured (a manifest exists). */
function registerTenantType(type: string, label?: string): void {
  const reg = dataTypes();
  if (reg.has(type)) return;
  const name = type.slice("SEMANTIC.TENANT.".length);
  const d: DataType = {
    id: type, parent: "SEMANTIC", label: label || `${name.replace(/_/g, " ").toLowerCase()} (tenant classifier)`, aliases: [],
    inputs: ["text"],
    transforms: { REDACT: "not_applicable", MASK: "not_applicable", REVERSIBLE_TOKENIZE: "not_applicable", HASH: "not_applicable", DROP_FIELD: "supported" },
    actions: ["ALLOW", "REVIEW", "BLOCK"],
    locality: "device",
    tenantConfig: { required: true, kind: "model" },
    defaults: { minCount: 1, minConfidence: "medium" },
    evidence: ["label", "count", "confidence", "detector", "detector_version", "unit_path"],
    status: "beta",
    legacyKind: "confidential",
  };
  reg.add(d);
}

/**
 * One token per line, index = line number (the standard vocab.txt layout, used
 * by both tokenizers). A blank or repeated line would silently shift every
 * index after it against the model's embedding table, so both are refused.
 */
export function loadVocab(file: string): Map<string, number> {
  const lines = fs.readFileSync(file, "utf-8").split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > MAX_VOCAB_ENTRIES) throw new Error(`vocab exceeds ${MAX_VOCAB_ENTRIES} entries`);
  const vocab = new Map<string, number>();
  lines.forEach((tok, i) => {
    if (tok === "") throw new Error(`vocab line ${i + 1} is empty`);
    if (vocab.has(tok)) throw new Error(`vocab line ${i + 1} repeats an earlier token`);
    vocab.set(tok, i);
  });
  if (vocab.size === 0) throw new Error("vocab is empty");
  return vocab;
}

interface ManifestCache { stamp: string; dir: string; manifests: LoadedManifest[]; problems: string[] }
let manifestCache: ManifestCache | null = null;

/** Directory fingerprint: manifest names + mtimes + sizes. Cheap enough to run per call. */
function stamp(dir: string): string {
  const parts: string[] = [];
  try {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      try { const st = fs.statSync(path.join(dir, f)); parts.push(`${f}:${st.mtimeMs}:${st.size}`); } catch { parts.push(f); }
    }
  } catch { return ""; }
  return parts.join("|");
}

/** Every manifest under WRAPBOX_HOME/models, validated; problems are reported, never hidden. */
export function loadManifests(force = false): { dir: string; manifests: LoadedManifest[]; problems: string[] } {
  const dir = modelsDir();
  const s = stamp(dir);
  if (!force && manifestCache && manifestCache.dir === dir && manifestCache.stamp === s) return manifestCache;
  const manifests: LoadedManifest[] = [];
  const problems: string[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { /* no directory → no manifests */ }
  if (files.length > MAX_MANIFESTS) { problems.push(`more than ${MAX_MANIFESTS} manifests; extra ignored`); files = files.slice(0, MAX_MANIFESTS); }
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
      const v = validateManifest(raw, dir);
      if (!v.ok) { problems.push(`${f}: ${v.problem}`); continue; }
      const vocab = loadVocab(v.vocabPath);
      if (v.manifest.tokenizer.kind === "wordpiece") {
        const missing = ["[CLS]", "[SEP]", "[PAD]", "[UNK]"].filter((t) => !vocab.has(t));
        if (missing.length) { problems.push(`${f}: vocab lacks ${missing.join(", ")}`); continue; }
      }
      if (manifests.some((m) => m.manifest.id === v.manifest.id)) { problems.push(`${f}: duplicate manifest id "${v.manifest.id}"`); continue; }
      const st = fs.statSync(v.modelPath);
      manifests.push({
        file, manifest: v.manifest, modelPath: v.modelPath, vocabPath: v.vocabPath,
        sessionKey: `${v.modelPath}:${st.mtimeMs}:${st.size}`, vocab, negative: new Set(v.manifest.negative ?? []),
      });
    } catch (e) {
      problems.push(`${f}: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    }
  }
  manifestCache = { stamp: s, dir, manifests, problems };
  return manifestCache;
}

/* ------------------------------------------------------------------ *
 * Tokenizers
 * ------------------------------------------------------------------ */

/** BERT-style basic tokenisation: lower-case, strip accents, split on whitespace, every punctuation char its own token. */
export function basicTokens(text: string): string[] {
  const clean = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const out: string[] = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const ch of clean) {
    if (/\s/.test(ch) || ch === "\u0000" || ch === "�") { flush(); continue; }
    if (/[\p{P}\p{S}]/u.test(ch)) { flush(); out.push(ch); continue; }
    cur += ch;
  }
  flush();
  return out;
}

export interface Encoded { ids: BigInt64Array; mask: BigInt64Array; tokens: number }

/** Greedy longest-match WordPiece with [CLS]/[SEP], truncated to maxLen and padded with [PAD]. */
export function tokenizeWordPiece(text: string, vocab: Map<string, number>, maxLen: number): Encoded {
  const unk = vocab.get("[UNK]")!, cls = vocab.get("[CLS]")!, sep = vocab.get("[SEP]")!, pad = vocab.get("[PAD]")!;
  const body = maxLen - 2;
  const pieces: number[] = [];
  outer: for (const word of basicTokens(text)) {
    if (pieces.length >= body) break;
    if (word.length > MAX_WORD_CHARS) { pieces.push(unk); continue; }
    const wordPieces: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let found: number | undefined;
      while (start < end) {
        const sub = (start > 0 ? "##" : "") + word.slice(start, end);
        const id = vocab.get(sub);
        if (id !== undefined) { found = id; break; }
        end--;
      }
      if (found === undefined) { pieces.push(unk); continue outer; }
      wordPieces.push(found);
      start = end;
    }
    for (const p of wordPieces) { if (pieces.length >= body) break; pieces.push(p); }
  }
  const ids = new BigInt64Array(maxLen).fill(BigInt(pad));
  const mask = new BigInt64Array(maxLen);
  const seq = [cls, ...pieces, sep];
  for (let i = 0; i < seq.length; i++) { ids[i] = BigInt(seq[i]); mask[i] = 1n; }
  return { ids, mask, tokens: seq.length };
}

/** Bag of words: one float per vocab entry holding that token's count in the text. Out-of-vocab tokens are dropped. */
export function tokenizeBow(text: string, vocab: Map<string, number>): Float32Array {
  const counts = new Float32Array(vocab.size);
  for (const tok of basicTokens(text)) {
    const i = vocab.get(tok);
    if (i !== undefined && i < counts.length) counts[i] += 1;
  }
  return counts;
}

export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps: number[] = [];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { const e = Math.exp(logits[i] - max); exps.push(e); sum += e; }
  return exps.map((e) => (sum > 0 ? e / sum : 0));
}

/* ------------------------------------------------------------------ *
 * Inference worker — plain CommonJS so it runs identically under tsx and dist
 * ------------------------------------------------------------------ */

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");
const status = new Int32Array(workerData.sab, 0, 2);
const bytes = new Uint8Array(workerData.sab, 8);
const enc = new TextEncoder();
function reply(code, payload) {
  const n = Math.min(payload.length, bytes.length);
  bytes.set(payload.subarray(0, n));
  Atomics.store(status, 1, n);
  Atomics.store(status, 0, code);
  Atomics.notify(status, 0);
}
function fail(e) { reply(2, enc.encode(String(e && e.message || e).slice(0, 1024))); }
const sessions = new Map();
let ort = null;
(async () => {
  try {
    const m = await import(pathToFileURL(workerData.ortPath).href);
    ort = m.default && m.default.InferenceSession ? m.default : m;
    if (!ort.InferenceSession || !ort.Tensor) throw new Error("module exports no InferenceSession");
    reply(1, new Uint8Array(0));
  } catch (e) { fail("onnxruntime-node failed to load: " + (e && e.message || e)); return; }
  parentPort.on("message", async (req) => {
    try {
      let s = sessions.get(req.sessionKey);
      if (!s) {
        s = await ort.InferenceSession.create(req.modelPath, { executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1, logSeverityLevel: 3 });
        if (sessions.size >= req.maxSessions) sessions.delete(sessions.keys().next().value);
        sessions.set(req.sessionKey, s);
      }
      const feeds = {};
      for (const f of req.feeds) {
        if (!s.inputNames.includes(f.name)) throw new Error("model has no input named " + f.name + " (inputs: " + s.inputNames.join(", ") + ")");
        feeds[f.name] = new ort.Tensor(f.dtype, f.data, f.dims);
      }
      const missing = s.inputNames.filter((n) => !(n in feeds));
      if (missing.length) throw new Error("model inputs not fed by the manifest: " + missing.join(", "));
      if (!s.outputNames.includes(req.output)) throw new Error("model has no output named " + req.output + " (outputs: " + s.outputNames.join(", ") + ")");
      const out = await s.run(feeds, [req.output]);
      const t = out[req.output];
      if (!t) throw new Error("output " + req.output + " not produced");
      const arr = Float32Array.from(t.data, Number);
      reply(1, new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
    } catch (e) { fail(e); }
  });
})();
`;

interface Runner { worker: Worker; status: Int32Array; bytes: Uint8Array; alive: boolean }
let runner: Runner | null = null;
let ortState: { ok: true } | { ok: false; reason: string } | null = null;
const MAX_SESSIONS = 8;

function ortPath(): string {
  return createRequire(import.meta.url).resolve("onnxruntime-node");
}

function spawn(): Runner {
  const sab = new SharedArrayBuffer(RESULT_BYTES);
  const status = new Int32Array(sab, 0, 2);
  const bytes = new Uint8Array(sab, 8);
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { sab, ortPath: ortPath() }, stdout: true, stderr: true });
  const r: Runner = { worker, status, bytes, alive: true };
  worker.on("error", () => { r.alive = false; });
  worker.on("exit", () => { r.alive = false; });
  worker.unref();
  return r;
}

/** Block until the worker answers or the budget lapses; a lapsed budget terminates the worker (it is respawned lazily). */
function waitReply(r: Runner, budgetMs: number): Float32Array {
  const res = Atomics.wait(r.status, 0, 0, Math.max(1, budgetMs));
  if (res === "timed-out") {
    r.alive = false;
    void r.worker.terminate();
    throw new Error(`inference exceeded ${budgetMs} ms and was terminated`);
  }
  const code = Atomics.load(r.status, 0);
  const n = Atomics.load(r.status, 1);
  if (code === 2) throw new Error(new TextDecoder().decode(r.bytes.slice(0, n)));
  return new Float32Array(r.bytes.slice(0, n).buffer);
}

/** Load onnxruntime-node in the worker once; the answer is cached for the process (a missing binary does not appear later). */
function ensureOrt(): { ok: true } | { ok: false; reason: string } {
  if (ortState && !ortState.ok) return ortState;
  if (runner && runner.alive) return { ok: true };
  try {
    ortPath();
  } catch (e) {
    ortState = { ok: false, reason: `onnxruntime-node is not installed (${(e as Error).message.split("\n")[0].slice(0, 120)})` };
    return ortState;
  }
  try {
    runner = spawn();
    waitReply(runner, ORT_LOAD_BUDGET_MS);
    ortState = { ok: true };
  } catch (e) {
    runner = null;
    ortState = { ok: false, reason: (e as Error).message.slice(0, 200) };
  }
  return ortState;
}

interface Feed { name: string; dtype: "int64" | "float32"; dims: number[]; data: BigInt64Array | Float32Array }

function runModel(m: LoadedManifest, feeds: Feed[], budgetMs: number): Float32Array {
  const o = ensureOrt();
  if (!o.ok) throw new Error(o.reason);
  const r = runner!;
  Atomics.store(r.status, 0, 0);
  Atomics.store(r.status, 1, 0);
  r.worker.postMessage({ sessionKey: m.sessionKey, modelPath: m.modelPath, feeds, output: m.manifest.output, maxSessions: MAX_SESSIONS });
  return waitReply(r, budgetMs);
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

export interface Classification { manifest: string; type: string; label: string; probability: number; emitted: boolean }

function feedsFor(m: LoadedManifest, text: string): Feed[] {
  const { tokenizer, inputs } = m.manifest;
  if (tokenizer.kind === "bow") {
    const counts = tokenizeBow(text, m.vocab);
    return [{ name: inputs.ids, dtype: "float32", dims: [1, counts.length], data: counts }];
  }
  const enc = tokenizeWordPiece(text, m.vocab, tokenizer.maxLen);
  const feeds: Feed[] = [{ name: inputs.ids, dtype: "int64", dims: [1, tokenizer.maxLen], data: enc.ids }];
  if (inputs.mask) feeds.push({ name: inputs.mask, dtype: "int64", dims: [1, tokenizer.maxLen], data: enc.mask });
  if (inputs.typeIds) feeds.push({ name: inputs.typeIds, dtype: "int64", dims: [1, tokenizer.maxLen], data: new BigInt64Array(tokenizer.maxLen) });
  return feeds;
}

/** Run one manifest over text and interpret the logits. Throws on any model-side problem — the caller fails closed. */
export function classify(m: LoadedManifest, text: string, budgetMs = DETECT_BUDGET_MS): Classification {
  const logits = runModel(m, feedsFor(m, text), budgetMs);
  const labels = m.manifest.labels;
  if (logits.length !== labels.length) throw new Error(`${m.manifest.id}: model produced ${logits.length} logits for ${labels.length} labels`);
  const p = softmax(logits);
  let best = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
  const label = labels[best];
  const emitted = p[best] >= m.manifest.threshold && !m.negative.has(label);
  return { manifest: m.manifest.id, type: m.manifest.type, label, probability: p[best], emitted };
}

function capText(text: string): string {
  if (Buffer.byteLength(text, "utf-8") <= MAX_TEXT_BYTES) return text;
  return Buffer.from(text, "utf-8").subarray(0, MAX_TEXT_BYTES).toString("utf-8").replace(/�$/, "");
}

export function detectSemantic(input: DetectInput): Finding[] {
  if (input.input !== "text" || typeof input.text !== "string" || input.text.trim() === "") return [];
  const { manifests } = loadManifests();
  if (manifests.length === 0) return [];
  const text = capText(input.text);
  const deadline = Date.now() + DETECT_BUDGET_MS;
  const out: Finding[] = [];
  for (const m of manifests) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`budget of ${DETECT_BUDGET_MS} ms exhausted before ${m.manifest.id} ran`);
    const c = classify(m, text, remaining);
    if (!c.emitted) continue;
    out.push({
      type: c.type, count: 1, confidence: c.probability >= HIGH_CONFIDENCE_P ? "high" : "medium",
      detector: DESCRIPTOR.id, version: DESCRIPTOR.version,
      label: `${m.manifest.id}@${m.manifest.version}:${c.label}`,
      ...(input.unitPath ? { unitPath: input.unitPath } : {}),
    });
  }
  return out;
}

export function available(): { ok: boolean; reason?: string } {
  const reasons: string[] = [];
  const o = ensureOrt();
  if (!o.ok) reasons.push(o.reason);
  const { dir, manifests, problems } = loadManifests();
  if (manifests.length === 0) {
    reasons.push(problems.length
      ? `no usable semantic model in ${dir}: ${problems.join("; ")}`
      : `no semantic model installed: ${dir} has no manifest (*.json)`);
  } else if (problems.length) {
    // Usable models exist; still surface the broken ones so an admin sees them.
    reasons.push(`ignored: ${problems.join("; ")}`);
  }
  if (!o.ok || manifests.length === 0) return { ok: false, reason: reasons.join(" | ") };
  return reasons.length ? { ok: true, reason: reasons.join(" | ") } : { ok: true };
}

export const detector: DetectorImpl = {
  descriptor: DESCRIPTOR,
  available,
  detect(input: DetectInput): Finding[] {
    lastError = null;
    try {
      return detectSemantic(input);
    } catch (e) {
      lastError = `${DESCRIPTOR.id}: ${(e as Error).message.slice(0, 200)}`;
      return [];
    }
  },
};

/** Test hook: forget manifests and the worker so a test can change WRAPBOX_HOME or simulate a fresh process. */
export function _resetForTests(): void {
  manifestCache = null;
  ortState = null;
  if (runner) { void runner.worker.terminate(); runner = null; }
}
