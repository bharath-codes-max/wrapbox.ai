/**
 * Canonicalization for the evidence chain — MUST match the control plane
 * byte-for-byte (SPEC-wire): JSON with object keys sorted lexicographically
 * at every nesting level, arrays in order, no added whitespace.
 */

import crypto from "node:crypto";

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as object).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}

export function sha256hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
