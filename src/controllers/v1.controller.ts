import type { Context } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db/client";
import { getValidHeaders } from "../services/sessionManager";
import {
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
  getMerchantId,
} from "../services/qris";
import {
  fetchGojekTransactions,
  fetchTransactionsWithRetry,
  formatTransaction,
  verifyPayment,
} from "../services/gojek";
import {
  insertTransaction,
  getTransaction,
  markTransactionsExpired,
  insertLog,
  recentLogs,
  getMerchant,
  listMerchantsByUser,
} from "../db/repositories";
import { fail, ok } from "../middleware/errorHandler";
import { checkDailyPaidLimit } from "../services/limits";

export async function health(c: Context<AppEnv>) {
  return c.json(
    ok({ message: "Layanan GoMerch API Berfungsi Normal", timestamp: new Date() }),
  );
}

export async function merchantStatus(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id");
  if (!id) fail(400, "merchant_id wajib di path");
  const merchant = await getMerchant(DB, id);
  if (!merchant) fail(404, "Merchant tidak ditemukan");
  if (merchant.user_id !== c.get("userId"))
    fail(403, "Akses ditolak: merchant bukan milik akun ini");
  return c.json(ok({ data: { active: merchant.status === "active" } }));
}

export async function createQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("userId");
  if (!userId) fail(500, "userId tidak ditemukan di context");
  let merchantId = c.get("merchantId");
  // Key gak terikat merchant → pilih random merchant aktif milik user.
  if (!merchantId) {
    const merchants = await listMerchantsByUser(DB, userId);
    const active = merchants.filter((m) => m.status === "active");
    if (active.length === 0) fail(400, "Belum ada merchant aktif. Buat merchant dulu atau bind API key ke merchant.");
    merchantId = active[Math.floor(Math.random() * active.length)].id;
  }
  const body = await c.req.json();
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    fail(400, "Nominal pembayaran tidak valid");
  }
  const st = await getQrisStatic(DB, merchantId);
  if (!st) fail(500, "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.");
  const blocked = await checkDailyPaidLimit(DB, merchantId);
  if (blocked) fail(429, `Batas transaksi harian tercapai (${blocked.used}/${blocked.limit}). Silakan upgrade plan atau coba besok.`);
  const base = parseInt(String(amount), 10);
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(st, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId = "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs();
  await insertTransaction(DB, {
    id: qrisId,
    code: dynamicCode!,
    amount: pay,
    baseAmount: base,
    uniqueCode: code,
    trxId,
    merchantId,
    createdAt: now,
    expiresAt,
  });
  await insertLog(DB, "INFO", `QRIS dinamis dibuat via API v1 | Merchant ${merchantId} | TRX-ID: ${trxId} | Rp ${base} (+${code})`);
  return c.json(
    ok({
      data: {
        qris_id: qrisId,
        trx_id: trxId,
        qris_code: dynamicCode,
        amount: base,
        unique_code: code,
        amount_to_pay: pay,
        expires_at: new Date(expiresAt).toISOString(),
      },
    }),
  );
}

export async function getQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const qris = await getTransaction(DB, id);
  if (!qris) fail(404, "QRIS tidak ditemukan");
  const expired = Date.now() > qris.expires_at;
  if (expired) await markTransactionsExpired(DB, Date.now(), qris.merchant_id ?? undefined);
  return c.json(
    ok({
      data: {
        qris_id: qris.id,
        trx_id: qris.trx_id,
        amount: qris.amount,
        base_amount: qris.base_amount,
        unique_code: qris.unique_code,
        status: expired ? "EXPIRED" : qris.status,
        created_at: qris.created_at,
        expires_at: qris.expires_at,
        paid: qris.status === "PAID",
      },
    }),
  );
}

export async function checkPayment(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = c.get("merchantId");
  if (!merchantId) fail(400, "API key belum terikat ke merchant. Buat/bind API key ke merchant dulu.");
  const body = await c.req.json();
  const query = c.req.query();
  const amount = body?.amount || query.amount;
  const startTime = body?.startTime || query.startTime || query.start_time;
  const scopeId = body?.trx_id || query.trx_id || null;
  if (!amount || isNaN(Number(amount))) fail(400, "Nominal pembayaran tidak valid");
  try {
    const matchedTransaction = await verifyPayment(
      DB,
      merchantId,
      amount,
      startTime,
      null,
      c.req.header("user-agent"),
      scopeId,
    );
    if (matchedTransaction) {
      await insertLog(DB, "SUCCESS", `Pembayaran terverifikasi lunas via API v1 | Merchant ${merchantId} | Rp ${parseInt(String(amount), 10)}`, matchedTransaction);
      return c.json(ok({ paid: true, transaction: matchedTransaction }));
    }
    return c.json(
      ok({ paid: false, message: "Pembayaran belum ditemukan atau sudah pernah diklaim" }),
    );
  } catch (err) {
    const errAny: any = err;
    const errorDetail = errAny.response
      ? `HTTP ${errAny.response.status}: ${JSON.stringify(errAny.response.data)}`
      : errAny.message;
    await insertLog(DB, "ERROR", `Gagal periksa pembayaran via API v1: ${errorDetail}`);
    fail(500, "Gagal mengambil data transaksi dari API GoPay", { error: errorDetail });
  }
}

export async function listTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = c.get("merchantId");
  if (!merchantId) fail(400, "API key belum terikat ke merchant. Buat/bind API key ke merchant dulu.");
  const query = c.req.query();
  try {
    const raw = await fetchTransactionsWithRetry(DB, merchantId, {
      userAgent: c.req.header("user-agent"),
      startTime: query.startTime
        ? parseInt(query.startTime as string, 10) * 1000
        : new Date(Date.now() - 3 * 24 * 3600 * 1000).getTime(),
      endTime: query.endTime
        ? parseInt(query.endTime as string, 10) * 1000
        : Date.now(),
      pageSize: parseInt((query.pageSize as string) || "20", 10),
    });
    const formatted = raw.map(formatTransaction);
    return c.json(
      ok({
        total_amount: String(
          formatted.reduce((a: number, t: any) => a + t.amount, 0),
        ),
        data: { transactions: formatted },
      }),
    );
  } catch (err) {
    fail(500, (err as Error).message);
  }
}

export async function monthTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = c.get("merchantId");
  if (!merchantId) fail(400, "API key belum terikat ke merchant. Buat/bind API key ke merchant dulu.");
  const now = new Date();
  const startOfMonthUnix = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000,
  );
  try {
    const raw = await fetchTransactionsWithRetry(DB, merchantId, {
      userAgent: c.req.header("user-agent"),
      startTime: startOfMonthUnix * 1000,
      endTime: now.getTime(),
      pageSize: 100,
    });
    const formatted = raw.map(formatTransaction);
    return c.json(
      ok({
        total_amount: String(
          formatted.reduce((a: number, t: any) => a + t.amount, 0),
        ),
        data: { transactions: formatted },
      }),
    );
  } catch (err) {
    fail(500, (err as Error).message);
  }
}

export async function tokenStatus(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = c.get("merchantId");
  if (!merchantId) fail(400, "API key belum terikat ke merchant. Buat/bind API key ke merchant dulu.");
  const activeHeaders = await getValidHeaders(DB, merchantId, c.req.header("user-agent"));
  if (!activeHeaders)
    return c.json(
      ok({
        data: {
          token_status: "invalid",
          message: "Sesi belum dikonfigurasi. Login OTP di dashboard.",
        },
      }),
    );
  try {
    const gopayMerchantId = await getMerchantId(DB, merchantId);
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
    await fetchGojekTransactions(activeHeaders, {
      from: "0",
      size: "1",
      statuses: "SETTLEMENT,CAPTURE",
      payment_types: "QRIS,GOPAY",
      start_time: oneHourAgo,
      end_time: now.toISOString(),
      merchant_ids: gopayMerchantId,
    });
    return c.json(
      ok({
        data: {
          token_status: "valid",
          message: "Token dan Sesi GoPay Merchant Aktif",
        },
      }),
    );
  } catch (err) {
    return c.json(
      ok({
        data: { token_status: "invalid", message: (err as Error).message },
      }),
    );
  }
}

export async function logs(c: Context<AppEnv>) {
  const DB = getDb(c);
  return c.json(ok({ logs: await recentLogs(DB) }));
}
