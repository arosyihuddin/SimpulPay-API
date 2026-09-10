import type { Context } from "hono";
import type { AppEnv } from "../types";
import { getDb, type Db } from "../db/client";
import {
  generateDynamicQRIS,
  uniqueAmount,
  getQrisStatic,
} from "../services/qris";
import {
  merchantSettings,
  qrisExpiryMs,
  amountLimitError,
  feeAmount,
} from "../services/settings";
import { verifyPayment } from "../services/gojek";
import {
  insertTransaction,
  getTransaction,
  getTransactionByTrx,
  markTransactionsExpired,
  insertLog,
  getMerchant,
  listMerchantsByUser,
  feeOf,
} from "../db/repositories";
import { fail, ok } from "../middleware/errorHandler";
import { checkDailyPaidLimit } from "../services/limits";

async function resolveBoundMerchant(
  DB: Db,
  userId: string,
  boundId: string,
): Promise<string> {
  const m = await getMerchant(DB, boundId);
  if (!m) fail(404, "Merchant tidak ditemukan");
  if (m.user_id !== userId)
    fail(403, "Akses ditolak: merchant bukan milik akun ini");
  if (m.status !== "active") fail(403, "Merchant tidak aktif");
  return m.id;
}

async function pickRandomActiveMerchant(
  DB: Db,
  userId: string,
): Promise<string> {
  const merchants = await listMerchantsByUser(DB, userId);
  const active = merchants.filter((m) => m.status === "active");
  if (active.length === 0)
    fail(
      400,
      "Belum ada merchant aktif. Buat merchant dulu atau bind API key ke merchant.",
    );
  return active[Math.floor(Math.random() * active.length)].id;
}

export async function health(c: Context<AppEnv>) {
  return c.json(
    ok({
      message: "Layanan SimpulPay Berfungsi Normal",
      timestamp: Date.now(),
    }),
  );
}

export async function createQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("user")?.userId;
  if (!userId) fail(500, "userId tidak ditemukan di context");
  const boundId = c.get("merchantId");
  // Key terikat → pakai itu (validasi milik + aktif). Key null → random merchant aktif.
  const merchantId = boundId
    ? await resolveBoundMerchant(DB, userId, boundId)
    : await pickRandomActiveMerchant(DB, userId);
  const body = await c.req.json();
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    fail(400, "Nominal pembayaran tidak valid");
  }
  const cfg = await merchantSettings(DB, merchantId);
  const base = parseInt(String(amount), 10);
  const limitErr = amountLimitError(base, cfg);
  if (limitErr) fail(400, limitErr);
  const st = await getQrisStatic(DB, merchantId);
  if (!st)
    fail(
      500,
      "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.",
    );
  const blocked = await checkDailyPaidLimit(DB, merchantId);
  if (blocked)
    fail(
      429,
      `Batas transaksi harian tercapai (${blocked.used}/${blocked.limit}). Silakan upgrade plan atau coba besok.`,
    );
  const fee = feeAmount(base, cfg);
  const { code, pay } = uniqueAmount(base + fee);
  const dynamicCode = generateDynamicQRIS(st, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs(cfg);
  await insertTransaction(DB, {
    id: qrisId,
    code: dynamicCode!,
    amount: pay,
    baseAmount: base,
    uniqueCode: code,
    trxId,
    merchantId,
    userId,
    createdAt: now,
    expiresAt,
  });
  await insertLog(
    DB,
    "INFO",
    `QRIS dinamis dibuat via API v1 | Merchant ${merchantId} | TRX-ID: ${trxId} | Rp ${base} (+${code})`,
  );
  const stub = c.env.APP_HUB.get(c.env.APP_HUB.idFromName("global"));
  c.executionCtx.waitUntil(stub.fetch("http://internal/start-pooling"));
  return c.json(
    ok({
      data: {
        qris_id: qrisId,
        trx_id: trxId,
        merchant_id: merchantId,
        qris_code: dynamicCode,
        amount: base,
        fee_amount: fee,
        unique_code: code,
        amount_to_pay: pay,
        expires_at: expiresAt,
      },
    }),
  );
}

export async function getQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("user")?.userId;
  if (!userId) fail(500, "userId tidak ditemukan di context");
  const key = (c.req.param("id") ?? "").trim();
  const qris = (await getTransaction(DB, key)) ?? (await getTransactionByTrx(DB, key));
  if (!qris) fail(404, "QRIS tidak ditemukan");
  if (qris.merchant_id === null) {
    if (qris.user_id !== userId) fail(404, "QRIS tidak ditemukan");
  } else {
    const m = await getMerchant(DB, qris.merchant_id);
    if (!m || m.user_id !== userId) fail(404, "QRIS tidak ditemukan");
  }
  const expired = Date.now() > qris.expires_at;
  if (expired)
    await markTransactionsExpired(
      DB,
      Date.now(),
      qris.merchant_id ?? undefined,
    );
  return c.json(
    ok({
      data: {
        qris_id: qris.id,
        trx_id: qris.trx_id,
        amount: qris.amount,
        base_amount: qris.base_amount,
        fee_amount: feeOf(qris),
        unique_code: qris.unique_code,
        status: expired ? "expired" : qris.status,
        created_at: qris.created_at,
        expires_at: qris.expires_at,
        paid: qris.status === "paid",
      },
    }),
  );
}

export async function checkPayment(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.get("user")?.userId;
  if (!userId) fail(500, "userId tidak ditemukan di context");
  const body = await c.req.json();
  const query = c.req.query();
  const amount = body?.amount || query.amount;
  const startTime = body?.startTime || query.startTime || query.start_time;
  const scopeId = body?.trx_id || query.trx_id || null;
  if (!amount || isNaN(Number(amount)))
    fail(400, "Nominal pembayaran tidak valid");
  const boundId = c.get("merchantId");
  // Key terikat → validasi milik + aktif. Key null → merchant dari trx_id (deterministik).
  let merchantId: string;
  let scopeTxId: string | null = null;
  if (boundId) {
    merchantId = await resolveBoundMerchant(DB, userId, boundId);
    if (scopeId) {
      const t = await getTransactionByTrx(DB, String(scopeId));
      if (!t) fail(404, "trx_id tidak ditemukan");
      if (t.merchant_id === null)
        fail(400, "trx_id sandbox: pakai simulate-pay, bukan payment check");
      if (t.merchant_id !== merchantId) fail(404, "trx_id tidak ditemukan");
      scopeTxId = t.id;
    }
  } else if (scopeId) {
    const t = await getTransactionByTrx(DB, String(scopeId));
    if (!t) fail(404, "trx_id tidak ditemukan");
    if (t.merchant_id === null)
      fail(400, "trx_id sandbox: pakai simulate-pay, bukan payment check");
    merchantId = await resolveBoundMerchant(DB, userId, t.merchant_id);
    scopeTxId = t.id;
  } else {
    fail(
      400,
      "API key belum terikat ke merchant: sertakan trx_id atau bind API key ke merchant dulu.",
    );
  }
  try {
    const matchedTransaction = await verifyPayment(
      c.env,
      DB,
      merchantId,
      amount,
      startTime,
      null,
      c.req.header("user-agent"),
      scopeTxId,
    );
    if (matchedTransaction) {
      await insertLog(
        DB,
        "SUCCESS",
        `Pembayaran terverifikasi lunas via API v1 | Merchant ${merchantId} | Rp ${parseInt(String(amount), 10)}`,
        matchedTransaction,
      );
      return c.json(ok({ paid: true, transaction: matchedTransaction }));
    }
    return c.json(
      ok({
        paid: false,
        message: "Pembayaran belum ditemukan atau sudah pernah diklaim",
      }),
    );
  } catch (err) {
    const errAny: any = err;
    const errorDetail = errAny.response
      ? `HTTP ${errAny.response.status}: ${JSON.stringify(errAny.response.data)}`
      : errAny.message;
    await insertLog(
      DB,
      "ERROR",
      `Gagal periksa pembayaran via API v1: ${errorDetail}`,
    );
    fail(500, "Gagal mengambil data transaksi dari API GoPay", {
      error: errorDetail,
    });
  }
}
