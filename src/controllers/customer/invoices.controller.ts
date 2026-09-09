import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId } from "./helpers";
import type { Db } from "../../db/client";
import type { SubscriptionRow, InvoiceRow } from "../../db/repositories";
import {
  listInvoices,
  countInvoicesByStatus,
  getSubscription,
  updateSubscription,
  updateInvoiceStatus,
  updateTransactionStatus,
  activateSubscriptionSwap,
  getTransaction,
  insertLog,
} from "../../db/repositories";
import { scheduleSubExpiry } from "../../durable_objects/subTimer";
import { MONTH_MS } from "../../services/pooling";
import { verifyPayment } from "../../services/gojek";
import { broadcast } from "../../services/realtime";
import type { Env } from "../../types";

/** Verifikasi payment pending subscription. Kalau lunas → activate sub + update invoice. */
async function verifyPendingInvoice(
  env: Env,
  DB: Db,
  sub: SubscriptionRow,
  inv: InvoiceRow,
): Promise<boolean> {
  // Link transaksi QRIS via invoice.transaction_id (bukan hack prefix trx_id).
  const subTx = inv.transaction_id
    ? await getTransaction(DB, inv.transaction_id)
    : undefined;

  if (subTx && subTx.status === "expired" && sub.status === "pending") {
    await updateSubscription(DB, sub.id, { status: "cancelled" });
    await insertLog(
      DB,
      "INFO",
      `Pending sub ${sub.id} dibatalkan (QRIS expired)`,
      null,
      sub.user_id,
    );
    return false;
  }

  if (!subTx) return false;

  let paid = false;
  try {
    paid = !!(await verifyPayment(
      env,
      DB,
      subTx.merchant_id!,
      subTx.amount,
      sub.created_at,
      null,
      null,
      subTx.id,
    ));
  } catch {
    // GoPay session error — belum bayar, jangan 500.
  }
  if (!paid) return false;

  const now = Date.now();
  const endsAt = now + MONTH_MS;
  await activateSubscriptionSwap(DB, sub.id, sub.user_id, endsAt);
  await scheduleSubExpiry(env, { subId: sub.id, userId: sub.user_id, endsAt, invoiceId: inv.id });
  await updateInvoiceStatus(DB, inv.id, "paid", now);
  await updateTransactionStatus(DB, subTx.id, "paid");
  await insertLog(
    DB,
    "SUCCESS",
    `Upgrade sub ${sub.id} lunas`,
    null,
    sub.user_id,
  );
  broadcast(env, {
    type: "invoice_paid",
    scope: "admin",
    data: {
      invoice_id: inv.id,
      subscription_id: sub.id,
      user_id: sub.user_id,
      plan_id: sub.plan_id,
      amount: inv.amount,
      paid_at: now,
    },
  });
  return true;
}

/**
 * GET /invoices
 * Semua invoice user. Invoice status "pending" = sub yang lagi dibayar (QRIS).
 * Polling endpoint ini → tiap call verify payment → lunas = invoice paid + sub aktif.
 */
export async function listMyInvoicesCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const q = c.req.query("limit");
  const limit = q && Number.isFinite(+q) ? +q : 50;
  const o = c.req.query("offset");
  const offset = o && Number.isFinite(+o) ? +o : 0;
  const [invoices, { total }] = await Promise.all([
    listInvoices(DB, { userId, limit, offset }),
    countInvoicesByStatus(DB, { userId }),
  ]);

  // Verify payment utk invoice pending yang masih belum lunas.
  // Sub status "pending" (upgrade baru) atau "expired" (renewal) — dua-duanya bisa lunas.
  const results = await Promise.all(
    invoices.map(async (inv) => {
      if (inv.status === "paid") return inv;
      const sub = await getSubscription(DB, inv.subscription_id);
      if (!sub || (sub.status !== "pending" && sub.status !== "expired"))
        return inv;
      const paid = await verifyPendingInvoice(c.env, DB, sub, inv);
      if (paid) return { ...inv, status: "paid" as const };
      return inv;
    }),
  );

  // Sertakan qris_code utk invoice pending → client bisa render QR ulang.
  const out = await Promise.all(
    results.map(async (i) => {
      const tx = i.transaction_id
        ? await getTransaction(DB, i.transaction_id)
        : undefined;
      return {
        id: i.id,
        subscription_id: i.subscription_id,
        transaction_id: i.transaction_id,
        amount: i.amount,
        unique_code: tx?.unique_code ?? null,
        amount_to_pay: tx?.amount ?? null,
        status: i.status,
        qris_code: i.status === "pending" && tx ? tx.code : null,
        period_start: i.period_start,
        period_end: i.period_end,
        paid_at: i.paid_at,
        created_at: i.created_at,
      };
    }),
  );

  return c.json({
    success: true,
    data: { invoices: out, total },
  });
}
