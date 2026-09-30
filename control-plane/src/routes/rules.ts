/**
 * Rules CRUD — admin creates/reads/updates/deletes rules.
 * GET  /v1/rules         — list rules for an org
 * POST /v1/rules         — create a rule
 * PUT  /v1/rules/:id     — update a rule
 * DELETE /v1/rules/:id   — deactivate a rule
 * GET  /v1/rules/pull    — devices pull their current rule set
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { client } from "../db/index.js";
import { resolveDevice, resolveAdmin } from "../auth.js";

/**
 * What a CONSTRAIN rule protects. At least one of fields/classes must be
 * present — a constraint that names nothing transforms nothing, and a rule
 * that claims to mask while masking nothing is worse than no rule at all.
 */
const ConstraintSchema = z.object({
  kind: z.enum(["reversible_tokenize", "redact"]),
  fields: z.array(z.string().min(1)).optional(),
  classes: z.array(z.string().min(1)).optional(),
  /** v2: Transform Registry handler + params (the runtime decides executability). */
  handler: z.enum(["REDACT", "MASK", "REVERSIBLE_TOKENIZE", "HASH", "DROP_FIELD", "GENERALIZE", "DATE_SHIFT", "FORMAT_PRESERVING", "LIMIT", "REWRITE"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).refine((c) => (c.fields?.length ?? 0) + (c.classes?.length ?? 0) > 0 || (c.handler === "LIMIT" && !!c.params), {
  message: "a constraint must name at least one field or data class to protect (or be a LIMIT with params)",
});

const RuleMeta = z.object({
  clause_id: z.string().optional(),
  contract_id: z.string().optional(),
  ir_schema: z.string().optional(),
  kind: z.enum(["clause", "carrier"]).optional(),
  coverage: z.enum(["enforced", "degraded", "understood_only", "pending"]).optional(),
}).passthrough();

const CreateRule = z.object({
  org_id: z.string(),
  project_id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  effect: z.enum(["allow", "constrain", "block", "review"]),
  priority: z.number().int().default(0),
  condition: z.any().optional(),
  constraint: ConstraintSchema.optional(),
  clause_id: z.string().optional(),
  contract_id: z.string().optional(),
  meta: RuleMeta.optional(),
});

const UpdateRule = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  effect: z.enum(["allow", "constrain", "block", "review"]).optional(),
  priority: z.number().int().optional(),
  condition: z.any().optional(),
  constraint: ConstraintSchema.nullable().optional(),
  active: z.boolean().optional(),
});

export async function rulesRoutes(app: FastifyInstance) {
  app.get("/v1/rules", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { org_id, project_id } = req.query as { org_id?: string; project_id?: string };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });

    const { rows } = project_id
      ? await client().execute({
          // active = 1 only. DELETE deactivates rather than dropping the row so
          // the history survives for audit, but a deactivated rule is NOT part
          // of the contract and must not come back in the admin list — that is
          // what made "delete" look like it did nothing.
          sql: "SELECT * FROM rules WHERE org_id = ? AND active = 1 AND (project_id IS NULL OR project_id = ?) ORDER BY priority DESC",
          args: [org_id, project_id],
        })
      : await client().execute({
          sql: "SELECT * FROM rules WHERE org_id = ? AND active = 1 ORDER BY priority DESC",
          args: [org_id],
        });

    return reply.send(rows);
  });

  app.post("/v1/rules", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = CreateRule.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    const r = parsed.data;

    // A CONSTRAIN rule with no constraint names no transform. The runtime would
    // have to either forward the body intact (the opposite of the rule) or
    // block it (not what the author asked for). Refuse it at authoring time,
    // where a human can still fix it, rather than at enforcement time.
    if (r.effect === "constrain" && !r.constraint) {
      return reply.code(400).send({
        error: "A CONSTRAIN rule must say what to protect",
        detail: "Add a constraint naming the fields or data classes to mask, e.g. { kind: 'reversible_tokenize', fields: ['Email','Phone'] }.",
      });
    }

    const id = nanoid();

    await client().execute({
      sql: "INSERT INTO rules (id, org_id, project_id, name, description, effect, priority, condition_json, constraint_json, clause_id, contract_id, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [id, r.org_id, r.project_id ?? null, r.name, r.description ?? null, r.effect, r.priority, r.condition ? JSON.stringify(r.condition) : null, r.constraint ? JSON.stringify(r.constraint) : null,
             r.clause_id ?? r.meta?.clause_id ?? null, r.contract_id ?? r.meta?.contract_id ?? null, r.meta ? JSON.stringify(r.meta) : null],
    });

    return reply.code(201).send({ id, ...r });
  });

  app.put("/v1/rules/:id", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = UpdateRule.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    const { rows } = await client().execute({ sql: "SELECT * FROM rules WHERE id = ?", args: [id] });
    if (rows.length === 0) return reply.code(404).send({ error: "Rule not found" });

    const updates = parsed.data;
    const sets: string[] = [];
    const args: (string | number | null)[] = [];

    if (updates.name !== undefined) { sets.push("name = ?"); args.push(updates.name); }
    if (updates.description !== undefined) { sets.push("description = ?"); args.push(updates.description); }
    if (updates.effect !== undefined) { sets.push("effect = ?"); args.push(updates.effect); }
    if (updates.priority !== undefined) { sets.push("priority = ?"); args.push(updates.priority); }
    if (updates.condition !== undefined) { sets.push("condition_json = ?"); args.push(JSON.stringify(updates.condition)); }
    if (updates.constraint !== undefined) { sets.push("constraint_json = ?"); args.push(updates.constraint ? JSON.stringify(updates.constraint) : null); }
    if (updates.active !== undefined) { sets.push("active = ?"); args.push(updates.active ? 1 : 0); }

    // Check the invariant against the state the row will END UP in, not just
    // the patch: clearing the constraint on an existing constrain rule, or
    // switching effect to constrain without supplying one, are both the same
    // unenforceable rule and both have to be refused.
    const nextEffect = updates.effect ?? String(rows[0].effect);
    const nextConstraint = updates.constraint !== undefined ? updates.constraint : rows[0].constraint_json;
    if (nextEffect === "constrain" && !nextConstraint) {
      return reply.code(400).send({
        error: "A CONSTRAIN rule must say what to protect",
        detail: "This change would leave a CONSTRAIN rule with no constraint, which the runtime cannot enforce.",
      });
    }

    if (sets.length > 0) {
      args.push(id);
      await client().execute({ sql: `UPDATE rules SET ${sets.join(", ")} WHERE id = ?`, args });
    }

    return reply.send({ id, updated: sets.length });
  });

  app.delete("/v1/rules/:id", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as { id: string };
    await client().execute({ sql: "UPDATE rules SET active = 0 WHERE id = ?", args: [id] });
    return reply.send({ id, deactivated: true });
  });

  // Device: pull current rules
  app.get("/v1/rules/pull", async (req, reply) => {
    const device = await resolveDevice(req);
    if (!device) return reply.code(401).send({ error: "Invalid API key" });

    const { rows } = await client().execute({
      sql: "SELECT id, name, description, effect, priority, condition_json, constraint_json, project_id, clause_id, contract_id, meta_json FROM rules WHERE org_id = ? AND active = 1 ORDER BY priority DESC",
      args: [device.org_id],
    });
    // The tenant's destination configuration rides along so every device
    // classifies hosts the same way the compiler did.
    const org = await client().execute({ sql: "SELECT destinations_json FROM orgs WHERE id = ?", args: [device.org_id] });
    const raw = org.rows[0]?.destinations_json;
    let destinations: unknown = undefined;
    if (raw) { try { destinations = JSON.parse(String(raw)); } catch { destinations = undefined; } }

    return reply.send({ rules: rows, pulled_at: new Date().toISOString(), ...(destinations ? { destinations } : {}) });
  });
}
