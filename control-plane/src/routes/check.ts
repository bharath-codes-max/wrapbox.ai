/**
 * POST /v1/check — the core endpoint.
 * An agent on a device asks: "I want to run tool X with input Y — am I allowed?"
 * The Control Plane evaluates rules and returns allow / block / review.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { client } from "../db/index.js";
import { evaluate, type Rule } from "@wrapbox/policy-core";
import { resolveDevice } from "../auth.js";

const CheckBody = z.object({
  tool_name: z.string().min(1),
  tool_input: z.record(z.string(), z.unknown()).default({}),
  agent_id: z.string().optional(),
  project_id: z.string().optional(),
});

export async function checkRoute(app: FastifyInstance) {
  app.post("/v1/check", async (req, reply) => {
    const started = Date.now();

    // Authenticate device
    const device = await resolveDevice(req);
    if (!device) {
      return reply.code(401).send({ error: "Invalid or missing API key" });
    }

    // Parse body
    const parsed = CheckBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const call = parsed.data;

    // Update heartbeat — only after the request proved well-formed
    await client().execute({
      sql: "UPDATE devices SET last_heartbeat = datetime('now'), state = 'healthy' WHERE id = ?",
      args: [device.id],
    });

    // Load active rules for this org, optionally filtered by project
    const { rows } = await client().execute({
      sql: `SELECT id, name, effect, priority, condition_json
            FROM rules
            WHERE org_id = ? AND active = 1
              AND (project_id IS NULL OR project_id = ?)
            ORDER BY priority DESC`,
      args: [device.org_id, call.project_id ?? null],
    });

    const rules: Array<Rule & { condition_json: string | null }> = rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      effect: String(r.effect) as Rule["effect"],
      priority: Number(r.priority),
      condition: null,
      condition_json: r.condition_json ? String(r.condition_json) : null,
    }));

    // Evaluate
    const decision = evaluate(call, rules);
    const latencyMs = Date.now() - started;
    const decisionId = nanoid();

    // Record decision
    await client().execute({
      sql: `INSERT INTO decisions (id, org_id, device_id, agent_id, project_id, rule_id, tool_name, tool_input, effect, reason, latency_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        decisionId, device.org_id, device.id, call.agent_id ?? null,
        call.project_id ?? null, decision.matched_rule_id, call.tool_name,
        JSON.stringify(call.tool_input), decision.effect, decision.reason, latencyMs,
      ],
    });

    return reply.send({
      id: decisionId,
      decision: decision.effect,
      reason: decision.reason,
    });
  });
}
