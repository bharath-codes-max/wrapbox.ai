/**
 * Signed, hash-chained evidence receipts (receipt schema v1 — SPEC-wire).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { stableStringify, sha256hex } from "./canonical.js";
import { PATHS, type Config } from "./config.js";
import { pushEvidence } from "./api.js";
import type { EvidenceV2 } from "@wrapbox/registry";

export interface Receipt {
  v: 1;
  id: string;
  seq: number;
  ts: string;
  device_id: string;
  key_id: string;
  agent: string;
  session: string;
  tool_name: string;
  tool_input_sha256: string;
  target: string;
  /**
   * "constrain" = the request WAS forwarded, but only after the runtime
   * rewrote the body so protected values never left the device. Evidence must
   * distinguish it from "allow" (passed unchanged) — conflating them is what
   * lets a masking failure read as a success.
   */
  effect: "allow" | "constrain" | "block" | "review" | "tamper" | "violation";
  reason: string;
  rule_id: string | null;
  ruleset_pulled_at: string | null;
  /** "proxy" = decided on hostname alone; "mitm" = TLS terminated and body inspected. */
  enforcement: "hook" | "seatbelt" | "both" | "unwrapped" | "hook-degraded" | "proxy" | "mitm";
  /** Which browser or tool made the request, from its User-Agent. Attribution
   *  only — never an input to the decision, since a User-Agent can be forged. */
  client?: string;
  /** Human label for `client`, e.g. "Chrome" or an unrecognised product token. */
  client_label?: string;
  /** The destination as a known service ("openai", "claude") when recognised. */
  service?: string;
  service_label?: string;
  degraded: boolean;
  /** Evidence v2: canonical types, detectors, destination class, transform,
   *  capability status and why any fail-closed action happened. Additive —
   *  v1 fields are unchanged and the signature covers everything. */
  evidence?: EvidenceV2;
  prev: string;
  sig: string;
}

export interface DaemonState {
  seq: number;
  head_hash: string;
  hooks_hash?: string;
  hooks_path?: string;
}

export function keyIdFromPublicPem(publicPem: string): string {
  return "dk_" + sha256hex(publicPem).slice(0, 16);
}

/** Generate the device EC P-256 keypair if missing. Never logs key material. */
export function ensureKeypair(): { privatePem: string; publicPem: string; keyId: string } {
  fs.mkdirSync(PATHS.keysDir, { recursive: true });
  if (fs.existsSync(PATHS.deviceKey) && fs.existsSync(PATHS.devicePub)) {
    const privatePem = fs.readFileSync(PATHS.deviceKey, "utf-8");
    const publicPem = fs.readFileSync(PATHS.devicePub, "utf-8");
    return { privatePem, publicPem, keyId: keyIdFromPublicPem(publicPem) };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  fs.writeFileSync(PATHS.deviceKey, privatePem, { mode: 0o600 });
  fs.chmodSync(PATHS.deviceKey, 0o600);
  fs.writeFileSync(PATHS.devicePub, publicPem, { mode: 0o644 });
  return { privatePem, publicPem, keyId: keyIdFromPublicPem(publicPem) };
}

export function loadState(): DaemonState {
  try {
    const s = JSON.parse(fs.readFileSync(PATHS.stateFile, "utf-8"));
    if (typeof s.seq === "number") return s;
  } catch {
    /* fresh state */
  }
  return { seq: 0, head_hash: "" };
}

/** Atomic write: tmp + rename, so a crash never leaves a torn state file. */
export function saveState(state: DaemonState): void {
  fs.mkdirSync(PATHS.home, { recursive: true });
  const tmp = PATHS.stateFile + ".tmp-" + process.pid + "-" + nanoid(6);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, PATHS.stateFile);
}

export interface ReceiptFields {
  agent: string;
  session: string;
  tool_name: string;
  tool_input: unknown;
  target: string;
  effect: Receipt["effect"];
  reason: string;
  rule_id: string | null;
  ruleset_pulled_at: string | null;
  enforcement: Receipt["enforcement"];
  degraded: boolean;
  client?: string;
  client_label?: string;
  service?: string;
  service_label?: string;
  evidence?: EvidenceV2;
}

/**
 * Build, sign and chain one receipt. Advances state.json (seq, head_hash)
 * atomically. Genesis prev = sha256(device_id + ":" + key_id).
 */
export function makeReceipt(cfg: Pick<Config, "device_id" | "key_id">, fields: ReceiptFields): Receipt {
  const { privatePem } = ensureKeypair();
  const state = loadState();
  const seq = state.seq + 1;
  const prev = state.seq === 0 || !state.head_hash
    ? sha256hex(cfg.device_id + ":" + cfg.key_id)
    : state.head_hash;

  const unsigned: Omit<Receipt, "sig"> = {
    v: 1,
    id: nanoid(),
    seq,
    ts: new Date().toISOString(),
    device_id: cfg.device_id,
    key_id: cfg.key_id,
    agent: fields.agent,
    session: fields.session,
    tool_name: fields.tool_name,
    tool_input_sha256: sha256hex(JSON.stringify(fields.tool_input)),
    target: fields.target,
    effect: fields.effect,
    reason: fields.reason,
    rule_id: fields.rule_id,
    ruleset_pulled_at: fields.ruleset_pulled_at,
    enforcement: fields.enforcement,
    ...(fields.client ? { client: fields.client } : {}),
    ...(fields.client_label ? { client_label: fields.client_label } : {}),
    ...(fields.service ? { service: fields.service } : {}),
    ...(fields.service_label ? { service_label: fields.service_label } : {}),
    degraded: fields.degraded,
    ...(fields.evidence ? { evidence: fields.evidence } : {}),
    prev,
  };

  const canonical = Buffer.from(stableStringify(unsigned), "utf-8");
  const sig = crypto
    .sign("sha256", canonical, { key: crypto.createPrivateKey(privatePem), dsaEncoding: "ieee-p1363" })
    .toString("base64");

  saveState({ ...state, seq, head_hash: sha256hex(canonical) });
  return { ...unsigned, sig };
}

export function appendToSpool(receipt: Receipt): void {
  fs.mkdirSync(path.dirname(PATHS.spoolFile), { recursive: true });
  fs.appendFileSync(PATHS.spoolFile, JSON.stringify(receipt) + "\n");
}

function readSentCount(): number {
  try {
    const n = parseInt(fs.readFileSync(PATHS.sentFile, "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function spoolDepth(): { total: number; sent: number; unsent: number } {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(PATHS.spoolFile, "utf-8").split("\n").filter((l) => l.trim() !== "");
  } catch {
    /* no spool yet */
  }
  const sent = readSentCount();
  return { total: lines.length, sent, unsent: Math.max(0, lines.length - sent) };
}

/**
 * Drain unsent spool lines to POST /v1/evidence in batches of <=100.
 * Advances receipts.sent only on a 200 response.
 */
export async function drainSpool(cfg: Config): Promise<{ accepted: number; duplicates: number; rejected: unknown[] }> {
  const totals = { accepted: 0, duplicates: 0, rejected: [] as unknown[] };
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(PATHS.spoolFile, "utf-8").split("\n").filter((l) => l.trim() !== "");
  } catch {
    return totals;
  }
  let sent = readSentCount();
  while (sent < lines.length) {
    const batch = lines.slice(sent, sent + 100).map((l) => JSON.parse(l) as Receipt);
    const res = await pushEvidence(cfg, batch); // throws on non-200 — caller handles
    totals.accepted += res.accepted ?? 0;
    totals.duplicates += res.duplicates ?? 0;
    if (Array.isArray(res.rejected)) totals.rejected.push(...res.rejected);
    sent += batch.length;
    fs.writeFileSync(PATHS.sentFile, String(sent) + "\n");
  }
  return totals;
}
