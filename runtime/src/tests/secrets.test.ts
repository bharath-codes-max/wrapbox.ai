/**
 * wrapbox.secrets — regression over provider rules, Wrapbox rules, negatives,
 * distinct counting, encoded copies, allowlists and the value-never-leaves
 * invariant. Every sample is generated here with an obviously fake body; the
 * shapes are the documented ones, the contents are not real credentials.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detector, lastError, ruleIds, unsupportedRules, shannonEntropy, typeForGitleaksRule, MAX_SCAN_CHARS, TIME_BUDGET_MS } from "../detectors/secrets.js";
import { dataTypes } from "@wrapbox/registry";
import type { Finding } from "@wrapbox/registry";
import corpus from "../detectors/gitleaks-rules.json" with { type: "json" };

/* Deterministic filler: a fixed-seed LCG so shapes have real entropy without real secrets. */
let seed = 0x2f6e2b1;
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function fill(n: number, alphabet: string): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  return s;
}
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HEX = "0123456789abcdef";
const B64URL = ALNUM + "-_";

function scan(text: string, extra: Partial<Parameters<typeof detector.detect>[0]> = {}): Finding[] {
  return detector.detect({ text, format: "text", input: "text", ...extra });
}
const labels = (f: Finding[]) => f.map((x) => x.label);
const byLabel = (f: Finding[], l: string) => f.find((x) => x.label === l);

/** The invariant of the plugin contract: no sample value ever appears in a Finding. */
function assertNoLeak(findings: Finding[], secrets: string[]): void {
  const json = JSON.stringify(findings);
  for (const s of secrets) {
    const probe = s.length > 12 ? s.slice(0, 12) : s;
    assert.ok(!json.includes(probe), `finding JSON leaked a value fragment for ${s.slice(0, 4)}…`);
  }
}

/* ------------------------------------------------------------------ *
 * Positive samples: [description, text, expected rule label, expected type]
 * ------------------------------------------------------------------ */

const PEM = `-----BEGIN RSA PRIVATE KEY-----\n${fill(64, ALNUM + "+/")}\n${fill(64, ALNUM + "+/")}\n${fill(40, ALNUM + "+/")}==\n-----END RSA PRIVATE KEY-----`;
const OPENSSH = `-----BEGIN OPENSSH PRIVATE KEY-----\n${fill(70, ALNUM + "+/")}\n${fill(70, ALNUM + "+/")}\n-----END OPENSSH PRIVATE KEY-----`;
const PGP = `-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n${fill(70, ALNUM + "+/")}\n${fill(70, ALNUM + "+/")}\n-----END PGP PRIVATE KEY BLOCK-----`;
const JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ${fill(30, B64URL)}.${fill(43, B64URL)}`;
const PG_PASS = fill(18, ALNUM);
const GCP_SA = `{ "type": "service_account", "project_id": "demo", "private_key": "-----BEGIN PRIVATE KEY-----\\n${fill(80, ALNUM + "+/")}\\n-----END PRIVATE KEY-----\\n", "client_email": "svc@demo.iam.gserviceaccount.com" }`;

const POSITIVES: Array<[string, string, string, string]> = [
  ["github pat", `token: ghp_${fill(36, ALNUM)}`, "github-pat", "CREDENTIAL.TOKEN"],
  ["github fine-grained pat", `github_pat_${fill(22, ALNUM)}_${fill(59, ALNUM)}`, "github-fine-grained-pat", "CREDENTIAL.TOKEN"],
  ["aws access key id", `aws_access_key_id = AKIA${fill(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")}`, "aws-access-token", "CREDENTIAL.TOKEN"],
  ["anthropic api key", `ANTHROPIC_API_KEY=sk-ant-api03-${fill(93, B64URL)}AA`, "anthropic-api-key", "CREDENTIAL.API_KEY"],
  ["slack bot token", `xoxb-${fill(12, "0123456789")}-${fill(12, "0123456789")}-${fill(24, ALNUM)}`, "slack-bot-token", "CREDENTIAL.TOKEN"],
  ["stripe live key", `STRIPE_KEY=sk_live_${fill(24, ALNUM)}`, "stripe-access-token", "CREDENTIAL.TOKEN"],
  ["openai project key", `sk-proj-${fill(58, B64URL)}T3BlbkFJ${fill(58, B64URL)}`, "openai-api-key", "CREDENTIAL.API_KEY"],
  ["gitlab pat", `glpat-${fill(20, ALNUM)}`, "gitlab-pat", "CREDENTIAL.TOKEN"],
  ["slack webhook", `https://hooks.slack.com/services/${fill(44, ALNUM)}`, "slack-webhook-url", "CREDENTIAL.API_KEY"],
  ["sendgrid token", `SG.${fill(22, ALNUM)}.${fill(43, ALNUM)}`, "sendgrid-api-token", "CREDENTIAL.TOKEN"],
  ["twilio api key", `TWILIO_KEY=SK${fill(32, HEX)}`, "twilio-api-key", "CREDENTIAL.API_KEY"],
  ["npm token", `//registry.npmjs.org/:_authToken=npm_${fill(36, ALNUM)}`, "npm-access-token", "CREDENTIAL.TOKEN"],
  ["shopify token", `shpat_${fill(32, HEX)}`, "shopify-access-token", "CREDENTIAL.TOKEN"],
  ["mailchimp key", `mailchimp_key = ${fill(32, HEX)}-us20`, "mailchimp-api-key", "CREDENTIAL.API_KEY"],
  ["digitalocean pat", `dop_v1_${fill(64, HEX)}`, "digitalocean-pat", "CREDENTIAL.TOKEN"],
  ["age secret key", `AGE-SECRET-KEY-1${fill(58, "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L")}`, "age-secret-key", "CREDENTIAL.API_KEY"],
  ["databricks token", `dapi${fill(32, HEX)}`, "databricks-api-token", "CREDENTIAL.TOKEN"],
  ["huggingface token", `hf_${fill(34, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")}`, "huggingface-access-token", "CREDENTIAL.TOKEN"],
  ["gcp api key", `AIza${fill(35, B64URL)}`, "gcp-api-key", "CREDENTIAL.API_KEY"],
  ["postman token", `PMAK-${fill(24, HEX)}-${fill(34, HEX)}`, "postman-api-token", "CREDENTIAL.TOKEN"],
  ["doppler token", `dp.pt.${fill(43, ALNUM)}`, "doppler-api-token", "CREDENTIAL.TOKEN"],
  ["planetscale password", `pscale_pw_${fill(40, ALNUM)}`, "planetscale-password", "CREDENTIAL.PASSWORD"],
  ["azure ad client secret", `client_secret: ${fill(3, ALNUM)}7Q~${fill(32, ALNUM + "_~.-")}`, "azure-ad-client-secret", "CREDENTIAL.CLIENT_SECRET"],
  ["telegram bot token", `telegram_token = ${fill(10, "0123456789")}:A${fill(34, B64URL)}`, "telegram-bot-api-token", "CREDENTIAL.TOKEN"],
  ["generic contextual key", `AUTH_KEY=${fill(40, ALNUM)}`, "generic-api-key", "CREDENTIAL.GENERIC_HIGH_ENTROPY"],
  ["gitleaks jwt", JWT, "jwt", "CREDENTIAL.TOKEN.JWT"],
  ["wrapbox jwt", `Authorization: Bearer ${JWT}`, "wrapbox-jwt", "CREDENTIAL.TOKEN.JWT"],
  ["pem private key", PEM, "wrapbox-private-key-pem", "CREDENTIAL.PRIVATE_KEY.PEM"],
  ["gitleaks private key", PEM, "private-key", "CREDENTIAL.PRIVATE_KEY"],
  ["openssh private key", OPENSSH, "wrapbox-private-key-openssh", "CREDENTIAL.PRIVATE_KEY.OPENSSH"],
  ["pgp private key", PGP, "wrapbox-private-key-pgp", "CREDENTIAL.PRIVATE_KEY.PGP"],
  ["putty key", `PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: demo\nPublic-Lines: 2\n${fill(64, ALNUM + "+/")}\n${fill(20, ALNUM)}\nPrivate-Lines: 1\n${fill(64, ALNUM + "+/")}\nPrivate-MAC: ${fill(64, HEX)}`, "wrapbox-putty-private-key", "CREDENTIAL.PRIVATE_KEY"],
  ["postgres url", `DATABASE_URL=postgres://app:${PG_PASS}@db.internal:5432/app`, "wrapbox-connection-string-url", "CREDENTIAL.CONNECTION_STRING"],
  ["mongodb+srv url", `mongodb+srv://root:${fill(20, ALNUM)}@cluster0.example.mongodb.net/db?retryWrites=true`, "wrapbox-connection-string-url", "CREDENTIAL.CONNECTION_STRING"],
  ["ado.net connection string", `Server=tcp:sql.example.net,1433;Initial Catalog=orders;User ID=app;Password=${fill(20, ALNUM)};Encrypt=True`, "wrapbox-connection-string-kv", "CREDENTIAL.CONNECTION_STRING"],
  ["azure storage account key", `DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${fill(86, ALNUM + "+/")}==;EndpointSuffix=core.windows.net`, "wrapbox-azure-account-key", "CREDENTIAL.CONNECTION_STRING"],
  ["azure sas", `https://demo.blob.core.windows.net/c?sv=2022-11-02&ss=b&sig=${fill(40, ALNUM)}%3D`, "wrapbox-azure-sas", "CREDENTIAL.TOKEN"],
  ["gcp service account json", GCP_SA, "wrapbox-gcp-service-account", "CREDENTIAL.CLOUD_SERVICE_ACCOUNT"],
  ["assigned secret", `config.api_key = "${fill(32, ALNUM)}"`, "wrapbox-assigned-secret", "CREDENTIAL.GENERIC_HIGH_ENTROPY"],
  ["assigned password json", `{"password": "${fill(24, ALNUM + "!@#")}"}`, "wrapbox-assigned-secret", "CREDENTIAL.GENERIC_HIGH_ENTROPY"],
];

/** The value each positive sample carries — for the never-leaks assertion. */
function secretPart(text: string): string {
  const m = /(?:ghp_|github_pat_|AKIA|sk-ant-api03-|xoxb-|sk_live_|sk-proj-|glpat-|services\/|SG\.|SK[0-9a-f]|npm_|shpat_|dop_v1_|AGE-SECRET-KEY-1|dapi|hf_|AIza|PMAK-|dp\.pt\.|pscale_pw_|eyJ|BEGIN|Private-Lines|:\/\/|Password=|AccountKey=|sig=|private_key|api_key|"password")/.exec(text);
  return m ? text.slice(m.index + m[0].length, m.index + m[0].length + 24) : text.slice(0, 24);
}

test("detector is available and its rule corpus is honest about coverage", () => {
  assert.deepEqual(detector.available(), { ok: true });
  assert.equal(detector.descriptor.id, "wrapbox.secrets");
  assert.equal(detector.descriptor.version, "2.0.0");
  assert.equal(corpus.supported, corpus.rules.length);
  assert.ok(corpus.supported >= 200, `expected most of the corpus to translate, got ${corpus.supported}`);
  assert.ok(corpus.unsupported.length <= 3, `too many unsupported rules: ${JSON.stringify(corpus.unsupported)}`);
  for (const k of ["source", "license", "ref", "generatedAt", "supported", "unsupported"]) assert.ok(k in corpus, `header field ${k}`);
  assert.deepEqual(unsupportedRules.map((u) => u.id), corpus.unsupported.map((u) => u.id));
  const ids = ruleIds();
  assert.ok(corpus.rules.every((r) => ids.includes(r.id)), "every translated gitleaks rule is in force");
  assert.equal(ids.filter((id) => id.startsWith("wrapbox-")).length, 11, "wrapbox rules are in force");
  assert.equal(new Set(ids).size, ids.length, "rule ids are unique");
  const reg = dataTypes();
  for (const r of corpus.rules) assert.ok(reg.has(typeForGitleaksRule(r.id)), `${r.id} maps to a registry type`);
  for (const e of detector.descriptor.emits) assert.ok(reg.has(e.type));
});

test("every positive sample is found under its rule id with the mapped registry type", () => {
  const seen = new Set<string>();
  for (const [name, text, label, type] of POSITIVES) {
    const f = scan(text);
    assert.equal(lastError, null, `${name}: lastError ${lastError}`);
    const hit = byLabel(f, label);
    assert.ok(hit, `${name}: expected label ${label}, got ${JSON.stringify(labels(f))}`);
    assert.equal(hit.type, type, `${name}: type`);
    assert.equal(hit.count, 1, `${name}: distinct count`);
    assert.equal(hit.detector, "wrapbox.secrets");
    assert.equal(hit.version, "2.0.0");
    assert.ok(ruleIds().includes(hit.label!), `${name}: label is a rule id`);
    const roll = f.find((x) => x.type === "CREDENTIAL");
    assert.ok(roll && roll.count >= 1, `${name}: roll-up CREDENTIAL finding`);
    assertNoLeak(f, [secretPart(text), text]);
    seen.add(label);
  }
  assert.ok(seen.size >= 25, `distinct rules exercised: ${seen.size}`);
});

const NEGATIVES: Array<[string, string]> = [
  ["uuid", "request_id: 7f3c2a1e-9b4d-4c8e-a1f2-3d5e6f7a8b9c"],
  ["git sha", `commit ${fill(40, HEX)}`],
  ["sha256 hex digest", `sha256: ${fill(64, HEX)}`],
  ["md5 hex", `etag: "${fill(32, HEX)}"`],
  ["base64 png data uri", `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==">`],
  ["aws docs example access key", "aws_access_key_id = AKIAIOSFODNN7EXAMPLE"],
  ["aws docs example secret key", "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
  ["the word password", "Please enter your password to continue."],
  ["empty password assignment", 'password = ""'],
  ["placeholder password", "password: <your-password-here>"],
  ["env placeholder", "API_KEY=${API_KEY}"],
  ["email and ip", "contact ops@example.com from 10.0.0.12 about the outage"],
  ["semver and file path", "wrapboxd 1.4.2 reads /Users/demo/.config/wrapbox/config.json"],
  ["too-short jwt-like", "eyJab.eyJcd.ef"],
  ["prose", "The quick brown fox jumps over the lazy dog while the token bucket refills slowly."],
  ["low-entropy assignment", 'api_key = "aaaaaaaaaaaaaaaaaaaaaaaa"'],
  ["postgres url without credentials", "postgres://db.internal:5432/app?sslmode=require"],
];

test("negative samples produce no findings", () => {
  for (const [name, text] of NEGATIVES) {
    const f = scan(text);
    assert.equal(lastError, null, `${name}: lastError`);
    assert.deepEqual(f, [], `${name}: expected nothing, got ${JSON.stringify(labels(f))}`);
  }
});

test("counts are DISTINCT per rule and the roll-up is the union", () => {
  const a = `ghp_${fill(36, ALNUM)}`;
  const b = `ghp_${fill(36, ALNUM)}`;
  const pg = `postgres://u:${fill(18, ALNUM)}@h/db`;
  const text = [a, a, b, a, pg, pg, JWT, JWT].join("\n");
  const f = scan(text);
  assert.equal(byLabel(f, "github-pat")?.count, 2);
  assert.equal(byLabel(f, "wrapbox-connection-string-url")?.count, 1);
  assert.equal(byLabel(f, "wrapbox-jwt")?.count, 1);
  const roll = f.find((x) => x.type === "CREDENTIAL")!;
  // two PATs + one postgres password + one JWT (jwt and wrapbox-jwt isolate the same value)
  assert.equal(roll.count, 4);
  assert.equal(roll.confidence, "high");
  assertNoLeak(f, [a, b, pg, JWT]);
});

test("provider rules are high confidence, contextual and generic rules are medium", () => {
  assert.equal(byLabel(scan(`ghp_${fill(36, ALNUM)}`), "github-pat")?.confidence, "high");
  assert.equal(byLabel(scan(`AUTH_KEY=${fill(40, ALNUM)}`), "generic-api-key")?.confidence, "medium");
  assert.equal(byLabel(scan(`config.api_key = "${fill(32, ALNUM)}"`), "wrapbox-assigned-secret")?.confidence, "medium");
  assert.equal(byLabel(scan(`mailchimp_key = ${fill(32, HEX)}-us20`), "mailchimp-api-key")?.confidence, "medium");
});

test("entropy floors follow Gitleaks semantics (strictly greater) and the Wrapbox floor (at least)", () => {
  assert.equal(shannonEntropy(""), 0);
  assert.equal(shannonEntropy("aaaa"), 0);
  assert.equal(shannonEntropy("abcd"), 2);
  assert.ok(Math.abs(shannonEntropy("aab") - 0.9183) < 0.001);
  // github-pat needs entropy > 3: a repetitive body is rejected even though the shape matches.
  assert.equal(scan("ghp_" + "ab".repeat(18)).length, 0);
  // Wrapbox assigned-secret needs >= 3.0: eight distinct symbols evenly spread is exactly 3.0.
  assert.ok(byLabel(scan(`token = "${"abcdefgh".repeat(3)}"`), "wrapbox-assigned-secret"));
  assert.equal(scan(`token = "${"abcd".repeat(6)}"`).length, 0);
});

test("base64- and URL-encoded copies of tokens are still found, within bounds", () => {
  const pat = `ghp_${fill(36, ALNUM)}`;
  const b64 = Buffer.from(`export GITHUB_TOKEN=${pat}\n`).toString("base64");
  const f1 = scan(`payload: ${b64}`);
  assert.equal(byLabel(f1, "github-pat")?.count, 1);
  assertNoLeak(f1, [pat, b64]);

  const pg = `postgres://app:${fill(18, ALNUM)}@db.internal:5432/app`;
  const f2 = scan(`redirect=${encodeURIComponent(pg)}`);
  assert.equal(byLabel(f2, "wrapbox-connection-string-url")?.count, 1);
  assertNoLeak(f2, [pg]);

  // The same token in clear and encoded is one distinct value.
  const f3 = scan(`${pat}\n${b64}`);
  assert.equal(byLabel(f3, "github-pat")?.count, 1);
});

test("Gitleaks allowlists apply: stopwords and path allowlists clear a hit", () => {
  // generic-api-key stopword list contains "example"; the match itself is otherwise valid.
  const f = scan(`api_key = ${fill(20, ALNUM)}example${fill(10, ALNUM)}`);
  assert.equal(byLabel(f, "generic-api-key"), undefined);
  // global path allowlist: a lock file never counts, the same text elsewhere does.
  const text = `AUTH_KEY=${fill(40, ALNUM)}`;
  assert.ok(byLabel(scan(text, { filename: "src/config.ts" }), "generic-api-key"));
  assert.equal(byLabel(scan(text, { filename: "package-lock.json" }), "generic-api-key"), undefined);
});

test("table input reports the columns the values sat in, never the values", () => {
  const t1 = `ghp_${fill(36, ALNUM)}`;
  const t2 = `ghp_${fill(36, ALNUM)}`;
  const f = detector.detect({
    format: "csv", input: "table",
    table: { headers: ["user", "token", "note"], rows: [["ann", t1, "x"], ["bob", t2, "y"]] },
    unitPath: "zip[0]/users.csv",
  });
  const hit = byLabel(f, "github-pat")!;
  assert.equal(hit.count, 2);
  assert.deepEqual(hit.fields, ["token"]);
  assert.equal(hit.unitPath, "zip[0]/users.csv");
  assertNoLeak(f, [t1, t2]);
});

test("structured input is scanned through its JSON text", () => {
  const f = detector.detect({ format: "json", input: "structured", json: JSON.parse(GCP_SA) });
  assert.ok(byLabel(f, "wrapbox-gcp-service-account"));
  assertNoLeak(f, [GCP_SA.slice(60, 120)]);
});

test("fails closed on bad input and is bounded on large / adversarial input", () => {
  assert.deepEqual(detector.detect({ format: "text", input: "text" }), []);
  assert.equal(lastError, null);
  // 4 MiB of near-miss lines: every keyword is present, nothing is a secret.
  const line = 'curl -H "Authorization: Bearer x" --user a:b https://api.example.com/v1 token key secret password ghp_ AKIA xoxb- sk_live_ eyJ\n';
  const big = line.repeat(Math.ceil((MAX_SCAN_CHARS + 1000) / line.length));
  const t0 = Date.now();
  const f = scan(big);
  const ms = Date.now() - t0;
  assert.deepEqual(f, []);
  assert.ok(ms < TIME_BUDGET_MS + 1000, `scan took ${ms}ms`);
  // Beyond the cap is not scanned: a secret placed past MAX_SCAN_CHARS is not seen.
  const past = big.slice(0, MAX_SCAN_CHARS) + `\nghp_${fill(36, ALNUM)}`;
  assert.equal(byLabel(scan(past), "github-pat"), undefined);
});
