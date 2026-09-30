/**
 * Fabric: device-reported agent inventory.
 * POST /v1/agents  — device Bearer, batch upsert of what the daemon discovered locally
 * GET  /v1/agents  — admin, list inventory (filterable by device_id / registry_id)
 *
 * Key: (device_id, registry_id, where_). device_id / org_id come from auth only —
 * anything the body claims about them is ignored.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { client } from "../db/index.js";
import { resolveAdmin, resolveDevice } from "../auth.js";

const AgentEntry = z.object({
  registry_id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["cli", "ide", "desktop", "extension", "background"]),
  detected_via: z.enum(["bin", "app", "path", "extension"]),
  where: z.string().min(1),
  version: z.string().optional(),
});

const AgentsBody = z.object({
  agents: z.array(AgentEntry).min(0).max(500),
});

export async function agentsRoutes(app: FastifyInstance) {
  // Device: batch inventory upsert. Body-supplied device_id / org_id are ignored.
  app.post("/v1/agents", async (req, reply) => {
    const device = await resolveDevice(req);
    if (!device) return reply.code(401).send({ error: "Invalid or missing API key" });

    const parsed = AgentsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    let upserted = 0;
    for (const a of parsed.data.agents) {
      // Try INSERT first with a fresh id; ON CONFLICT on the (device_id, registry_id, where_) unique
      // index updates the existing row's mutable fields and refreshes last_seen_at.
      // agent_type is a legacy NOT NULL column on the agents table — keep it in sync with kind.
      await client().execute({
        sql: `INSERT INTO agents (id, device_id, org_id, name, agent_type, kind, detected_via, registry_id, where_, version, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(device_id, registry_id, where_) DO UPDATE SET
                name = excluded.name,
                agent_type = excluded.agent_type,
                kind = excluded.kind,
                detected_via = excluded.detected_via,
                version = excluded.version,
                last_seen_at = excluded.last_seen_at`,
        args: [
          nanoid(),
          device.id,
          device.org_id,
          a.name,
          a.kind,
          a.kind,
          a.detected_via,
          a.registry_id,
          a.where,
          a.version ?? null,
        ],
      });
      upserted++;
    }

    const { rows } = await client().execute({
      sql: "SELECT COUNT(*) AS n FROM agents WHERE device_id = ?",
      args: [device.id],
    });
    const seen = Number(rows[0]?.n ?? 0);

    return reply.send({ upserted, seen });
  });

  // Admin: list inventory
  app.get("/v1/agents", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { org_id, device_id, registry_id } = req.query as {
      org_id?: string; device_id?: string; registry_id?: string;
    };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });

    let sql = `SELECT id, device_id, org_id, name, kind, detected_via, registry_id,
                      where_ AS "where", version, last_seen_at, adapter_state, discovered_at AS created_at
               FROM agents WHERE org_id = ?`;
    const args: (string | number)[] = [org_id];
    if (device_id) { sql += " AND device_id = ?"; args.push(device_id); }
    if (registry_id) { sql += " AND registry_id = ?"; args.push(registry_id); }
    sql += " ORDER BY device_id, datetime(COALESCE(last_seen_at, discovered_at)) DESC";

    const { rows } = await client().execute({ sql, args });
    return reply.send(rows);
  });
}
