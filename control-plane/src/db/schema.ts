/**
 * Database schema for the Wrapbox Control Plane.
 * SQLite via better-sqlite3 — lightweight, zero-config, single file.
 * Migrates to Postgres when we deploy to Railway.
 */

export const MIGRATIONS = [
  // 001: Core tables
  `CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    region TEXT DEFAULT 'us',
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    name TEXT NOT NULL,
    repo_url TEXT,
    path_pattern TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'block', 'review')),
    priority INTEGER DEFAULT 0,
    condition_json TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    hostname TEXT NOT NULL,
    os TEXT NOT NULL,
    arch TEXT,
    owner_email TEXT,
    api_key_hash TEXT NOT NULL,
    state TEXT DEFAULT 'enrolling' CHECK (state IN ('enrolling', 'healthy', 'heartbeat-lost', 'quarantined')),
    last_heartbeat TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id),
    org_id TEXT NOT NULL REFERENCES orgs(id),
    name TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    version TEXT,
    adapter_state TEXT DEFAULT 'provisioned' CHECK (adapter_state IN ('provisioned', 'tampered', 're-provisioned')),
    discovered_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    agent_id TEXT REFERENCES agents(id),
    project_id TEXT REFERENCES projects(id),
    rule_id TEXT REFERENCES rules(id),
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'block', 'review')),
    reason TEXT,
    receipt_sig TEXT,
    prev_receipt_hash TEXT,
    latency_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // Indexes for common queries
  `CREATE INDEX IF NOT EXISTS idx_decisions_org ON decisions(org_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_device ON decisions(device_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rules_org ON rules(org_id, active)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_device ON agents(device_id)`,

  // 012+: device signing keys + daemon state reported via heartbeat
  `ALTER TABLE devices ADD COLUMN public_key TEXT`,
  `ALTER TABLE devices ADD COLUMN key_id TEXT`,
  `ALTER TABLE devices ADD COLUMN daemon_version TEXT`,
  `ALTER TABLE devices ADD COLUMN ruleset_pulled_at TEXT`,
  `ALTER TABLE devices ADD COLUMN chain_head_seq INTEGER`,

  // Single-use enrollment tokens (stored hashed, never in plain text)
  `CREATE TABLE IF NOT EXISTS enroll_tokens (
    token_hash TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Signed receipts — the tamper-evident evidence chain
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    device_id TEXT NOT NULL REFERENCES devices(id),
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    body_json TEXT NOT NULL,
    sig TEXT NOT NULL,
    prev TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_receipts_device_seq ON receipts(device_id, seq)`,

  // Fabric: agent inventory reported by the device
  `ALTER TABLE agents ADD COLUMN kind TEXT`,
  `ALTER TABLE agents ADD COLUMN detected_via TEXT`,
  `ALTER TABLE agents ADD COLUMN registry_id TEXT`,
  `ALTER TABLE agents ADD COLUMN where_ TEXT`,
  `ALTER TABLE agents ADD COLUMN last_seen_at TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_agents_device_reg_where ON agents(device_id, registry_id, where_)`,

  // --- CONSTRAIN becomes a first-class effect -------------------------------
  //
  // `rules.effect` and `decisions.effect` carry CHECK (effect IN (...)) and
  // SQLite cannot ALTER a CHECK constraint — the table has to be rebuilt.
  // Done the documented way (https://sqlite.org/lang_altertable.html#caution):
  // create the new table, copy, drop, rename. Existing rows are untouched
  // because the new CHECK is a strict superset of the old one.
  //
  // `constraint_json` holds WHICH values a constrain rule protects. A constrain
  // rule without it is unenforceable and the evaluator downgrades it to block.
  `DROP TABLE IF EXISTS rules_v2`,
  `CREATE TABLE rules_v2 (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'constrain', 'block', 'review')),
    priority INTEGER DEFAULT 0,
    condition_json TEXT,
    constraint_json TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `INSERT OR IGNORE INTO rules_v2 (id, org_id, project_id, name, description, effect, priority, condition_json, constraint_json, active, created_at)
     SELECT id, org_id, project_id, name, description, effect, priority, condition_json, NULL, active, created_at FROM rules`,
  // Turn FKs off for the documented SQLite table-rebuild dance below
  // (https://sqlite.org/lang_altertable.html#otheralter): without this,
  // dropping `rules` fails SQLITE_CONSTRAINT_FOREIGNKEY because `decisions`
  // still references `rules.id`. FKs are turned back on after the rebuild.
  `PRAGMA foreign_keys = OFF`,
  `DROP TABLE rules`,
  `ALTER TABLE rules_v2 RENAME TO rules`,

  `DROP TABLE IF EXISTS decisions_v2`,
  `CREATE TABLE decisions_v2 (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    agent_id TEXT REFERENCES agents(id),
    project_id TEXT REFERENCES projects(id),
    rule_id TEXT,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'constrain', 'block', 'review')),
    reason TEXT,
    receipt_sig TEXT,
    prev_receipt_hash TEXT,
    latency_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `INSERT OR IGNORE INTO decisions_v2 (id, org_id, device_id, agent_id, project_id, rule_id, tool_name, tool_input, effect, reason, receipt_sig, prev_receipt_hash, latency_ms, created_at)
     SELECT id, org_id, device_id, agent_id, project_id, rule_id, tool_name, tool_input, effect, reason, receipt_sig, prev_receipt_hash, latency_ms, created_at FROM decisions`,
  `DROP TABLE decisions`,
  `ALTER TABLE decisions_v2 RENAME TO decisions`,
  // Restore FK enforcement now that the rebuild is complete. On a fresh
  // clone this leaves the connection with the same FK state the app has
  // relied on all along (libsql's default is ON).
  `PRAGMA foreign_keys = ON`,

  // ── v2: registry-driven policy ──────────────────────────────────────
  // Rule provenance (which IR clause / contract a rule was compiled from)
  // and the compiled coverage; the daemon echoes these into evidence.
  `ALTER TABLE rules ADD COLUMN clause_id TEXT`,
  `ALTER TABLE rules ADD COLUMN contract_id TEXT`,
  `ALTER TABLE rules ADD COLUMN meta_json TEXT`,
  // The device's capability snapshot, refreshed with every heartbeat, so the
  // compiler judges coverage against the real runtime.
  `ALTER TABLE devices ADD COLUMN capabilities_json TEXT`,
  `ALTER TABLE devices ADD COLUMN capabilities_at TEXT`,
  // The tenant's destination configuration (approved AI/SaaS, internal and
  // partner domains, exemptions, named groups). Pulled by every device.
  `ALTER TABLE orgs ADD COLUMN destinations_json TEXT`,
  // Policy IR contracts as compiled (the canonical artifact behind the rules).
  `CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    name TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
    ir_json TEXT NOT NULL,
    activation_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    activated_at TEXT
  )`,
];
