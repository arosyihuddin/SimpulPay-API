import type { Context, MiddlewareHandler } from "hono";
import {
  cleanExpiredSessions,
  getAdminSession,
  getApiKeyByKey,
  getMerchant,
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

/** Return userId jika key valid (active + owner user active), else null. */
export async function apiKeyOk(DB: Db, key: string | null): Promise<string | null> {
  if (!key) return null;
  const row = await getApiKeyByKey(DB, key);
  if (!row || row.status !== "active") return null;
  const owner = await getUserById(DB, row.user_id);
  if (!owner || owner.status !== "active") return null;
  await updateApiKey(DB, row.id, { lastUsedAt: Date.now() });
  return row.user_id;
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
  const userId = await apiKeyOk(getDb(c), key);
  if (!userId) fail(401, "Autentikasi Gagal: API Key tidak valid");
  c.set("userId", userId);
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
  await next();
};

/** Sesi valid aja (role apa pun — admin juga boleh). Buat route customer. */
export const customerGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await sessionOk(getDb(c), c.get("adminToken"));
  if (!userId) fail(401, "Tidak terautentikasi atau sesi berakhir");
  c.set("userId", userId);
  await next();
};

/**
 * Resolve merchant dari query `merchant_id` atau header `x-merchant-id`,
 * pastikan milik user login (userId) dan status active. Set c.get("merchantId").
 */
export const merchantGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const merchantId =
    c.req.query("merchant_id") || c.req.header("x-merchant-id") || null;
  if (!merchantId) fail(400, "merchant_id wajib (query atau header x-merchant-id)");
  const merchant = await getMerchant(getDb(c), merchantId);
  if (!merchant) fail(404, "Merchant tidak ditemukan");
  if (merchant.user_id !== c.get("userId"))
    fail(403, "Akses ditolak: merchant bukan milik akun ini");
  if (merchant.status !== "active")
    fail(403, "Merchant tidak aktif");
  c.set("merchantId", merchantId);
  await next();
};
