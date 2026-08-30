import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Sql } from "postgres";
import type { Db } from "../db/client";

export interface Env {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  MERCHANT_WS: DurableObjectNamespace;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { adminToken: string | null; db: { client: Sql; db: Db } | null };
};
