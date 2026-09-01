import type { Context, MiddlewareHandler } from "hono";
import {
  cleanExpiredSessions,
  getAdminSession,
  getApiKeyByKey,
  getSystemSetting,
  updateApiKey,
} from "../db/repositories";
import { getDb, type Db } from "../db/client";
import { getUserById } from "../db/repositories/user.repository";
import { fail } from "./errorHandler";
import { cookieToken } from "../utils/auth.helper";
import type { AppEnv } from "../types";

export const ADMIN_COOKIE = "gopay_admin_session";
export const ADMIN_TTL_MS = 24 * 60 * 60 * 1000;

/** Set adminToken dari cookie — dipakai dua router (customer + admin). */
export const cookieAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("adminToken", cookieToken(c));
  await next();
};

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

/** Return { userId, merchantId } jika key valid (active + owner user active), else null. */
export async function apiKeyOk(
  DB: Db,
  key: string | null,
): Promise<{ userId: string; merchantId: string | null } | null> {
  if (!key) return null;
  const row = await getApiKeyByKey(DB, key);
  if (!row || row.status !== "active") return null;
  const owner = await getUserById(DB, row.user_id);
  if (!owner || owner.status !== "active") return null;
  await updateApiKey(DB, row.id, { lastUsedAt: Date.now() });
  return { userId: row.user_id, merchantId: row.merchant_id ?? null };
}

/** Return userId jika sesi valid, else null. */
async function sessionOk(
  DB: Db,
  token: string | null | undefined,
): Promise<string | null> {
  if (!token) return null;
  await cleanExpiredSessions(DB);
  const s = await getAdminSession(DB, token);
  if (!s || s.expires_at <= Date.now()) return null;
  return s.user_id;
}

export const apiKeyGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = extractApiKey(c);
  const result = await apiKeyOk(getDb(c), key);
  if (!result) fail(401, "Autentikasi Gagal: API Key tidak valid");
  c.set("userId", result.userId);
  c.set("merchantId", result.merchantId);
  await next();
};

/** Sesi valid + WAJIB role admin. Buat route /admin/*. */
export const adminGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await sessionOk(getDb(c), c.get("adminToken"));
  if (!userId) fail(401, "Tidak terautentikasi atau sesi berakhir");
  const user = await getUserById(getDb(c), userId);
  if (!user || user.role !== "admin")
    fail(403, "Akses ditolak: hanya untuk admin");
  c.set("userId", userId);
  c.set("role", user.role);
  await next();
};

/** Sesi valid aja (role apa pun — admin juga boleh). Buat route customer. */
export const customerGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await sessionOk(getDb(c), c.get("adminToken"));
  if (!userId) fail(401, "Tidak terautentikasi atau sesi berakhir");
  const user = await getUserById(getDb(c), userId);
  if (!user || user.status !== "active")
    fail(401, "Tidak terautentikasi atau sesi berakhir");
  c.set("userId", userId);
  c.set("role", user.role);
  await next();
};

/**
 * Maintenance mode: blok semua request non-admin (503) selama flag ON.
 * Admin tetap bisa akses lewat path mana pun (termasuk customer routes).
 * Yang di-exempt total: /login+/logout (pre-auth), /health (monitoring).
 */
export const maintenanceGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = c.req.path;
  if (
    path === "/login" ||
    path === "/logout" ||
    path === "/health" ||
    path === "/api/health"
  )
    return next();
  const maintenance = await getSystemSetting(getDb(c), "maintenance");
  if (maintenance !== "true") return next();
  const token = cookieToken(c);
  if (token) {
    const userId = await sessionOk(getDb(c), token);
    if (userId) {
      const user = await getUserById(getDb(c), userId);
      if (user?.role === "admin") return next();
    }
  }
  const err: any = new Error("Maintenance mode aktif, coba lagi nanti");
  err.status = 503;
  err.extra = { maintenance_mode: true };
  throw err;
};
