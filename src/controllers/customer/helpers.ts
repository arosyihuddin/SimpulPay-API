import type { Context } from "hono";
import type { Db } from "../../db/client";
import type { AppEnv } from "../../types";
import { fetchTransactionsWithRetry } from "../../services/gojek";
import { getMerchantByUser } from "../../db/repositories";
import { ADMIN_TTL_MS } from "../../middleware/guards";

export const SESSION_MAX_AGE = ADMIN_TTL_MS / 1000;

export function cookieHeader(token: string, maxAge: number): string {
  const sameSite = "None";
  const secure = "; Secure";
  return `${"gopay_admin_session"}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`;
}

export function bad(message: string, status = 400): never {
  const err: any = new Error(message);
  err.status = status;
  throw err;
}

/** Merchant milik user dari :id — tanpa cek status (update/delete/relogin merchant inactive). */
export async function ownedMerchant(DB: Db, userId: string, merchantId: string) {
  const m = await getMerchantByUser(DB, userId, merchantId);
  if (!m) bad("Merchant tidak ditemukan", 404);
  return m;
}

/** Merchant milik user dari :id + cek status aktif. */
export async function ownedActiveMerchant(
  DB: Db,
  userId: string,
  merchantId: string,
) {
  const m = await ownedMerchant(DB, userId, merchantId);
  if (m.status !== "active") bad("Merchant tidak aktif", 403);
  return m;
}

export function currentUserId(c: Context<AppEnv>): string {
  const id = c.get("userId");
  if (!id) bad("userId tidak ditemukan di context", 400);
  return id;
}

export function paramId(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) bad("id wajib ada", 400);
  return id;
}

export function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchMonthTransactions(DB: Db, merchantId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const raw = await fetchTransactionsWithRetry(DB, merchantId, {
      startTime: startOfMonth.getTime(),
      endTime: now.getTime(),
      pageSize: 100,
    });
    return { success: true as const, raw };
  } catch (err: any) {
    return { success: false as const, message: err.message };
  }
}
