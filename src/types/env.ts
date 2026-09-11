import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Sql } from "postgres";
import type { Db } from "../db/client";

export interface Env {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  APP_HUB: DurableObjectNamespace;
  SUB_TIMER: DurableObjectNamespace;
  CORS_ORIGINS?: string;
  LOG_LEVEL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  FRONTEND_URL?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    adminToken: string | null;
    db: { client: Sql; db: Db } | null;
    user: {
      userId: string;
      name: string;
      email: string;
      role: string;
    } | null;
    merchantId: string | null;
    role: string | null;
  };
};
