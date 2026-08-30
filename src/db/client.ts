import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

function createClient(env: Env): Sql {
  const cs = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL / HYPERDRIVE belum di-set");
  return postgres(cs, {
    max: 2,
    idle_timeout: 0,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: bigint) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  });
}

interface DbHandle {
  client: Sql;
  db: Db;
}

function createHandle(env: Env): DbHandle {
  const client = createClient(env);
  return { client, db: drizzle(client, { schema }) };
}

// Untuk scheduled handler (tidak ada Hono context) — wajib end() manual via handle.client.
export function createDb(env: Env): DbHandle {
  return createHandle(env);
}

// Client per-request, disimpan di Hono context. CF Workers: binding/env object
// DI-SHARE antar request dalam satu isolate, jadi cache module-level/WeakMap
// akan memakai ulang socket request sebelumnya -> "Cannot perform I/O on behalf
// of a different request". Satu request = satu client = satu socket = aman.
export function getDb(c: Context<AppEnv>): Db {
  const existing = c.get("db");
  if (existing) return existing.db;
  const handle = createHandle(c.env);
  c.set("db", handle);
  return handle.db;
}

// Tutup client dalam konteks request yang sama (dipanggil dari middleware
// finally). Krusial di jalur ERROR: kalau handler lempar, client yang bocor
// punya pending write yang baru mengeksekusi di request berikutnya -> I/O error.
export async function closeDb(c: Context<AppEnv>): Promise<void> {
  const handle = c.get("db");
  if (!handle) return;
  try {
    await handle.client.end();
  } catch {
  }
  c.set("db", null);
}
