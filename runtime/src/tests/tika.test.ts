/**
 * Tika sidecar client — exercised against a fake HTTP server so every status,
 * timeout and privacy branch is covered without Docker. The fake dispatches on
 * the request BODY (a real Tika dispatches on content), which keeps the client
 * code path identical to production: same URL, same headers, same parsing.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createTikaExtractor, resolveTikaEndpoint, endpointRefusal, isLoopbackUrl, unitsFromRmeta, TIKA_DESCRIPTOR, WRITE_LIMIT,
} from "../extract/tika.js";

const MSIP_KEY = "custom:MSIP_Label_2e4f6a1b-0000-4c11-9a2b-000000000001_Name";

/** Two-document rmeta reply: a container docx with one embedded PNG. */
const RMETA_TWO = [
  {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    resourceName: "quarterly.docx",
    [MSIP_KEY]: "Highly Confidential",
    "X-TIKA:content": "Quarterly numbers for the board.\nContact: someone@example.test",
    "X-TIKA:parse_time_millis": "12",
  },
  {
    "Content-Type": "image/png",
    resourceName: "image1.png",
    "X-TIKA:embedded_depth": "1",
    "X-TIKA:embedded_resource_path": "/image1.png",
    "X-TIKA:content": "\n\n",
  },
];

/** Three levels deep: container → zip → docx. */
const RMETA_DEEP = [
  { "Content-Type": "application/zip", resourceName: "outer.zip", "X-TIKA:content": "" },
  { "Content-Type": "application/zip", resourceName: "inner.zip", "X-TIKA:embedded_depth": "1", "X-TIKA:embedded_resource_path": "/inner.zip", "X-TIKA:content": "" },
  { "Content-Type": "application/pdf", resourceName: "deep.pdf", "X-TIKA:embedded_depth": "2", "X-TIKA:embedded_resource_path": "/inner.zip/deep.pdf", "X-TIKA:content": "deep text", "X-TIKA:Exception:write_limit_reached": "true" },
];

let server: http.Server;
let baseUrl: string;
let received: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      received.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      if (req.method === "GET" && req.url === "/version") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Apache Tika 4.0.0"); return; }
      if (req.method !== "PUT" || req.url !== "/rmeta/text") { res.writeHead(404); res.end("not found"); return; }
      const json = (o: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      switch (body) {
        case "TWO": return json(RMETA_TWO);
        case "DEEP": return json(RMETA_DEEP);
        case "ENC": res.writeHead(422); return res.end("Unprocessable Entity: EncryptedDocumentException: document is password protected");
        case "BAD": res.writeHead(422); return res.end("Unprocessable Entity: TikaException: unexpected end of stream");
        case "MIME": res.writeHead(415); return res.end("Unsupported Media Type");
        case "CRASH": res.writeHead(500); return res.end("Internal Server Error: parser crashed");
        case "GARBAGE": res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{not json");
        case "RESET": return req.socket.destroy();
        case "HANG": return; // never answers; closeAllConnections() in `after` tears it down
        default: res.writeHead(400); return res.end("unknown fixture");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const client = (extra: Parameters<typeof createTikaExtractor>[0] = {}) =>
  createTikaExtractor({ endpoint: { url: baseUrl, allowRemote: false }, ...extra });

test("descriptor is the registry's wrapbox.tika", () => {
  assert.equal(TIKA_DESCRIPTOR.id, "wrapbox.tika");
  assert.equal(client().descriptor, TIKA_DESCRIPTOR);
});

test("available(): GET /version → ok; unreachable → honest failure", async () => {
  assert.deepEqual(await client().available(), { ok: true });
  const dead = createTikaExtractor({ endpoint: { url: "http://127.0.0.1:1", allowRemote: false }, availabilityTimeoutMs: 500 });
  const r = await dead.available();
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /unreachable/);
});

test("extract(): container + embedded units, unitPaths, MSIP passthrough, image hand-off, headers", async () => {
  received = [];
  const r = await client().extract(Buffer.from("TWO"), { filename: "quarterly.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", unitPath: "form[0]" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.extractor, "wrapbox.tika");
  assert.equal(r.units.length, 2);
  const [root, img] = r.units;
  assert.equal(root.unitPath, "form[0]");
  assert.equal(root.depth, 0);
  assert.equal(root.format, "docx");
  assert.equal(root.input, "text");
  assert.match(root.text ?? "", /board/);
  assert.equal(root.metadata[MSIP_KEY], "Highly Confidential");
  assert.equal(root.metadata["resourceName"], "quarterly.docx");
  assert.equal(root.sniffedBy, "sidecar");
  assert.equal(root.truncated, false);
  assert.equal(img.unitPath, "form[0]/image1.png");
  assert.equal(img.parent, root.id);
  assert.equal(img.depth, 1);
  assert.equal(img.format, "image");
  assert.equal(img.input, "image");
  assert.equal(img.text, undefined);
  // The request the sidecar saw.
  const req = received.find((x) => x.url === "/rmeta/text")!;
  assert.equal(req.method, "PUT");
  assert.equal(req.headers["accept"], "application/json");
  assert.equal(req.headers["content-type"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(req.headers["maxembeddedresources"], String(TIKA_DESCRIPTOR.limits.maxEntries));
  assert.equal(req.headers["writelimit"], String(WRITE_LIMIT));
  assert.equal(req.headers["unpackmaxbytes"], String(TIKA_DESCRIPTOR.limits.maxDecompressedBytes));
  assert.equal(req.headers["x-tika-skip-embedded"], undefined);
});

test("extract(): X-Tika-Skip-Embedded only when no depth budget remains; default unitPath is root", async () => {
  received = [];
  const r = await client().extract(Buffer.from("TWO"), { depth: TIKA_DESCRIPTOR.limits.maxDepth });
  assert.equal(received.find((x) => x.url === "/rmeta/text")!.headers["x-tika-skip-embedded"], "true");
  // The fake still returned an embedded doc one level deeper than the budget → fail closed.
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.uninspectable.state, "DEPTH_EXCEEDED");
  assert.equal(r.uninspectable.partialUnits?.length, 1);
  assert.equal(r.uninspectable.partialUnits?.[0].unitPath, "root");
});

test("extract(): nested tree parents, truncation marker, depth limit from reply", async () => {
  const ok = await client().extract(Buffer.from("DEEP"), { filename: "outer.zip" });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.deepEqual(ok.units.map((u) => u.unitPath), ["root", "root/inner.zip", "root/inner.zip/deep.pdf"]);
  assert.equal(ok.units[2].parent, ok.units[1].id);
  assert.equal(ok.units[2].truncated, true);
  assert.equal(ok.units[2].format, "pdf");
  assert.equal(ok.units[0].input, "metadata");

  const tight = await client({ limits: { maxDepth: 1 } }).extract(Buffer.from("DEEP"), {});
  assert.equal(tight.ok, false);
  if (tight.ok) return;
  assert.equal(tight.uninspectable.state, "DEPTH_EXCEEDED");
  assert.equal(tight.uninspectable.unitPath, "root/inner.zip/deep.pdf");
  assert.equal(tight.uninspectable.partialUnits?.length, 2);
});

test("extract(): each UNINSPECTABLE mapping", async () => {
  const state = async (body: string, extra = {}) => {
    const r = await client(extra).extract(Buffer.from(body), {});
    assert.equal(r.ok, false, body);
    return r.ok ? "" : r.uninspectable.state;
  };
  assert.equal(await state("ENC"), "ENCRYPTED");
  assert.equal(await state("BAD"), "UNSUPPORTED_FORMAT");
  assert.equal(await state("MIME"), "UNSUPPORTED_FORMAT");
  assert.equal(await state("CRASH"), "PARSER_FAILURE");
  assert.equal(await state("RESET"), "PARSER_FAILURE");
  assert.equal(await state("GARBAGE"), "PARSER_FAILURE");
  const t0 = Date.now();
  assert.equal(await state("HANG", { limits: { timeoutMs: 300 } }), "TIMEOUT");
  assert.ok(Date.now() - t0 < 5000, "timeout must be enforced by the client");
});

test("extract(): OVERSIZE and DEPTH_EXCEEDED are decided before anything is sent", async () => {
  received = [];
  const big = await client({ limits: { maxBytes: 8 } }).extract(Buffer.alloc(9, 0x41), { unitPath: "big" });
  assert.equal(big.ok, false);
  if (!big.ok) { assert.equal(big.uninspectable.state, "OVERSIZE"); assert.equal(big.uninspectable.unitPath, "big"); }
  const deep = await client().extract(Buffer.from("TWO"), { depth: TIKA_DESCRIPTOR.limits.maxDepth + 1 });
  assert.equal(deep.ok, false);
  if (!deep.ok) assert.equal(deep.uninspectable.state, "DEPTH_EXCEEDED");
  assert.equal(received.length, 0, "no request may reach the sidecar");
});

test("privacy boundary: non-loopback URL refused by default, allowed only with allowRemote", async () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:9998"), true);
  assert.equal(isLoopbackUrl("http://localhost:9998"), true);
  assert.equal(isLoopbackUrl("http://[::1]:9998"), true);
  assert.equal(isLoopbackUrl("http://10.1.2.3:9998"), false);
  assert.equal(isLoopbackUrl("http://tika.internal:9998"), false);
  assert.equal(isLoopbackUrl("ftp://127.0.0.1:9998"), false);

  assert.equal(endpointRefusal({ url: "http://127.0.0.1:9998", allowRemote: false, source: "default" }), null);
  assert.match(endpointRefusal({ url: "http://10.1.2.3:9998", allowRemote: false, source: "config" }) ?? "", /allowRemote/);
  assert.equal(endpointRefusal({ url: "http://10.1.2.3:9998", allowRemote: true, source: "config" }), null);

  const remote = createTikaExtractor({ endpoint: { url: "http://10.1.2.3:9998", allowRemote: false } });
  const a = await remote.available();
  assert.equal(a.ok, false);
  assert.match(a.reason ?? "", /loopback/);
  const r = await remote.extract(Buffer.from("TWO"), {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.uninspectable.state, "PARSER_FAILURE");

  // Env var overrides the URL but never the loopback rule.
  const ep = resolveTikaEndpoint({ WRAPBOX_TIKA_URL: "http://10.1.2.3:9998" }, { services: { tika: { url: "http://127.0.0.1:1" } } });
  assert.equal(ep.source, "env");
  assert.equal(ep.allowRemote, false);
  assert.ok(endpointRefusal(ep));
  const cfg = resolveTikaEndpoint({}, { services: { tika: { url: "http://10.1.2.3:9998", allowRemote: true } } });
  assert.equal(cfg.source, "config");
  assert.equal(endpointRefusal(cfg), null);
  assert.equal(resolveTikaEndpoint({}, {}).url, "http://127.0.0.1:9998");
});

test("unitsFromRmeta: duplicate resource names get unique unitPaths; MSIP keys kept, other metadata dropped", () => {
  const docs = [
    { "Content-Type": "application/zip", "X-TIKA:content": "", "dc:creator": "not kept" },
    { "Content-Type": "text/plain", resourceName: "a.txt", "X-TIKA:embedded_depth": "1", "X-TIKA:content": "one", MSIP_Label_x_Enabled: "true" },
    { "Content-Type": "text/plain", resourceName: "a.txt", "X-TIKA:embedded_depth": "1", "X-TIKA:content": "two" },
  ];
  const units = unitsFromRmeta(docs, { unitPath: "zip" }, "wrapbox.tika");
  assert.deepEqual(units.map((u) => u.unitPath), ["zip", "zip/a.txt", "zip/a.txt[2]"]);
  assert.equal(units[0].metadata["dc:creator"], undefined);
  assert.equal(units[1].metadata["MSIP_Label_x_Enabled"], "true");
  assert.ok(units.every((u) => u.extractor === "wrapbox.tika" && u.sniffedBy === "sidecar"));
});
