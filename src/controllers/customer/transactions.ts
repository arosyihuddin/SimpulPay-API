import {
  queryTransactions,
  countTransactionsByStatus,
  markTransactionsExpired,
  getTransaction,
  paidTransactionsInRange,
} from "../../db/repositories";
import type { TransactionStatus } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId, ownedMerchant } from "./helpers";

/** Transaksi LOKAL — gabungan semua merchant user, filter status/merchant/created/expires. */
export async function listTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const status = (q.status as TransactionStatus | undefined) || undefined;
  const merchantId = (q.merchant_id as string) || undefined;
  if (merchantId) await ownedMerchant(DB, userId, merchantId);
  const search = (q.q as string) || undefined;
  const createdFrom = q.created_from ? Number(q.created_from) : undefined;
  const createdTo = q.created_to ? Number(q.created_to) : undefined;
  const expiresFrom = q.expires_from ? Number(q.expires_from) : undefined;
  const expiresTo = q.expires_to ? Number(q.expires_to) : undefined;
  const filter = {
    merchantId,
    userId,
    status,
    q: search,
    createdFrom,
    createdTo,
    expiresFrom,
    expiresTo,
  };
  await markTransactionsExpired(DB, Date.now());
  const [rows, counts] = await Promise.all([
    queryTransactions(DB, { ...filter, limit, offset }),
    // Counts global (hanya per-user) — tidak terpengaruh filter q/status/tanggal.
    countTransactionsByStatus(DB, { userId }),
  ]);
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
  return c.json({
    success: true,
    data: {
      transactions: txns,
      total: counts.total,
      pending_count: counts.pending,
      paid_count: counts.paid,
      expired_count: counts.expired,
    },
  });
}

/** Ambil QRIS code (string QR) dari transaksi tertentu. */
export async function getTransactionCode(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const tx = await getTransaction(DB, id);
  if (!tx || !tx.merchant_id) bad("Transaksi tidak ditemukan", 404);
  await ownedMerchant(DB, userId, tx.merchant_id);
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
        .reduce((s, t) => s + t.amount, 0),
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
