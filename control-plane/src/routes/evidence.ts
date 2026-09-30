/**
 * Evidence — decision log + the signed receipt chain.
 * GET  /v1/evidence          — query the decision log (admin)
 * GET  /v1/evidence/verify   — auditor: re-verify a device's receipt chain (admin)
 * GET  /v1/evidence/:id      — get a single decision with its receipt
 * POST /v1/evidence          — device pushes a batch of signed receipts
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { client } from "../db/index.js";
import { resolveAdmin, resolveDevice } from "../auth.js";
import { canonicalReceiptBytes, sha256hex } from "../lib/canonical.js";

// Loose shape check: required receipt-v1 fields, everything else passes through.
const ReceiptShape = z
  .object({
    v: z.number(),
    id: z.string().min(1),
    seq: z.number().int(),
    ts: z.string().min(1),
    device_id: z.string().min(1),
    key_id: z.string().min(1),
    effect: z.string().min(1),
    enforcement: z.string().min(1),
    prev: z.string().min(1),
    sig: z.string().min(1),
  })
  .passthrough();

const EvidenceBody = z.object({
  receipts: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
});

function verifyReceiptSig(receipt: Record<string, unknown>, publicKey: KeyObject): boolean {
  try {
    return cryptoVerify(
      "sha256",
      canonicalReceiptBytes(receipt),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(String(receipt.sig), "base64")
    );
  } catch {
    return false;
  }
}

export async function evidenceRoutes(app: FastifyInstance) {
  // Device: batch receipt ingest
  app.post("/v1/evidence", async (req, reply) => {
    const device = await resolveDevice(req);
    if (!device) return reply.code(401).send({ error: "Invalid or missing API key" });

    const parsed = EvidenceBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    const { rows: keyRows } = await client().execute({
      sql: "SELECT public_key FROM devices WHERE id = ?",
      args: [device.id],
    });
    const publicKeyPem = keyRows[0]?.public_key ? String(keyRows[0].public_key) : null;
    let publicKey: KeyObject | null = null;
    try {
      publicKey = publicKeyPem ? createPublicKey(publicKeyPem) : null;
    } catch {
      publicKey = null;
    }

    let accepted = 0;
    let duplicates = 0;
    const rejected: Array<{ id: string; reason: string }> = [];

    for (const raw of parsed.data.receipts) {
      const shape = ReceiptShape.safeParse(raw);
      if (!shape.success) {
        rejected.push({ id: typeof raw.id === "string" ? raw.id : "", reason: "invalid_shape" });
        continue;
      }
      const r = shape.data as Record<string, unknown> & z.infer<typeof ReceiptShape>;

      if (r.device_id !== device.id) {
        rejected.push({ id: r.id, reason: "device_mismatch" });
        continue;
      }
      if (!publicKey) {
        rejected.push({ id: r.id, reason: "no_device_key" });
        continue;
      }
      if (!verifyReceiptSig(r, publicKey)) {
        rejected.push({ id: r.id, reason: "bad_signature" });
        continue;
      }

      // Continuity (seq/prev) is deliberately NOT checked at ingest — /v1/evidence/verify recomputes it.
      const res = await client().execute({
        sql: `INSERT OR IGNORE INTO receipts (id, org_id, device_id, seq, ts, body_json, sig, prev, verified)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [r.id, device.org_id, device.id, r.seq, r.ts, JSON.stringify(r), r.sig, r.prev],
      });
      if (res.rowsAffected === 0) duplicates++;
      else accepted++;
    }

    return reply.send({ accepted, duplicates, rejected });
  });

  // Admin: auditor — walk a device's chain and re-verify everything
  app.get("/v1/evidence/verify", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { device_id, org_id } = req.query as { device_id?: string; org_id?: string };
    if (!device_id || !org_id) return reply.code(400).send({ error: "org_id and device_id required" });

    const { rows: devRows } = await client().execute({
      sql: "SELECT id, key_id, public_key FROM devices WHERE id = ? AND org_id = ?",
      args: [device_id, org_id],
    });
    if (devRows.length === 0) return reply.code(404).send({ error: "Unknown device" });
    const keyId = devRows[0].key_id ? String(devRows[0].key_id) : "";
    let publicKey: KeyObject | null = null;
    try {
      publicKey = devRows[0].public_key ? createPublicKey(String(devRows[0].public_key)) : null;
    } catch {
      publicKey = null;
    }

    const { rows } = await client().execute({
      sql: "SELECT seq, body_json FROM receipts WHERE device_id = ? ORDER BY seq ASC",
      args: [device_id],
    });

    const breaks: Array<{ seq: number; kind: "bad_signature" | "chain_broken" | "seq_gap"; detail: string }> = [];
    let verifiedThroughSeq = 0;
    let broken = false;
    let prevBody: Record<string, unknown> | null = null;
    let prevSeq: number | null = null;

    const genesisPrev = sha256hex(`${device_id}:${keyId}`);

    for (const row of rows) {
      const seq = Number(row.seq);
      const body = JSON.parse(String(row.body_json)) as Record<string, unknown>;
      let ok = true;

      if (!publicKey || !verifyReceiptSig(body, publicKey)) {
        breaks.push({ seq, kind: "bad_signature", detail: publicKey ? "signature does not verify against the device public key" : "device has no public key on file" });
        ok = false;
      }

      if (prevSeq === null) {
        if (seq !== 1) {
          breaks.push({ seq, kind: "seq_gap", detail: `chain starts at seq ${seq}, expected 1` });
          ok = false;
        } else if (body.prev !== genesisPrev) {
          breaks.push({ seq, kind: "chain_broken", detail: `genesis prev mismatch: expected sha256(device_id + ":" + key_id) = ${genesisPrev}` });
          ok = false;
        }
      } else if (seq !== prevSeq + 1) {
        breaks.push({ seq, kind: "seq_gap", detail: `expected seq ${prevSeq + 1}, got ${seq}` });
        ok = false;
      } else if (prevBody) {
        // prev must equal sha256 of the previous receipt's canonical bytes, recomputed from stored body_json
        const expectedPrev = sha256hex(canonicalReceiptBytes(prevBody));
        if (body.prev !== expectedPrev) {
          breaks.push({ seq, kind: "chain_broken", detail: `prev hash mismatch: expected ${expectedPrev}` });
          ok = false;
        }
      }

      if (!ok) broken = true;
      if (!broken) verifiedThroughSeq = seq;

      prevBody = body;
      prevSeq = seq;
    }

    return reply.send({
      device_id,
      total: rows.length,
      verified_through_seq: verifiedThroughSeq,
      chain_ok: breaks.length === 0,
      breaks,
    });
  });

  app.get("/v1/evidence", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { org_id, device_id, agent_id, effect, limit } = req.query as {
      org_id?: string; device_id?: string; agent_id?: string; effect?: string; limit?: string;
    };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });

    const take = Math.min(Number(limit) || 50, 200);
    let sql = "SELECT * FROM decisions WHERE org_id = ?";
    const args: (string | number | null)[] = [org_id];

    if (device_id) { sql += " AND device_id = ?"; args.push(device_id); }
    if (agent_id) { sql += " AND agent_id = ?"; args.push(agent_id); }
    if (effect) { sql += " AND effect = ?"; args.push(effect); }

    sql += " ORDER BY created_at DESC LIMIT ?";
    args.push(take);

    const { rows } = await client().execute({ sql, args });
    return reply.send(rows);
  });

  // Admin: signed receipts pushed by devices (the daemon-enforced side of the log)
  app.get("/v1/receipts", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { org_id, device_id, effect, limit } = req.query as {
      org_id?: string; device_id?: string; effect?: string; limit?: string;
    };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });

    const take = Math.min(Number(limit) || 50, 200);
    let sql = "SELECT id, device_id, seq, ts, body_json, verified, created_at FROM receipts WHERE org_id = ?";
    const args: (string | number)[] = [org_id];
    if (device_id) { sql += " AND device_id = ?"; args.push(device_id); }
    if (effect) { sql += " AND json_extract(body_json, '$.effect') = ?"; args.push(effect); }
    sql += " ORDER BY device_id, seq DESC LIMIT ?";
    args.push(take);

    const { rows } = await client().execute({ sql, args });
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        device_id: r.device_id,
        seq: Number(r.seq),
        ts: r.ts,
        verified: Number(r.verified) === 1,
        created_at: r.created_at,
        receipt: JSON.parse(String(r.body_json)),
      })),
    );
  });

  app.get("/v1/evidence/:id", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const { rows } = await client().execute({ sql: "SELECT * FROM decisions WHERE id = ?", args: [id] });
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });

    return reply.send(rows[0]);
  });
}
