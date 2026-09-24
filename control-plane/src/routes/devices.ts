/**
 * Device registration and management.
 * POST /v1/devices/enroll  — a new machine registers itself (requires an enrollment token)
 * POST /v1/devices/heartbeat — daemon pings every 60s (optional state report body)
 * GET  /v1/devices         — admin lists all devices in the org
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { client } from "../db/index.js";
import { resolveAdmin, resolveDevice } from "../auth.js";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const EnrollBody = z.object({
  org_id: z.string(),
  enroll_token: z.string().min(1),
  hostname: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().optional(),
  owner_email: z.string().email().optional(),
  public_key: z.string().min(1),
});

const HeartbeatBody = z.object({
  daemon_version: z.string().optional(),
  ruleset_pulled_at: z.string().optional(),
  chain_head_seq: z.number().int().optional(),
  /** Runtime capability snapshot (RuntimeSnapshot from @wrapbox/registry). Stored verbatim; bounded. */
  capabilities: z.any().optional(),
});

/** Accept only an SPKI PEM that parses as an EC P-256 public key. */
function validateP256PublicKey(pem: string): boolean {
  try {
    const key = createPublicKey(pem);
    return key.type === "public" && key.asymmetricKeyType === "ec" &&
      key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

export async function devicesRoutes(app: FastifyInstance) {
  // Enroll a new device — returns the API key (shown once, never stored in plain text)
  app.post("/v1/devices/enroll", async (req, reply) => {
    const parsed = EnrollBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    const d = parsed.data;
    if (!validateP256PublicKey(d.public_key)) {
      return reply.code(400).send({ error: "public_key must be an EC P-256 public key in SPKI PEM format" });
    }

    // Enrollment token: exists (by hash), not expired, not used, org matches.
    // One generic 401 for every failure mode — never help an attacker distinguish.
    const tokenHash = hashKey(d.enroll_token);
    const invalidToken = () => reply.code(401).send({ error: "Invalid or expired enrollment token" });

    const { rows: tokenRows } = await client().execute({
      sql: "SELECT org_id, expires_at, used_at FROM enroll_tokens WHERE token_hash = ?",
      args: [tokenHash],
    });
    if (tokenRows.length === 0) return invalidToken();
    const t = tokenRows[0];
    if (t.used_at != null) return invalidToken();
    if (String(t.org_id) !== d.org_id) return invalidToken();
    if (new Date(String(t.expires_at)).getTime() <= Date.now()) return invalidToken();

    // Mark used atomically — a concurrent enroll with the same token loses here.
    const used = await client().execute({
      sql: "UPDATE enroll_tokens SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL",
      args: [tokenHash],
    });
    if (used.rowsAffected === 0) return invalidToken();

    const id = nanoid();
    const apiKey = `wbx_${randomBytes(32).toString("hex")}`;
    const keyHash = hashKey(apiKey);
    const keyId = `dk_${hashKey(d.public_key).slice(0, 16)}`;

    await client().execute({
      sql: `INSERT INTO devices (id, org_id, hostname, os, arch, owner_email, api_key_hash, public_key, key_id, state, last_heartbeat)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', datetime('now'))`,
      args: [id, d.org_id, d.hostname, d.os, d.arch ?? null, d.owner_email ?? null, keyHash, d.public_key, keyId],
    });

    return reply.code(201).send({
      id,
      api_key: apiKey,
      key_id: keyId,
      message: "Save this API key — it will not be shown again.",
    });
  });

  // Heartbeat — optional body reports daemon state
  app.post("/v1/devices/heartbeat", async (req, reply) => {
    const device = await resolveDevice(req);
    if (!device) return reply.code(401).send({ error: "Invalid or missing API key" });

    const parsed = HeartbeatBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    const b = parsed.data;

    const caps = b.capabilities && typeof b.capabilities === "object" ? JSON.stringify(b.capabilities) : null;
    if (caps && caps.length > 512 * 1024) return reply.code(413).send({ error: "capability snapshot too large" });
    await client().execute({
      sql: `UPDATE devices SET last_heartbeat = datetime('now'), state = 'healthy',
              daemon_version = COALESCE(?, daemon_version),
              ruleset_pulled_at = COALESCE(?, ruleset_pulled_at),
              chain_head_seq = COALESCE(?, chain_head_seq),
              capabilities_json = COALESCE(?, capabilities_json),
              capabilities_at = CASE WHEN ? IS NULL THEN capabilities_at ELSE datetime('now') END
            WHERE id = ?`,
      args: [b.daemon_version ?? null, b.ruleset_pulled_at ?? null, b.chain_head_seq ?? null, caps, caps, device.id],
    });

    return reply.send({ status: "ok", device_id: device.id });
  });

  // Admin: one device's capability snapshot (what the compiler judges coverage against)
  app.get("/v1/devices/:id/capabilities", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as { id: string };
    const { rows } = await client().execute({ sql: "SELECT capabilities_json, capabilities_at, last_heartbeat FROM devices WHERE id = ?", args: [id] });
    if (!rows.length) return reply.code(404).send({ error: "no such device" });
    const raw = rows[0].capabilities_json;
    return reply.send({ device_id: id, capabilities_at: rows[0].capabilities_at ?? null, last_heartbeat: rows[0].last_heartbeat ?? null, capabilities: raw ? JSON.parse(String(raw)) : null });
  });

  // Admin: the org's most recent snapshot (any device) — the compiler's default runtime.
  app.get("/v1/capabilities", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { org_id } = req.query as { org_id?: string };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });
    const { rows } = await client().execute({ sql: "SELECT id, capabilities_json, capabilities_at FROM devices WHERE org_id = ? AND capabilities_json IS NOT NULL ORDER BY capabilities_at DESC LIMIT 1", args: [org_id] });
    if (!rows.length) return reply.send({ device_id: null, capabilities: null });
    return reply.send({ device_id: rows[0].id, capabilities_at: rows[0].capabilities_at, capabilities: JSON.parse(String(rows[0].capabilities_json)) });
  });

  // Admin: list all devices
  app.get("/v1/devices", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { org_id } = req.query as { org_id?: string };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });

    const { rows } = await client().execute({
      sql: `SELECT d.id, d.hostname, d.os, d.arch, d.owner_email, d.state, d.last_heartbeat,
                   d.key_id, d.daemon_version, d.ruleset_pulled_at, d.chain_head_seq, d.created_at,
                   (SELECT COUNT(*) FROM agents a WHERE a.device_id = d.id) AS agent_count
            FROM devices d WHERE d.org_id = ? ORDER BY d.created_at DESC`,
      args: [org_id],
    });

    return reply.send(rows);
  });
}
