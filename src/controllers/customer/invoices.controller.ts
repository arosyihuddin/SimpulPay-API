import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId } from "./helpers";
import type { Db } from "../../db/client";
import type { SubscriptionRow, InvoiceRow } from "../../db/repositories";
import {
  listInvoices,
  getSubscription,
  updateSubscription,
  updateInvoiceStatus,
  updateTransactionStatus,
  activateSubscriptionSwap,
  getTransaction,
  insertLog,
} from "../../db/repositories";
import { verifyPayment } from "../../services/gojek";

/** Verifikasi payment pending subscription. Kalau lunas → activate sub + update invoice. */
async function verifyPendingInvoice(
  DB: Db,
  sub: SubscriptionRow,
  inv: InvoiceRow,
): Promise<boolean> {
  // Link transaksi QRIS via invoice.transaction_id (bukan hack prefix trx_id).
  const subTx = inv.transaction_id
    ? await getTransaction(DB, inv.transaction_id)
    : undefined;

  if (subTx && subTx.status === "EXPIRED") {
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
  const endsAt = now + 30 * 24 * 60 * 60 * 1000;
  await activateSubscriptionSwap(DB, sub.id, sub.user_id, endsAt);
  await updateInvoiceStatus(DB, inv.id, "paid", now);
  await updateTransactionStatus(DB, subTx.id, "PAID");
  await insertLog(
    DB,
    "SUCCESS",
    `Upgrade sub ${sub.id} lunas`,
    null,
    sub.user_id,
  );
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
  const invoices = await listInvoices(DB, { userId });

  // Verify payment utk invoice pending yang masih belum lunas.
  const results = await Promise.all(
    invoices.map(async (inv) => {
      if (inv.status === "paid") return inv;
      const sub = await getSubscription(DB, inv.subscription_id);
      if (!sub || sub.status !== "pending") return inv;
      const paid = await verifyPendingInvoice(DB, sub, inv);
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
    data: { invoices: out },
  });
}