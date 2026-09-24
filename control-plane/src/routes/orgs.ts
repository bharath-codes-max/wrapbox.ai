/**
 * Org management.
 * POST /v1/orgs   — create an org (admin)
 * GET  /v1/orgs   — list orgs (admin)
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { client } from "../db/index.js";
import { resolveAdmin } from "../auth.js";

const CreateOrg = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  region: z.string().default("us"),
});

const DestinationsBody = z.object({
  approvedAi: z.array(z.string()).default([]),
  approvedSaas: z.array(z.string()).default([]),
  internalDomains: z.array(z.string()).default([]),
  partnerDomains: z.array(z.string()).default([]),
  extraServices: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string(), hosts: z.array(z.string()), aliases: z.array(z.string()).default([]), inspection: z.enum(["default", "never"]).optional() })).default([]),
  exemptions: z.array(z.object({ pattern: z.string(), class: z.enum(["PERSONAL_EXEMPT", "INFRA_EXEMPT"]), label: z.string() })).default([]),
  groups: z.array(z.object({ id: z.string(), label: z.string(), members: z.array(z.string()) })).default([]),
});

export async function orgsRoutes(app: FastifyInstance) {
  app.post("/v1/orgs", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = CreateOrg.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    const o = parsed.data;
    const id = nanoid();

    await client().execute({
      sql: "INSERT INTO orgs (id, name, domain, region) VALUES (?, ?, ?, ?)",
      args: [id, o.name, o.domain ?? null, o.region],
    });

    return reply.code(201).send({ id, ...o });
  });

  // Tenant destination configuration (Destination Registry input).
  app.get("/v1/orgs/:id/destinations", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as { id: string };
    const { rows } = await client().execute({ sql: "SELECT destinations_json FROM orgs WHERE id = ?", args: [id] });
    if (!rows.length) return reply.code(404).send({ error: "no such org" });
    const raw = rows[0].destinations_json;
    return reply.send(raw ? JSON.parse(String(raw)) : { tenant: id, approvedAi: [], approvedSaas: [], internalDomains: [], partnerDomains: [], extraServices: [], exemptions: [], groups: [] });
  });

  app.put("/v1/orgs/:id/destinations", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as { id: string };
    const parsed = DestinationsBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    const cfg = { ...parsed.data, tenant: id };
    const res = await client().execute({ sql: "UPDATE orgs SET destinations_json = ? WHERE id = ?", args: [JSON.stringify(cfg), id] });
    if (res.rowsAffected === 0) return reply.code(404).send({ error: "no such org" });
    return reply.send(cfg);
  });

  app.get("/v1/orgs", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { rows } = await client().execute("SELECT * FROM orgs ORDER BY created_at DESC");
    return reply.send(rows);
  });
}
