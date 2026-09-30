/**
 * Approvals — the REVIEW verdict.
 *
 * A device holds the request open and asks here. A human answers in the
 * dashboard. The device polls for that answer and then forwards or drops.
 *
 * WHY HOLDING IS THE ONLY HONEST DESIGN: the product's claim is "blocked
 * before it left the device". If the request were forwarded while a human
 * decided, the data would already be gone and the approval would be theatre.
 * So the socket stays open and nothing moves until someone answers or the
 * window expires.
 *
 * EXPIRY IS A DENY, NEVER AN ALLOW. A browser will not wait forever, so an
 * unanswered request has to resolve on its own — and "nobody answered" must
 * mean no. An approval that times open would turn a busy afternoon into an
 * open door.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { client } from "../db/index.js";
import { resolveAdmin, resolveDevice } from "../auth.js";

/** How long a held request may wait before it is denied. */
const TTL_MS = 120_000;

const CreateApproval = z.object({
  org_id: z.string(),
  rule_id: z.string().nullable().optional(),
  rule_name: z.string().optional(),
  /** What is being asked for — enough for a human to judge it. */
  summary: z.string().min(1),
  destination: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  client_label: z.string().optional(),
  service_label: z.string().optional(),
  content_kinds: z.array(z.string()).optional(),
  findings: z.array(z.string()).optional(),
  bytes: z.number().int().optional(),
});

const DecideApproval = z.object({
  decision: z.enum(["approved", "rejected"]),
  decided_by: z.string().optional(),
  note: z.string().optional(),
});

/** Resolve anything past its window to denied, so nothing hangs pending. */
async function expireStale() {
  await client().execute({
    sql: `UPDATE approvals
             SET state = 'expired', decided_at = datetime('now')
           WHERE state = 'pending' AND created_at < datetime('now', ?)`,
    args: [`-${Math.round(TTL_MS / 1000)} seconds`],
  });
}

export async function approvalsRoutes(app: FastifyInstance) {
  await client().execute(`CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    device_id TEXT REFERENCES devices(id),
    rule_id TEXT,
    rule_name TEXT,
    summary TEXT NOT NULL,
    destination TEXT,
    method TEXT,
    path TEXT,
    client_label TEXT,
    service_label TEXT,
    content_kinds TEXT,
    findings TEXT,
    bytes INTEGER,
    state TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending','approved','rejected','expired')),
    decided_by TEXT,
    note TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await client().execute(`CREATE INDEX IF NOT EXISTS idx_approvals_org_state ON approvals(org_id, state, created_at)`);

  /** Device opens a request and holds the socket. */
  app.post("/v1/approvals", async (req, reply) => {
    const device = await resolveDevice(req);
    if (!device) return reply.code(401).send({ error: "Invalid or missing API key" });

    const parsed = CreateApproval.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    const a = parsed.data;

    const id = nanoid();
    await client().execute({
      sql: `INSERT INTO approvals
              (id, org_id, device_id, rule_id, rule_name, summary, destination, method, path,
               client_label, service_label, content_kinds, findings, bytes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, a.org_id, device.id, a.rule_id ?? null, a.rule_name ?? null, a.summary,
        a.destination ?? null, a.method ?? null, a.path ?? null,
        a.client_label ?? null, a.service_label ?? null,
        a.content_kinds ? JSON.stringify(a.content_kinds) : null,
        a.findings ? JSON.stringify(a.findings) : null,
        a.bytes ?? null,
      ],
    });
    return reply.code(201).send({ id, state: "pending", expires_in_ms: TTL_MS });
  });

  /** Device polls for the answer. */
  app.get("/v1/approvals/:id", async (req, reply) => {
    const device = await resolveDevice(req);
    const admin = resolveAdmin(req);
    if (!device && !admin) return reply.code(401).send({ error: "Unauthorized" });

    await expireStale();
    const { id } = req.params as { id: string };
    const { rows } = await client().execute({ sql: "SELECT * FROM approvals WHERE id = ?", args: [id] });
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return reply.send(rows[0]);
  });

  /** Dashboard lists what is waiting. */
  app.get("/v1/approvals", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });
    await expireStale();

    const { org_id, state } = req.query as { org_id?: string; state?: string };
    if (!org_id) return reply.code(400).send({ error: "org_id required" });

    const { rows } = state
      ? await client().execute({
          sql: "SELECT * FROM approvals WHERE org_id = ? AND state = ? ORDER BY created_at DESC LIMIT 200",
          args: [org_id, state],
        })
      : await client().execute({
          sql: "SELECT * FROM approvals WHERE org_id = ? ORDER BY created_at DESC LIMIT 200",
          args: [org_id],
        });
    return reply.send(rows);
  });

  /** A human answers. */
  app.post("/v1/approvals/:id/decide", async (req, reply) => {
    if (!resolveAdmin(req)) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = DecideApproval.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    await expireStale();
    const { id } = req.params as { id: string };

    // Only a still-pending request can be answered. An expired one has already
    // been denied on the device, and flipping it to approved afterwards would
    // record an approval for something that was actually refused.
    const { rowsAffected } = await client().execute({
      sql: `UPDATE approvals
               SET state = ?, decided_by = ?, note = ?, decided_at = datetime('now')
             WHERE id = ? AND state = 'pending'`,
      args: [parsed.data.decision, parsed.data.decided_by ?? "admin", parsed.data.note ?? null, id],
    });

    if (!rowsAffected) {
      const { rows } = await client().execute({ sql: "SELECT state FROM approvals WHERE id = ?", args: [id] });
      if (!rows.length) return reply.code(404).send({ error: "Not found" });
      return reply.code(409).send({ error: "already_decided", state: rows[0].state });
    }

    const { rows } = await client().execute({ sql: "SELECT * FROM approvals WHERE id = ?", args: [id] });
    return reply.send(rows[0]);
  });
}
