/**
 * wrapbox.code.treesitter — regression suite.
 *
 * Fixtures are generated here: snippets in nine languages presented as `.txt`
 * or with no filename at all (content-only identification), a JSON body with
 * a Python function inside a string value, a log whose one long line carries
 * JavaScript, a package.json and a Kubernetes manifest (BUILD_CONFIG / IAC,
 * never SOURCE_CODE), plus English prose and a CSV (no code finding at all).
 * Every Finding's JSON is searched for a marker token planted in each snippet
 * — content must never leave the detector. Availability is checked BEFORE
 * init (must be honest), and after.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../detectors/code.js");
const { detector, initCodeDetector, candidateLanguages, classifyConfig, looksLikeLog, upgradeDylinkSection, MAX_PARSE_BYTES, LANGS } = mod;

const MARK = "zq7marker_never_leaks";

function det(text: string, extra: Partial<Parameters<typeof detector.detect>[0]> = {}) {
  const fs = detector.detect({ text, format: "text", input: "text", ...extra });
  const json = JSON.stringify(fs);
  assert.ok(!json.includes(MARK), `marker value leaked into findings: ${json}`);
  assert.ok(!json.includes("\n"), `newline (content) leaked into findings: ${json}`);
  return fs;
}
const types = (fs: ReturnType<typeof det>) => fs.map((f) => f.type);
const codeFinding = (fs: ReturnType<typeof det>) => fs.find((f) => f.type === "SOURCE_CODE");

/* ------------------------------------------------------------------ *
 * Fixtures — every snippet embeds MARK as an identifier or string.
 * ------------------------------------------------------------------ */

const SNIPPETS: Record<string, string> = {
  python: `import os
import json

class Loader:
    def __init__(self, root):
        self.root = root
        self.${MARK} = None

    def load(self, name):
        path = os.path.join(self.root, name)
        with open(path) as fh:
            return json.load(fh)

def main():
    loader = Loader("/tmp")
    print(loader.load("x.json"))
`,
  typescript: `import fs from "node:fs";

export interface Options { root: string; verbose?: boolean }

export function readAll(opts: Options): string[] {
  const ${MARK}: string[] = [];
  for (const name of fs.readdirSync(opts.root)) {
    if (opts.verbose) console.log(name);
    ${MARK}.push(name);
  }
  return ${MARK};
}

export class Cache<T> {
  private items = new Map<string, T>();
  get(k: string): T | undefined { return this.items.get(k); }
}
`,
  go: `package main

import (
	"fmt"
	"os"
)

type Server struct {
	Addr string
	${MARK} int
}

func (s *Server) Run() error {
	if s.Addr == "" {
		return fmt.Errorf("no addr")
	}
	fmt.Println("listening on", s.Addr)
	return nil
}

func main() {
	s := &Server{Addr: os.Getenv("ADDR")}
	if err := s.Run(); err != nil {
		os.Exit(1)
	}
}
`,
  rust: `use std::collections::HashMap;

#[derive(Debug)]
pub struct Registry {
    items: HashMap<String, u32>,
}

impl Registry {
    pub fn new() -> Self {
        Registry { items: HashMap::new() }
    }
    pub fn insert(&mut self, k: &str, v: u32) {
        let ${MARK} = k.to_string();
        self.items.insert(${MARK}, v);
    }
}

fn main() {
    let mut r = Registry::new();
    r.insert("a", 1);
    println!("{:?}", r);
}
`,
  java: `package com.example;

import java.util.ArrayList;
import java.util.List;

public class Inventory {
    private final List<String> items = new ArrayList<>();
    private int ${MARK} = 0;

    public void add(String item) {
        items.add(item);
        ${MARK}++;
    }

    public static void main(String[] args) {
        Inventory inv = new Inventory();
        inv.add("widget");
        System.out.println(inv.items.size());
    }
}
`,
  swift: `import Foundation

struct Point {
    let x: Double
    let y: Double
}

class Tracker {
    var points: [Point] = []
    var ${MARK}: Int = 0

    func add(_ p: Point) {
        points.append(p)
        ${MARK} += 1
    }

    func describe() -> String {
        guard let last = points.last else { return "empty" }
        return "last: \\(last.x), \\(last.y)"
    }
}

let t = Tracker()
t.add(Point(x: 1, y: 2))
print(t.describe())
`,
  bash: `#!/usr/bin/env bash
set -euo pipefail

${MARK}="/var/log/app"
export LOG_DIR="$${MARK}"

rotate() {
  local f="$1"
  if [[ -f "$f" ]]; then
    mv "$f" "$f.1"
  fi
}

for f in "$LOG_DIR"/*.log; do
  rotate "$f"
done
echo "rotated $(ls "$LOG_DIR" | wc -l) files"
`,
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct node {
    int value;
    struct node *next;
};

static struct node *${MARK}(int v) {
    struct node *n = malloc(sizeof(struct node));
    if (n == NULL) return NULL;
    n->value = v;
    n->next = NULL;
    return n;
}

int main(int argc, char **argv) {
    struct node *head = ${MARK}(argc);
    printf("%d\\n", head->value);
    free(head);
    return 0;
}
`,
  ruby: `require 'json'

module Billing
  class Invoice
    attr_accessor :total, :${MARK}

    def initialize(total)
      @total = total
      @${MARK} = []
    end

    def add(line)
      @${MARK} << line
      @total += line[:amount]
    end

    def to_json
      JSON.generate({ total: @total, lines: @${MARK} })
    end
  end
end

inv = Billing::Invoice.new(0)
inv.add({ amount: 10 })
puts inv.to_json
`,
};

const PROSE = `The quarterly review covered three areas: hiring, the office move and the
customer conference. Hiring is ahead of plan, with two engineers and one
designer starting next month. The office move has slipped by a quarter because
the landlord has not finished the fit-out; we will keep the current lease until
the new floor is ready. The conference agenda is drafted and the keynote
speaker has confirmed. Please send questions to the operations team by Friday
and note that the ${MARK} account should not be used for expenses.`;

const CSV = `id,name,email,plan,mrr
1,Ada,ada@example.com,pro,49
2,Ben,ben@example.com,free,0
3,Cy,cy@example.com,team,199
4,Di,di@example.com,pro,49
5,${MARK},ee@example.com,free,0
6,Fay,fay@example.com,team,199`;

const PACKAGE_JSON = `{
  "name": "${MARK}",
  "version": "1.0.0",
  "scripts": { "build": "tsc", "test": "node --test" },
  "dependencies": { "react": "^18.3.1", "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.7.0" }
}`;

const K8S = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${MARK}
  namespace: prod
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.internal/api:1.2.3
          ports:
            - containerPort: 8080
`;

const EMBEDDED_PY = SNIPPETS.python + "\n\ndef helper(a, b):\n    return a + b\n";
const JSON_WITH_CODE = {
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: `Please review this module:\n\n${EMBEDDED_PY}` },
  ],
  temperature: 0.2,
};

const LOG = [
  "2026-09-24T10:00:01.001Z INFO  worker[12]: job started id=a1",
  "2026-09-24T10:00:01.104Z INFO  worker[12]: fetched 3 records",
  `2026-09-24T10:00:01.220Z ERROR worker[12]: eval failed for handler: function ${MARK}(req, res) { const body = JSON.parse(req.body); if (!body.id) { return res.status(400).send("missing id"); } const out = { id: body.id, ok: true }; return res.json(out); } module.exports = { ${MARK} };`,
  "2026-09-24T10:00:01.300Z WARN  worker[12]: retrying in 5s",
  "2026-09-24T10:00:06.310Z INFO  worker[12]: job finished id=a1",
  "2026-09-24T10:00:06.311Z INFO  worker[12]: idle",
].join("\n");

/* ------------------------------------------------------------------ *
 * Availability must be honest before and after init
 * ------------------------------------------------------------------ */

// Captured at import time: node:test's `before` hook runs ahead of the first test.
const PRE_INIT = { available: detector.available(), findings: detector.detect({ text: SNIPPETS.python, format: "text", input: "text" }) };

test("unavailable and inert before init", () => {
  assert.equal(PRE_INIT.available.ok, false);
  assert.equal(PRE_INIT.available.reason, "grammars not initialised");
  assert.deepEqual(PRE_INIT.findings, []);
});

before(async () => { await initCodeDetector(); });

test("available after init; descriptor is the registry's", () => {
  assert.deepEqual(detector.available(), { ok: true });
  assert.equal(detector.descriptor.id, "wrapbox.code.treesitter");
  assert.ok(detector.descriptor.inputs.includes("structured"));
});

test("dylink rewrite is idempotent and rejects non-grammar bytes", () => {
  const dylink0 = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 11, 8, ...Buffer.from("dylink.0"), 1, 0]);
  assert.equal(upgradeDylinkSection(dylink0), dylink0);
  assert.throws(() => upgradeDylinkSection(Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 0])));
});

test("grammar patch: the shipped bash grammar loses its unprovided isalpha import and still compiles", async () => {
  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const { createRequire } = await import("node:module");
  const dir = pathMod.join(pathMod.dirname(createRequire(import.meta.url).resolve("tree-sitter-wasms/package.json")), "out");
  const raw = fsMod.readFileSync(pathMod.join(dir, "tree-sitter-bash.wasm"));
  const before = WebAssembly.Module.imports(new WebAssembly.Module(raw)).map((i) => i.name);
  assert.ok(before.includes("isalpha"), "fixture assumption: the shipped bash grammar imports isalpha");
  const patched = mod.patchGrammarWasm(raw);
  const after = WebAssembly.Module.imports(new WebAssembly.Module(patched.buffer.slice(patched.byteOffset, patched.byteOffset + patched.byteLength) as ArrayBuffer)).map((i) => i.name);
  assert.ok(!after.includes("isalpha") && after.includes("iswalpha"));
  assert.equal(after.length, before.length);
  // Other grammars are untouched by the rename step.
  const py = fsMod.readFileSync(pathMod.join(dir, "tree-sitter-python.wasm"));
  assert.equal(mod.renameImports(py, { isalpha: "iswalpha" }), py);
});

test("bash with case … esac and command substitution (external scanner path) is recognised", () => {
  const script = `#!/bin/sh
# deploy helper
APP=api
VERSION=$(git rev-parse --short HEAD)
${MARK}="$APP:$VERSION"
docker build -t "$${MARK}" .
if [ "$1" = "push" ]; then
  docker push "$${MARK}"
fi
case "$2" in
  prod) kubectl apply -f k8s/prod ;;
  *) echo "skip" ;;
esac
`;
  const f = codeFinding(det(script, { filename: "deploy.txt" }));
  assert.ok(f && f.label === "lang:bash" && f.confidence === "high", `got ${JSON.stringify(f)} lastError=${mod.lastError}`);
  assert.equal(mod.lastError, null);
});

/* ------------------------------------------------------------------ *
 * Content-only identification: renamed and nameless
 * ------------------------------------------------------------------ */

for (const [lang, src] of Object.entries(SNIPPETS)) {
  test(`${lang}: recognised from content as notes.txt`, () => {
    const fs = det(src, { filename: "notes.txt" });
    const f = codeFinding(fs);
    assert.ok(f, `${lang}: expected SOURCE_CODE, got ${JSON.stringify(fs)} (lastError=${mod.lastError})`);
    assert.equal(f.label, `lang:${lang}`);
    assert.equal(f.confidence, "high");
    assert.equal(f.count, 1);
    assert.equal(f.detector, "wrapbox.code.treesitter");
    assert.ok(!types(fs).includes("SOURCE_CODE.BUILD_CONFIG"));
    assert.equal(mod.lastError, null);
  });
  test(`${lang}: recognised with no filename at all`, () => {
    const f = codeFinding(det(src));
    assert.ok(f && f.label === `lang:${lang}`, `${lang}: got ${JSON.stringify(f)}`);
  });
}

test("a wrong extension is only a hint: python content in a .go file is still python", () => {
  const f = codeFinding(det(SNIPPETS.python, { filename: "main.go" }));
  assert.ok(f);
  assert.equal(f.label, "lang:python");
});

test("candidate nomination is bounded to three grammars and empty for prose", () => {
  for (const src of Object.values(SNIPPETS)) assert.ok(candidateLanguages(src).length <= 3);
  assert.deepEqual(candidateLanguages(PROSE), []);
  assert.deepEqual(candidateLanguages(CSV), []);
  assert.ok(LANGS.length === 18);
});

/* ------------------------------------------------------------------ *
 * Config and IaC are never SOURCE_CODE
 * ------------------------------------------------------------------ */

test("package.json is BUILD_CONFIG, never SOURCE_CODE", () => {
  for (const extra of [{ filename: "package.json" }, { filename: "package.json", format: "json" }, {}]) {
    const fs = det(PACKAGE_JSON, extra);
    assert.ok(types(fs).includes("SOURCE_CODE.BUILD_CONFIG"), JSON.stringify(fs));
    assert.ok(!types(fs).includes("SOURCE_CODE"), `must never be SOURCE_CODE: ${JSON.stringify(fs)}`);
  }
  assert.equal(det(PACKAGE_JSON, { filename: "package.json" })[0].label, "config:manifest:package.json");
  assert.equal(det(PACKAGE_JSON)[0].label, "config:json");
});

test("kubernetes manifest is IAC, never SOURCE_CODE", () => {
  for (const extra of [{ filename: "deploy.yaml" }, { format: "yaml" }, {}]) {
    const fs = det(K8S, extra);
    assert.deepEqual(types(fs), ["SOURCE_CODE.IAC"], JSON.stringify(fs));
    assert.equal(fs[0].label, "iac:kubernetes");
  }
});

test("terraform, plain yaml, toml, ini, Dockerfile classify by shape", () => {
  const tf = `provider "aws" {\n  region = "us-east-1"\n}\n\nresource "aws_s3_bucket" "logs" {\n  bucket = "${MARK}"\n}\n`;
  assert.equal(classifyConfig(tf)?.label, "iac:terraform");
  assert.equal(det(tf, { filename: "main.txt" })[0].type, "SOURCE_CODE.IAC");
  const yaml = `name: ${MARK}\nversion: 2\nservices:\n  - api\n  - worker\nretries: 3\ntimeout: 30s\n`;
  assert.equal(classifyConfig(yaml)?.label, "config:yaml");
  const toml = `[package]\nname = "${MARK}"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\n`;
  assert.equal(classifyConfig(toml)?.label, "config:toml");
  const ini = `[core]\nrepositoryformatversion = 0\nfilemode = true\nbare = false\n[remote "origin"]\nurl = git@example.com:x/y.git\n`;
  assert.equal(classifyConfig(ini)?.type, "SOURCE_CODE.BUILD_CONFIG");
  const docker = `FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "dist/cli.js"]\n`;
  assert.equal(classifyConfig(docker)?.label, "config:manifest:dockerfile");
  for (const src of [tf, yaml, toml, ini, docker]) assert.ok(!types(det(src)).includes("SOURCE_CODE"));
});

/* ------------------------------------------------------------------ *
 * Embedded code
 * ------------------------------------------------------------------ */

test("JSON body with an embedded python function: BUILD_CONFIG for the document, SOURCE_CODE embedded", () => {
  const text = JSON.stringify(JSON_WITH_CODE);
  const fs = det(text, { format: "json", input: "structured", json: JSON_WITH_CODE });
  const emb = codeFinding(fs);
  assert.ok(emb, JSON.stringify(fs));
  assert.equal(emb.label, "embedded");
  assert.equal(emb.count, 1);
  assert.deepEqual(emb.fields, ["messages[].content"]);
  assert.ok(types(fs).includes("SOURCE_CODE.BUILD_CONFIG"));
  // Text-only presentation of the same body (no json view) reaches the same conclusion.
  const fs2 = det(text);
  assert.equal(codeFinding(fs2)?.label, "embedded");
});

test("JSON body without code yields no SOURCE_CODE", () => {
  const body = { messages: [{ role: "user", content: PROSE + " " + PROSE }] };
  const fs = det(JSON.stringify(body), { format: "json", input: "structured", json: body });
  assert.ok(!types(fs).includes("SOURCE_CODE"), JSON.stringify(fs));
});

test("log with an embedded JavaScript line: SOURCE_CODE embedded, count 1", () => {
  assert.ok(looksLikeLog(LOG));
  const fs = det(LOG, { filename: "worker.log" });
  const emb = codeFinding(fs);
  assert.ok(emb, `got ${JSON.stringify(fs)} lastError=${mod.lastError}`);
  assert.equal(emb.label, "embedded");
  assert.equal(emb.count, 1);
  // A plain log never becomes code.
  const plain = LOG.split("\n").filter((l) => !l.includes("eval failed")).join("\n");
  assert.deepEqual(det(plain), []);
});

/* ------------------------------------------------------------------ *
 * Negatives, bounds, failure paths
 * ------------------------------------------------------------------ */

test("english prose and CSV produce no SOURCE_CODE finding", () => {
  assert.deepEqual(det(PROSE), []);
  assert.deepEqual(det(PROSE, { filename: "notes.txt" }), []);
  assert.deepEqual(det(CSV), []);
  assert.deepEqual(det(CSV, { filename: "customers.csv", format: "csv" }), []);
  assert.deepEqual(det(""), []);
  assert.deepEqual(det("   \n\n  "), []);
});

test("prose with a code-file extension is still not code (extension is a hint, parse decides)", () => {
  assert.deepEqual(det(PROSE, { filename: "script.sh" }), []);
  assert.deepEqual(det(PROSE, { filename: "app.rb" }), []);
  assert.deepEqual(det(PROSE, { filename: "main.py" }), []);
});

test("oversize unit is skipped and lastError says so", () => {
  const big = SNIPPETS.typescript.repeat(Math.ceil((MAX_PARSE_BYTES + 1024) / SNIPPETS.typescript.length));
  assert.ok(Buffer.byteLength(big) > MAX_PARSE_BYTES);
  assert.deepEqual(det(big), []);
  assert.match(mod.lastError ?? "", /exceeds MAX_PARSE_BYTES/);
  assert.ok(!mod.lastError!.includes(MARK));
});

test("large but in-budget unit is parsed", () => {
  const big = SNIPPETS.go.repeat(Math.floor((MAX_PARSE_BYTES - 1024) / SNIPPETS.go.length));
  const f = codeFinding(det(big));
  assert.ok(f && f.label === "lang:go", `lastError=${mod.lastError}`);
});

test("broken or mixed input degrades honestly: no finding rather than a wrong one", () => {
  const halfCode = PROSE + "\n" + PROSE + "\n" + SNIPPETS.python.slice(0, 120) + "\n" + PROSE + "\n" + PROSE;
  const fs = det(halfCode);
  assert.ok(!types(fs).includes("SOURCE_CODE"), JSON.stringify(fs));
  // Hostile bytes never throw.
  const junk = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)).toString("latin1");
  assert.doesNotThrow(() => detector.detect({ text: junk, format: "text", input: "text" }));
  assert.doesNotThrow(() => detector.detect({ text: "x", format: "json", input: "structured", json: { a: { b: { c: [1, 2, { d: "x".repeat(300) }] } } } }));
});

test("medium band: real code with a damaged region, strong keyword evidence", () => {
  const js = `const fs = require("fs");\nfunction walk(dir, out = []) {\n  for (const name of fs.readdirSync(dir)) {\n    out.push(name);\n  }\n  return out;\n}\nclass Index {\n  constructor() { this.items = new Map(); }\n  add(k, v) { this.items.set(k, v); return this; }\n}\nmodule.exports = { walk, Index, ${MARK} };\n`;
  const damaged = js + PROSE.slice(0, 250) + "\n" + js;
  const parse = mod.scoreParse(damaged, "javascript", performance.now() + 1000)!;
  assert.ok(parse.score >= mod.MEDIUM_SCORE && parse.score < mod.ACCEPT_SCORE, `fixture must land in the medium band, got ${parse.score}`);
  const f = codeFinding(det(damaged));
  assert.ok(f, `expected a medium finding, lastError=${mod.lastError}`);
  assert.equal(f.confidence, "medium");
  assert.equal(f.label, "lang:javascript");
  // Twice the damage falls below the band: nothing rather than a guess.
  assert.deepEqual(det(js + PROSE + PROSE + "\n" + js), []);
});

test("prose with shell-function shapes is not a shell script (bash lexical plausibility)", () => {
  const trap = `${PROSE}\nrollout() {\n  ${PROSE}\n}\n${PROSE}\ncleanup() {\n  ${PROSE}\n}\n`;
  const p = mod.scoreParse(trap, "bash", performance.now() + 1000)!;
  assert.equal(p.plausible, false, `bash must find the command names implausible: ${JSON.stringify(p)}`);
  assert.deepEqual(det(trap), []);
  assert.deepEqual(det(trap, { filename: "deploy.sh" }), []);
  // A real script keeps its plausibility.
  assert.ok(mod.scoreParse(SNIPPETS.bash, "bash", performance.now() + 1000)!.plausible);
});

test("parse abort: an exhausted budget cancels the parse and the parser stays usable", () => {
  const big = SNIPPETS.typescript.repeat(400);
  const p = mod.scoreParse(big, "typescript", performance.now() - 1);
  assert.ok(p && p.timedOut);
  assert.equal(p.score, 0);
  assert.equal(codeFinding(det(SNIPPETS.typescript))?.label, "lang:typescript");
});

test("unitPath travels with findings", () => {
  const fs = det(SNIPPETS.rust, { unitPath: "zip[1]/lib.txt" });
  assert.equal(fs[0].unitPath, "zip[1]/lib.txt");
});
