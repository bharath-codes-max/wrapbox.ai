/**
 * Receipt canonicalization — MUST match the runtime byte-for-byte (SPEC-wire.md).
 * Canonical bytes = UTF-8 of stableStringify(receipt without "sig").
 */

import { createHash } from "node:crypto";

/** JSON.stringify with object keys sorted lexicographically at every nesting level. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as object).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}

export function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical bytes of a receipt: the stable-stringified body with `sig` removed. */
export function canonicalReceiptBytes(receipt: Record<string, unknown>): Buffer {
  const { sig: _sig, ...body } = receipt;
  return Buffer.from(stableStringify(body), "utf8");
}
