/**
 * Wrapbox Control Plane — the server that stores rules and answers
 * "is this allowed?" for every device running wrapboxd.
 */

import Fastify from "fastify";
import { initDb, close } from "./db/index.js";
import { orgsRoutes } from "./routes/orgs.js";
import { checkRoute } from "./routes/check.js";
import { rulesRoutes } from "./routes/rules.js";
import { devicesRoutes } from "./routes/devices.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { enrollTokensRoutes } from "./routes/enroll-tokens.js";
import { agentsRoutes } from "./routes/agents.js";

const PORT = Number(process.env.PORT) || 4100;

const app = Fastify({ logger: true });

/**
 * CORS for the admin dashboard. The admin key travels in a custom header, so
 * every browser call is preflighted — without this the OPTIONS 404s and the
 * dashboard cannot reach the API at all.
 *
 * Origins are allow-listed, never reflected blindly: loopback on any port
 * (the local dashboard) plus anything in CORS_ORIGIN (comma-separated). A
 * wildcard would let any site a user visits probe this server from their
 * browser and, with a guessed admin key, read the fleet.
 */
const EXTRA_ORIGINS = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function allowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (EXTRA_ORIGINS.includes(origin)) return origin;
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1") return origin;
  } catch {
    return null;
  }
  return null;
}

app.addHook("onRequest", async (req, reply) => {
  const origin = allowedOrigin(req.headers.origin);
  if (!origin) return;
  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  if (req.method === "OPTIONS") {
    reply.header("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization,x-admin-key");
    reply.header("access-control-max-age", "600");
    return reply.code(204).send();
  }
});

// Health check
app.get("/health", async () => ({ status: "ok", version: "0.1.0" }));

// Register routes
await orgsRoutes(app);
await checkRoute(app);
await rulesRoutes(app);
await devicesRoutes(app);
await evidenceRoutes(app);
await enrollTokensRoutes(app);
await agentsRoutes(app);

// Initialize DB (runs migrations)
await initDb();

// Start
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`\n  🔒 Wrapbox Control Plane running on http://localhost:${PORT}\n`);
} catch (err) {
  app.log.error(err);
  close();
  process.exit(1);
}

// Graceful shutdown
process.on("SIGINT", () => { close(); process.exit(0); });
process.on("SIGTERM", () => { close(); process.exit(0); });
