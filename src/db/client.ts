import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

interface DbHandle {
  db: Db;
}

// Untuk scheduled handler (tidak ada Hono context).
// neon-http: query lewat fetch, tanpa TCP pool / client.end().
export function createDb(env: Env): DbHandle {
  const cs = env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL belum di-set");
  return { db: drizzle(neon(cs), { schema }) };
}

export function getDb(c: Context<AppEnv>): Db {
  const existing = c.get("db");
  if (existing) return existing.db;
  const handle = createDb(c.env);
  c.set("db", handle);
  return handle.db;
}

// No-op: neon-http stateless, tak ada koneksi untuk ditutup.
export async function closeDb(c: Context<AppEnv>): Promise<void> {
  c.set("db", null);
}
