/**
 * Enrollment tokens.
 * POST /v1/enroll-tokens — admin mints a single-use, time-limited token
 * that a new device presents at /v1/devices/enroll.
 * Only the sha256 of the token is stored.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { client } from "../db/index.js";
import { resolveAdmin } from "../auth.js";

const CreateToken = z.object({
  org_id: z.string().min(1),
  ttl_hours: z.number().int().min(1).max(168).default(24),
});

export async function enrollTokensRoutes(app: FastifyInstance) {
  app.post("/v1/enroll-tokens", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = CreateToken.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    const { org_id, ttl_hours } = parsed.data;

    const { rows } = await client().execute({ sql: "SELECT id FROM orgs WHERE id = ?", args: [org_id] });
    if (rows.length === 0) return reply.code(400).send({ error: "Unknown org_id" });

    const token = `wbxe_${randomBytes(24).toString("hex")}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + ttl_hours * 3600_000).toISOString();

    await client().execute({
      sql: "INSERT INTO enroll_tokens (token_hash, org_id, expires_at) VALUES (?, ?, ?)",
      args: [tokenHash, org_id, expiresAt],
    });

    return reply.code(201).send({ token, org_id, expires_at: expiresAt });
  });
}
