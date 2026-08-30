import type { Context, MiddlewareHandler } from "hono";
import {
  cleanExpiredSessions,
  getAdminSession,
  getSetting,
} from "../db/queries";
import { getDb, type Db } from "../db/client";
import { fail } from "./errorHandler";
import type { AppEnv } from "../types";

export const ADMIN_COOKIE = "gopay_admin_session";
export const ADMIN_TTL_MS = 24 * 60 * 60 * 1000;

export function extractApiKey(c: Context<AppEnv>): string | null {
  const auth = c.req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth))
    return auth.replace(/^Bearer\s+/i, "").trim();
  const q = c.req.query();
  return (
    c.req.header("x-api-key") ??
    (q.api_key as string | undefined) ??
    (q.apikey as string | undefined) ??
    null
  );
}

export async function getApiKey(DB: Db): Promise<string> {
  return (await getSetting(DB, "api_key")) || "";
}
export async function apiKeyOk(DB: Db, key: string | null): Promise<boolean> {
  const expected = await getApiKey(DB);
  return !!expected && key === expected;
}

export async function adminOk(
  DB: Db,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false;
  await cleanExpiredSessions(DB);
  const s = await getAdminSession(DB, token);
  return !!s && s.expires_at > Date.now();
}

export const apiKeyGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = extractApiKey(c);
  if (!(await apiKeyOk(getDb(c), key)))
    fail(401, "Autentikasi Gagal: API Key tidak valid");
  await next();
};

export const adminGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.get("adminToken");
  if (!(await adminOk(getDb(c), token)))
    fail(401, "Tidak terautentikasi atau sesi berakhir");
  await next();
};
