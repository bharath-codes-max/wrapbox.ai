import { createClient, type Client } from "@libsql/client";
import path from "node:path";
import { MIGRATIONS } from "./schema.js";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "wrapbox.db");

let _client: Client | null = null;

export function client(): Client {
  if (!_client) {
    _client = createClient({ url: `file:${DB_PATH}` });
  }
  return _client;
}

export async function initDb() {
  const c = client();
  await c.execute("CREATE TABLE IF NOT EXISTS _migrations (idx INTEGER PRIMARY KEY)");
  const { rows } = await c.execute("SELECT idx FROM _migrations");
  const applied = new Set(rows.map((r) => Number(r.idx)));

  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (!applied.has(i)) {
      await c.execute(MIGRATIONS[i]);
      await c.execute({ sql: "INSERT INTO _migrations (idx) VALUES (?)", args: [i] });
    }
  }
}

export function close() {
  if (_client) {
    _client.close();
    _client = null;
  }
}
