/**
 * `wrapboxd verify` — walk the local receipt spool and verify the chain:
 * signature (device.pub), prev linkage, and seq continuity.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { loadConfig, PATHS } from "../config.js";
import { stableStringify, sha256hex } from "../canonical.js";
import type { Receipt } from "../receipts.js";

export async function cmdVerify(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("✖ Not enrolled — nothing to verify.");
    return 1;
  }
  let publicPem: string;
  try {
    publicPem = fs.readFileSync(PATHS.devicePub, "utf-8");
  } catch {
    console.error(`✖ Missing public key: ${PATHS.devicePub}`);
    return 1;
  }
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(PATHS.spoolFile, "utf-8").split("\n").filter((l) => l.trim() !== "");
  } catch {
    console.log("Chain OK: 0 receipts (empty spool).");
    return 0;
  }

  const publicKey = crypto.createPublicKey(publicPem);
  let prevHash = ""; // computed lazily from the first receipt's identity fields
  let prevSeq = 0;

  for (let i = 0; i < lines.length; i++) {
    let receipt: Receipt;
    try {
      receipt = JSON.parse(lines[i]);
    } catch {
      console.error(`✖ BREAK at line ${i + 1}: unparseable receipt`);
      return 1;
    }
    const { sig, ...unsigned } = receipt;
    const canonical = Buffer.from(stableStringify(unsigned), "utf-8");

    const ok = crypto.verify("sha256", canonical, { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64"));
    if (!ok) {
      console.error(`✖ BREAK at seq ${receipt.seq}: bad_signature`);
      return 1;
    }
    if (i === 0) {
      const genesis = sha256hex(receipt.device_id + ":" + receipt.key_id);
      if (receipt.prev !== genesis) {
        console.error(`✖ BREAK at seq ${receipt.seq}: chain_broken (genesis prev mismatch)`);
        return 1;
      }
    } else {
      if (receipt.prev !== prevHash) {
        console.error(`✖ BREAK at seq ${receipt.seq}: chain_broken (prev mismatch)`);
        return 1;
      }
      if (receipt.seq !== prevSeq + 1) {
        console.error(`✖ BREAK at seq ${receipt.seq}: seq_gap (expected ${prevSeq + 1})`);
        return 1;
      }
    }
    prevHash = sha256hex(canonical);
    prevSeq = receipt.seq;
  }

  console.log(`Chain OK: ${lines.length} receipt(s), verified through seq ${prevSeq}.`);
  return 0;
}
