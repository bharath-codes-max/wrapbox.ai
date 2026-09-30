/**
 * Authentication helpers.
 * Devices authenticate with Bearer API keys (hashed in the DB).
 * Admins authenticate with a simple admin key (for now — OIDC later).
 */

import { createHash } from "node:crypto";
import { FastifyRequest } from "fastify";
import { client } from "./db/index.js";

const ADMIN_KEY = process.env.ADMIN_KEY || "wbx-admin-dev";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface DeviceAuth {
  id: string;
  org_id: string;
  hostname: string;
  os: string;
  state: string;
}

/** Resolve a device from the Bearer token in the Authorization header. */
export async function resolveDevice(req: FastifyRequest): Promise<DeviceAuth | null> {
  const authHeader = req.headers.authorization;
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!rawKey || !rawKey.startsWith("wbx_")) return null;

  const keyHash = hashKey(rawKey);
  const { rows } = await client().execute({
    sql: "SELECT id, org_id, hostname, os, state FROM devices WHERE api_key_hash = ?",
    args: [keyHash],
  });

  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: String(r.id), org_id: String(r.org_id), hostname: String(r.hostname), os: String(r.os), state: String(r.state) };
}

/** Resolve admin access from the X-Admin-Key header. */
export function resolveAdmin(req: FastifyRequest): boolean {
  const key = req.headers["x-admin-key"];
  return key === ADMIN_KEY;
}
