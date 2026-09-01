import {
  queryTransactions,
  countTransactions,
  markTransactionsExpired,
  getMerchant,
  getTransaction,
  insertTransaction,
  insertLog,
  paidTransactionsInRange,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId, reqMerchant } from "./helpers";
import {
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
} from "../../services/qris";
import { checkDailyPaidLimit } from "../../services/limits";
import { broadcast } from "../../services/realtime";
import { startPooling } from "../../services/pooling";

/** Buat QRIS dinamis → insert transaksi. */
export async function createQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
    bad("Nominal pembayaran tidak valid");
  const staticTemplate = await getQrisStatic(DB, merchantId);
  if (!staticTemplate)
    bad(
      "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.",
      500,
    );
  const blocked = await checkDailyPaidLimit(DB, merchantId);
  if (blocked)
    bad(
      `Batas transaksi harian tercapai (${blocked.used}/${blocked.limit}). Silakan upgrade plan atau coba besok.`,
      429,
    );
  const base = parseInt(String(amount), 10);
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(staticTemplate, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
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
    userId,
    createdAt: now,
    expiresAt,
  });
  await insertLog(
    DB,
    "INFO",
    "Admin buat QRIS | Merchant " +
      merchantId +
      " | TRX-ID: " +
      trxId +
      " | Rp " +
      base +
      " (+" +
      code +
      ")",
  );
  broadcast(c.env, {
    type: "qris_created",
    scope: "admin",
    data: { id: qrisId, merchantId, status: "PENDING" },
  });
  // Pooling otomatis: poll GoBiz sampai transaksi ini (dan pending lain merchant itu) lunas/expired.
  c.executionCtx.waitUntil(startPooling(c.env, merchantId, userId));
  return c.json({
    success: true,
    data: {
      qris_id: qrisId,
      trx_id: trxId,
      qris_code: dynamicCode,
      amount: base,
      unique_code: code,
      amount_to_pay: pay,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
}

/** Transaksi LOKAL — gabungan semua merchant user, filter status/merchant. */
export async function listTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const status = (q.status as string) || undefined;
  const merchantId = (q.merchant_id as string) || undefined;
  if (merchantId) {
    const m = await getMerchant(DB, merchantId);
    if (!m || m.user_id !== userId) bad("Merchant tidak ditemukan", 404);
  }
  const opts = { limit, offset, status, merchantId, userId };
  await markTransactionsExpired(DB, Date.now());
  const rows = await queryTransactions(DB, opts);
  const total = await countTransactions(DB, { status, merchantId, userId });
  const txns = rows.map((t) => ({
    id: t.id,
    trx_id: t.trx_id,
    merchant_id: t.merchant_id,
    merchant_name: t.merchant_name,
    amount: t.amount,
    base_amount: t.base_amount,
    unique_code: t.unique_code,
    status: t.status,
    created_at: t.created_at,
    expires_at: t.expires_at,
  }));
  return c.json({ success: true, data: { transactions: txns, total } });
}

/** Ambil QRIS code (string QR) dari transaksi tertentu. */
export async function getTransactionCode(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const tx = await getTransaction(DB, id);
  if (!tx || !tx.merchant_id) bad("Transaksi tidak ditemukan", 404);
  const m = await getMerchant(DB, tx.merchant_id);
  if (!m || m.user_id !== userId) bad("Akses ditolak", 403);
  return c.json({
    success: true,
    data: { code: tx.code, status: tx.status },
  });
}

/** Transaksi terbaru (limit kecil) — dipakai widget "Transaksi Terbaru" dashboard. */
export async function recentTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query();
  const limit = Math.min(parseInt((q.limit as string) || "5", 10), 20);
  const rows = await queryTransactions(DB, { limit, userId });
  const txns = rows.map((t) => ({
    id: t.id,
    trx_id: t.trx_id,
    merchant_id: t.merchant_id,
    merchant_name: t.merchant_name,
    amount: t.amount,
    status: t.status,
    created_at: t.created_at,
  }));
  return c.json({ success: true, data: { transactions: txns } });
}

/**
 * Volume transaksi PAID per bucket untuk chart.
 * range=7|30 → per hari (label "d MMM"), range=today → per jam (label "HH:mm").
 * Scope otomatis ke semua merchant milik user.
 */
export async function transactionVolume(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const range = (q.range as string) || "7";

  const now = Date.now();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  let buckets: { label: string; from: number; to: number }[];
  if (range === "today") {
    buckets = [];
    for (let h = 0; h < 24; h += 4) {
      buckets.push({
        label: `${String(h).padStart(2, "0")}:00`,
        from: startOfDay.getTime() + h * 3600_000,
        to: startOfDay.getTime() + (h + 4) * 3600_000 - 1,
      });
    }
  } else {
    const days = range === "30" ? 30 : 7;
    buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      buckets.push({
        label: d.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        }),
        from: d.getTime(),
        to: next.getTime() - 1,
      });
    }
  }

  const from = buckets[0].from;
  const to = buckets[buckets.length - 1].to;
  const userId = currentUserId(c);
  const paid = await paidTransactionsInRange(DB, { from, to, userId });

  const data = buckets.map(
    (b) =>
      paid
        .filter((t) => t.created_at >= b.from && t.created_at <= b.to)
        .reduce((s, t) => s + t.amount, 0) / 100,
  );

  return c.json({
    success: true,
    data: {
      labels: buckets.map((b) => b.label),
      data,
      total: data.reduce((s, v) => s + v, 0),
    },
  });
}
