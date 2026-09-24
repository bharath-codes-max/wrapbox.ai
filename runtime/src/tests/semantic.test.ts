/**
 * wrapbox.semantic.onnx — regression suite.
 *
 * Fixtures are generated here. The ONNX models are written by a minimal
 * protobuf encoder in this file (ModelProto → GraphProto → NodeProto /
 * TensorProto), so the end-to-end path — manifest → tokenizer → worker →
 * onnxruntime → softmax → Finding — runs against a REAL session with no
 * Python and no checked-in binary: a bag-of-words linear model (MatMul+Add)
 * and a WordPiece embedding-sum model (Gather → mask → ReduceSum). Every
 * Finding's JSON is searched for the sample text; the words must never leave
 * the detector. The unavailable paths (no manifests, broken manifests, a
 * missing model file) are asserted explicitly, since that is what
 * `wrapboxd capabilities` shows a tenant with no model installed.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "wrapbox-semantic-"));
process.env.WRAPBOX_HOME = home;
const models = path.join(home, "models");

const sem = await import("../detectors/semantic.js");
const { detector, validateManifest, loadManifests, loadVocab, tokenizeWordPiece, tokenizeBow, basicTokens, softmax, available, classify, _resetForTests, MAX_TEXT_BYTES } = sem;
const { dataTypes } = await import("@wrapbox/registry");

after(() => { _resetForTests(); fs.rmSync(home, { recursive: true, force: true }); });

/* ------------------------------------------------------------------ *
 * minimal protobuf writer — just enough of onnx.proto for a tiny graph
 * ------------------------------------------------------------------ */

function varint(n: number | bigint): Buffer {
  let v = BigInt(n);
  const out: number[] = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; out.push(b); } while (v > 0n);
  return Buffer.from(out);
}
const key = (field: number, wire: number) => varint((field << 3) | wire);
const fVarint = (field: number, n: number | bigint) => Buffer.concat([key(field, 0), varint(n)]);
const fBytes = (field: number, b: Buffer | string) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "utf-8"); return Buffer.concat([key(field, 2), varint(buf.length), buf]); };
const msg = (field: number, parts: Buffer[]) => fBytes(field, Buffer.concat(parts));

const FLOAT = 1, INT64 = 7;
function tensor(name: string, dims: number[], dtype: number, data: number[]): Buffer {
  const raw = dtype === FLOAT ? Buffer.from(new Float32Array(data).buffer) : Buffer.from(new BigInt64Array(data.map(BigInt)).buffer);
  return Buffer.concat([...dims.map((d) => fVarint(1, d)), fVarint(2, dtype), fBytes(8, name), fBytes(9, raw)]);
}
function valueInfo(name: string, dtype: number, dims: number[]): Buffer {
  const shape = Buffer.concat(dims.map((d) => msg(1, [fVarint(1, d)])));
  const tensorType = Buffer.concat([fVarint(1, dtype), msg(2, [shape])]);
  return Buffer.concat([fBytes(1, name), msg(2, [msg(1, [tensorType])])]);
}
type Attr = { name: string; i?: number; ints?: number[] };
function node(op: string, inputs: string[], outputs: string[], attrs: Attr[] = []): Buffer {
  const a = attrs.map((at) => msg(5, [
    fBytes(1, at.name),
    ...(at.i !== undefined ? [fVarint(3, at.i), fVarint(20, 2)] : []),
    ...(at.ints ? [...at.ints.map((x) => fVarint(8, x)), fVarint(20, 7)] : []),
  ]));
  return Buffer.concat([...inputs.map((x) => fBytes(1, x)), ...outputs.map((x) => fBytes(2, x)), fBytes(3, `${op}_${outputs[0]}`), fBytes(4, op), ...a]);
}
function model(nodes: Buffer[], inits: Buffer[], inputs: Buffer[], outputs: Buffer[]): Buffer {
  const graph = Buffer.concat([...nodes.map((n) => msg(1, [n])), fBytes(2, "wrapbox-test"), ...inits.map((t) => msg(5, [t])), ...inputs.map((v) => msg(11, [v])), ...outputs.map((v) => msg(12, [v]))]);
  return Buffer.concat([fVarint(1, 7), fBytes(2, "wrapbox-test"), msg(7, [graph]), msg(8, [fVarint(2, 11)])]);
}

/** Bag-of-words linear classifier: logits = counts · W + b. */
function bowModel(vocabSize: number, W: number[][], b: number[]): Buffer {
  const L = b.length;
  return model(
    [node("MatMul", ["input_ids", "W"], ["mm"]), node("Add", ["mm", "b"], ["logits"])],
    [tensor("W", [vocabSize, L], FLOAT, W.flat()), tensor("b", [L], FLOAT, b)],
    [valueInfo("input_ids", FLOAT, [1, vocabSize])],
    [valueInfo("logits", FLOAT, [1, L])],
  );
}

/** WordPiece embedding-sum classifier: logits = Σ_t mask[t] · E[input_ids[t]]. */
function wordpieceModel(vocabSize: number, maxLen: number, E: number[][]): Buffer {
  const L = E[0].length;
  return model(
    [
      node("Gather", ["E", "input_ids"], ["emb"], [{ name: "axis", i: 0 }]),
      node("Cast", ["attention_mask"], ["maskf"], [{ name: "to", i: FLOAT }]),
      node("Unsqueeze", ["maskf"], ["mask3"], [{ name: "axes", ints: [2] }]),
      node("Mul", ["emb", "mask3"], ["masked"]),
      node("ReduceSum", ["masked"], ["logits"], [{ name: "axes", ints: [1] }, { name: "keepdims", i: 0 }]),
    ],
    [tensor("E", [vocabSize, L], FLOAT, E.flat())],
    [valueInfo("input_ids", INT64, [1, maxLen]), valueInfo("attention_mask", INT64, [1, maxLen])],
    [valueInfo("logits", FLOAT, [1, L])],
  );
}

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

const WP_VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "merger", "acquisition", "##s", "weather", "sunny", "the", ".", "un", "##believ", "##able"];
const BOW_VOCAB = ["budget", "forecast", "quarter", "picnic", "beach"];

function writeFile(rel: string, data: Buffer | string): string {
  const p = path.join(models, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}
function clearModels(): void { fs.rmSync(models, { recursive: true, force: true }); _resetForTests(); }

const wpManifest = {
  id: "test-mna", version: "1.0.0", type: "SEMANTIC.M_AND_A", labels: ["other", "m_and_a"], negative: ["other"], threshold: 0.6,
  model: "mna.onnx", tokenizer: { kind: "wordpiece", vocab: "wp-vocab.txt", maxLen: 16 },
  inputs: { ids: "input_ids", mask: "attention_mask" }, output: "logits", license: "test", provenance: "generated in semantic.test.ts",
};
const bowManifest = {
  id: "test-forecast", version: "2.0.0", type: "SEMANTIC.TENANT.BUDGET_PLANNING", label: "Budget planning (tenant)", labels: ["other", "budget"], negative: ["other"], threshold: 0.7,
  model: "bow.onnx", tokenizer: { kind: "bow", vocab: "bow-vocab.txt", maxLen: 8 },
  inputs: { ids: "input_ids" }, output: "logits",
};

function installWordpiece(): void {
  // merger / acquisition push label 1; weather / sunny push label 0; everything else is neutral.
  const E = WP_VOCAB.map((tok) => (["merger", "acquisition"].includes(tok) ? [0, 3] : ["weather", "sunny"].includes(tok) ? [3, 0] : [0, 0]));
  writeFile("mna.onnx", wordpieceModel(WP_VOCAB.length, 16, E));
  writeFile("wp-vocab.txt", WP_VOCAB.join("\n") + "\n");
  writeFile("mna.json", JSON.stringify(wpManifest));
}
function installBow(): void {
  const W = BOW_VOCAB.map((tok) => (["budget", "forecast", "quarter"].includes(tok) ? [0, 2] : [2, 0]));
  writeFile("bow.onnx", bowModel(BOW_VOCAB.length, W, [0, 0]));
  writeFile("bow-vocab.txt", BOW_VOCAB.join("\n") + "\n");
  writeFile("bow.json", JSON.stringify(bowManifest));
}

/* ------------------------------------------------------------------ *
 * manifests
 * ------------------------------------------------------------------ */

test("manifest: a complete manifest validates and resolves paths against its directory", () => {
  clearModels();
  installWordpiece();
  const v = validateManifest(wpManifest, models);
  assert.ok(v.ok, (v as { problem?: string }).problem);
  if (v.ok) {
    assert.equal(v.modelPath, path.join(models, "mna.onnx"));
    assert.equal(v.vocabPath, path.join(models, "wp-vocab.txt"));
  }
});

test("manifest: bad shapes are rejected with the offending field named", () => {
  clearModels();
  installWordpiece();
  const cases: Array<[string, unknown, RegExp]> = [
    ["threshold out of range", { ...wpManifest, threshold: 1.5 }, /threshold/],
    ["non-SEMANTIC type", { ...wpManifest, type: "PII.CONTACT.EMAIL" }, /type/],
    ["unknown built-in SEMANTIC type", { ...wpManifest, type: "SEMANTIC.NOT_A_THING" }, /not in the registry/],
    ["empty labels", { ...wpManifest, labels: [] }, /labels/],
    ["duplicate labels", { ...wpManifest, labels: ["a", "a"] }, /duplicate/],
    ["negative not a label", { ...wpManifest, negative: ["nope"] }, /negative/],
    ["all labels negative", { ...wpManifest, labels: ["x"], negative: ["x"] }, /never emit/],
    ["unknown tokenizer", { ...wpManifest, tokenizer: { ...wpManifest.tokenizer, kind: "bpe" } }, /tokenizer\.kind/],
    ["bow with mask", { ...bowManifest, model: "mna.onnx", tokenizer: { ...bowManifest.tokenizer, vocab: "wp-vocab.txt" }, inputs: { ids: "x", mask: "m" } }, /bow tokenizer/],
    ["unknown key", { ...wpManifest, extra: 1 }, /extra|unrecognized/i],
    ["missing model file", { ...wpManifest, model: "nope.onnx" }, /model file missing/],
    ["missing vocab file", { ...wpManifest, tokenizer: { ...wpManifest.tokenizer, vocab: "nope.txt" } }, /vocab file missing/],
    ["not an object", "hello", /manifest|expected/i],
  ];
  for (const [name, raw, re] of cases) {
    const v = validateManifest(raw, models);
    assert.equal(v.ok, false, `${name} should be rejected`);
    if (!v.ok) assert.match(v.problem, re, `${name}: ${v.problem}`);
  }
});

test("manifest: a SEMANTIC.TENANT.* type is registered in the data-type registry at load", () => {
  clearModels();
  installBow();
  assert.equal(dataTypes().has("SEMANTIC.TENANT.BUDGET_PLANNING"), false);
  const { manifests, problems } = loadManifests(true);
  assert.deepEqual(problems, []);
  assert.equal(manifests.length, 1);
  const t = dataTypes().get("SEMANTIC.TENANT.BUDGET_PLANNING");
  assert.ok(t);
  assert.equal(t.label, "Budget planning (tenant)");
  assert.equal(t.tenantConfig?.kind, "model");
  assert.deepEqual(t.actions, ["ALLOW", "REVIEW", "BLOCK"]);
  assert.ok(dataTypes().isWithin(t.id, "SEMANTIC"));
});

test("manifest: broken files are reported as problems, good ones still load", () => {
  clearModels();
  installWordpiece();
  writeFile("broken.json", "{ not json");
  writeFile("wrong.json", JSON.stringify({ ...wpManifest, id: "wrong", threshold: 7 }));
  writeFile("dup.json", JSON.stringify(wpManifest));
  const { manifests, problems } = loadManifests(true);
  assert.equal(manifests.length, 1);
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => p.startsWith("broken.json:")));
  assert.ok(problems.some((p) => p.startsWith("wrong.json:") && /threshold/.test(p)));
  assert.ok(problems.some((p) => /duplicate manifest id/.test(p)));
});

/* ------------------------------------------------------------------ *
 * tokenizers
 * ------------------------------------------------------------------ */

test("tokenizer: basic tokenisation lower-cases, strips accents and splits punctuation", () => {
  assert.deepEqual(basicTokens("Héllo, World!  it's"), ["hello", ",", "world", "!", "it", "'", "s"]);
  assert.deepEqual(basicTokens("  \t\n "), []);
});

test("tokenizer: wordpiece uses ## continuations, [UNK] for unknown words, [CLS]/[SEP] and padding", () => {
  clearModels();
  installWordpiece();
  const vocab = loadVocab(path.join(models, "wp-vocab.txt"));
  const enc = tokenizeWordPiece("Unbelievable acquisitions.", vocab, 16);
  const id = (t: string) => BigInt(vocab.get(t)!);
  assert.deepEqual([...enc.ids.slice(0, enc.tokens)], [id("[CLS]"), id("un"), id("##believ"), id("##able"), id("acquisition"), id("##s"), id("."), id("[SEP]")]);
  assert.equal(enc.tokens, 8);
  assert.deepEqual([...enc.mask], [1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  assert.ok(enc.ids.slice(enc.tokens).every((x) => x === id("[PAD]")));
  const unk = tokenizeWordPiece("zzzz", vocab, 16);
  assert.deepEqual([...unk.ids.slice(0, unk.tokens)], [id("[CLS]"), id("[UNK]"), id("[SEP]")]);
  // A word whose prefix matches but whose tail does not is [UNK] as a whole, never a partial word.
  const partial = tokenizeWordPiece("unzzz", vocab, 16);
  assert.deepEqual([...partial.ids.slice(0, partial.tokens)], [id("[CLS]"), id("[UNK]"), id("[SEP]")]);
});

test("tokenizer: wordpiece truncates to maxLen and always keeps [SEP] last", () => {
  clearModels();
  installWordpiece();
  const vocab = loadVocab(path.join(models, "wp-vocab.txt"));
  const enc = tokenizeWordPiece("merger ".repeat(50), vocab, 8);
  assert.equal(enc.ids.length, 8);
  assert.equal(enc.tokens, 8);
  assert.equal(enc.ids[0], BigInt(vocab.get("[CLS]")!));
  assert.equal(enc.ids[7], BigInt(vocab.get("[SEP]")!));
  assert.ok(enc.ids.slice(1, 7).every((x) => x === BigInt(vocab.get("merger")!)));
  assert.ok(enc.mask.every((x) => x === 1n));
});

test("tokenizer: bag of words counts vocabulary tokens and drops the rest", () => {
  clearModels();
  installBow();
  const vocab = loadVocab(path.join(models, "bow-vocab.txt"));
  const v = tokenizeBow("Budget! budget forecast, and a picnic — the beach", vocab);
  assert.deepEqual([...v], [2, 1, 0, 1, 1]);
  assert.deepEqual([...tokenizeBow("nothing known here", vocab)], [0, 0, 0, 0, 0]);
});

test("vocab: blank or repeated lines are refused (they would shift every later index)", () => {
  clearModels();
  const blank = writeFile("blank.txt", "a\n\nb\n");
  assert.throws(() => loadVocab(blank), /line 2 is empty/);
  const dup = writeFile("dup.txt", "a\nb\na\n");
  assert.throws(() => loadVocab(dup), /line 3 repeats/);
  const crlf = writeFile("crlf.txt", "a\r\nb\r\n");
  assert.deepEqual([...loadVocab(crlf)], [["a", 0], ["b", 1]]);
});

test("softmax: sums to one, is shift-invariant and never overflows", () => {
  const p = softmax([1, 2, 3]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(softmax([1001, 1002, 1003]).map((x) => x.toFixed(6)), p.map((x) => x.toFixed(6)));
  assert.deepEqual(softmax([0, 0]), [0.5, 0.5]);
});

/* ------------------------------------------------------------------ *
 * availability
 * ------------------------------------------------------------------ */

test("available: no manifests → unavailable, and the reason says a model is not installed", () => {
  clearModels();
  const a = available();
  assert.equal(a.ok, false);
  assert.match(a.reason ?? "", /no semantic model installed/);
  assert.match(a.reason ?? "", new RegExp(models.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(detector.detect({ text: "merger acquisition", format: "text", input: "text" }), []);
  assert.equal(sem.lastError, null);
});

test("available: a manifest whose model file is missing → unavailable, with the file named", () => {
  clearModels();
  installWordpiece();
  fs.rmSync(path.join(models, "mna.onnx"));
  const a = available();
  assert.equal(a.ok, false);
  assert.match(a.reason ?? "", /mna\.json: model file missing/);
});

test("available: a usable manifest plus a broken one → available, broken one surfaced in reason", () => {
  clearModels();
  installWordpiece();
  writeFile("broken.json", "nope");
  const a = available();
  assert.equal(a.ok, true, a.reason);
  assert.match(a.reason ?? "", /ignored: broken\.json/);
});

test("available: onnxruntime-node loads in the worker (or the reason says why not)", () => {
  clearModels();
  installWordpiece();
  const a = available();
  if (!a.ok) assert.match(a.reason ?? "", /onnxruntime-node/);
  else assert.equal(a.reason, undefined);
});

/* ------------------------------------------------------------------ *
 * end to end — real ONNX sessions
 * ------------------------------------------------------------------ */

const ortMissing = (() => { clearModels(); installWordpiece(); const a = available(); return a.ok ? false : a.reason ?? "onnxruntime-node unavailable"; })();

test("e2e: wordpiece model classifies M&A text, ignores the rest class, and never leaks text", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  const sample = "The merger and the acquisition.";
  const hits = detector.detect({ text: sample, format: "text", input: "text", unitPath: "body" });
  assert.equal(sem.lastError, null);
  assert.equal(hits.length, 1);
  const [f] = hits;
  assert.equal(f.type, "SEMANTIC.M_AND_A");
  assert.equal(f.count, 1);
  assert.equal(f.confidence, "high");
  assert.equal(f.detector, "wrapbox.semantic.onnx");
  assert.equal(f.label, "test-mna@1.0.0:m_and_a");
  assert.equal(f.unitPath, "body");
  const json = JSON.stringify(hits);
  for (const w of ["merger", "acquisition", sample]) assert.ok(!json.includes(w), `finding leaks "${w}"`);

  assert.deepEqual(detector.detect({ text: "Sunny weather today.", format: "text", input: "text" }), []);
  // All-[UNK] text gives 0.5/0.5 — below threshold, nothing claimed.
  assert.deepEqual(detector.detect({ text: "zzz qqq", format: "text", input: "text" }), []);
  assert.equal(sem.lastError, null);
});

test("e2e: confidence follows probability — a single cue is medium, many are high", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  const { manifests } = loadManifests(true);
  const one = classify(manifests[0], "merger");                  // logits [0,3] → p ≈ 0.953 → high
  const mixed = classify(manifests[0], "merger merger weather");  // logits [3,6] → p ≈ 0.953
  const tie = classify(manifests[0], "merger weather");          // logits [3,3] → 0.5 → not emitted
  assert.equal(one.emitted, true);
  assert.ok(one.probability > 0.9);
  assert.equal(mixed.emitted, true);
  assert.equal(tie.emitted, false);
  // A model with a wider boundary: bump the threshold above what one cue reaches.
  writeFile("mna.json", JSON.stringify({ ...wpManifest, threshold: 0.99 }));
  const strict = loadManifests(true).manifests[0];
  assert.equal(classify(strict, "merger").emitted, false);
  assert.equal(classify(strict, "merger acquisition merger").emitted, true);
  const f = detector.detect({ text: "merger acquisition merger", format: "text", input: "text" });
  assert.equal(f[0]?.confidence, "high");
});

test("e2e: bag-of-words linear model emits the tenant type", { skip: ortMissing }, () => {
  clearModels();
  installBow();
  const hits = detector.detect({ text: "Quarter budget forecast for the budget review", format: "text", input: "text" });
  assert.equal(sem.lastError, null);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, "SEMANTIC.TENANT.BUDGET_PLANNING");
  assert.equal(hits[0].confidence, "high");
  assert.equal(hits[0].label, "test-forecast@2.0.0:budget");
  assert.deepEqual(detector.detect({ text: "picnic at the beach", format: "text", input: "text" }), []);
});

test("e2e: two manifests run over one unit and each contributes its own finding", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  installBow();
  const hits = detector.detect({ text: "merger budget forecast", format: "text", input: "text" });
  assert.deepEqual(hits.map((h) => h.type).sort(), ["SEMANTIC.M_AND_A", "SEMANTIC.TENANT.BUDGET_PLANNING"]);
});

test("e2e: a manifest whose input names do not match the model fails closed with lastError", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  writeFile("mna.json", JSON.stringify({ ...wpManifest, inputs: { ids: "tokens", mask: "attention_mask" } }));
  assert.deepEqual(detector.detect({ text: "merger", format: "text", input: "text" }), []);
  assert.match(sem.lastError ?? "", /no input named tokens/);
  writeFile("mna.json", JSON.stringify({ ...wpManifest, output: "probs" }));
  assert.deepEqual(detector.detect({ text: "merger", format: "text", input: "text" }), []);
  assert.match(sem.lastError ?? "", /no output named probs/);
  writeFile("mna.json", JSON.stringify({ ...wpManifest, labels: ["other", "b", "c"] }));
  assert.deepEqual(detector.detect({ text: "merger", format: "text", input: "text" }), []);
  assert.match(sem.lastError ?? "", /3 labels/);
});

test("e2e: a corrupt model file fails closed and does not poison the next call", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  writeFile("mna.onnx", Buffer.from("this is not an onnx model"));
  assert.deepEqual(detector.detect({ text: "merger", format: "text", input: "text" }), []);
  assert.ok(sem.lastError);
  installWordpiece();
  const hits = detector.detect({ text: "merger acquisition", format: "text", input: "text" });
  assert.equal(sem.lastError, null);
  assert.equal(hits.length, 1);
});

test("e2e: oversized text is capped, non-text units are ignored, and the session is reused", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  const big = "weather ".repeat(MAX_TEXT_BYTES / 4) + "merger ".repeat(2000); // the M&A cues sit past the cap
  assert.deepEqual(detector.detect({ text: big, format: "text", input: "text" }), []);
  assert.equal(sem.lastError, null);
  assert.deepEqual(detector.detect({ text: "merger acquisition", format: "text", input: "table" }), []);
  assert.deepEqual(detector.detect({ format: "text", input: "text" }), []);
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) assert.equal(detector.detect({ text: "merger acquisition", format: "text", input: "text" }).length, 1);
  assert.ok(Date.now() - t0 < 2000, "20 cached-session runs should be fast");
});

test("e2e: a model whose input names do not exist in the manifest (unfed input) fails closed", { skip: ortMissing }, () => {
  clearModels();
  installWordpiece();
  writeFile("mna.json", JSON.stringify({ ...wpManifest, inputs: { ids: "input_ids" } }));
  assert.deepEqual(detector.detect({ text: "merger", format: "text", input: "text" }), []);
  assert.match(sem.lastError ?? "", /not fed by the manifest: attention_mask/);
});
