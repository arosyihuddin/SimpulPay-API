import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Sql } from "postgres";
import type { Db } from "../db/client";

export interface Env {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  MERCHANT_WS: DurableObjectNamespace;
  CORS_ORIGINS?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    adminToken: string | null;
    db: { client: Sql; db: Db } | null;
    userId: string | null;
    merchantId: string | null;
    role: string | null;
  };
};
