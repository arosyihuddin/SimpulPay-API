import {
  queryTransactions,
  updateTransactionStatus,
  updateInvoiceByTransaction,
  getMerchant,
  getInvoiceByTransaction,
  getSubscription,
  updateSubscription,
  insertLog,
  activateSubscriptionSwap,
} from "../db/repositories";
import { scheduleSubExpiry } from "../durable_objects/subTimer";
import { verifyPayment } from "./gojek";
import { broadcast } from "./realtime";
import { createNotifications } from "../utils/notification.helper";
import type { Db } from "../db/client";
import type { Env } from "../types";
import { logger } from "../utils/logger";

const MAX_BATCH = 500;
/** Satu periode langganan = 30 hari. Satu-satunya definisi — semua controller import dari sini. */
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Verify SEMUA transaksi pending satu merchant. 1 pass, panggil dari DO alarm. */
export async function verifyMerchantPending(
  DB: Db,
  env: Env,
  merchantId: string,
): Promise<void> {
  const txs = await queryTransactions(DB, {
    merchantId,
    status: "pending",
    limit: MAX_BATCH,
  });
  logger.debug(`Merchant ID ${merchantId} transaksi ${txs.length}`);
  if (txs.length === 0) return;

  const now = Date.now();
  const alive = txs.filter((t) => t.expires_at > now);
  for (const t of txs) {
    if (t.expires_at <= now) await expireTx(DB, env, t, merchantId);
  }
  if (alive.length === 0) return;

  const merchant = await getMerchant(DB, merchantId);
  if (!merchant || merchant.status !== "active") {
    for (const t of alive) await expireTx(DB, env, t, merchantId);
    return;
  }

  for (const t of alive) {
    try {
      const matched = await verifyPayment(
        env,
        DB,
        merchantId,
        t.amount,
        t.created_at,
        null,
        null,
        t.id,
      );
      if (matched) {
        logger.debug(
          `[Pooling][${t.type}] Payment Match, Merchang ${merchantId} -> Amount ${t.amount}`,
        );
        await updateTransactionStatus(DB, t.id, "paid");
        await updateInvoiceByTransaction(DB, t.id, "paid", Date.now());
        if (t.type === "subscription") {
          const inv = await getInvoiceByTransaction(DB, t.id);
          if (inv) {
            const sub = await getSubscription(DB, inv.subscription_id);
            if (sub && (sub.status === "pending" || sub.status === "expired")) {
              const endsAt = now + MONTH_MS;
              await activateSubscriptionSwap(DB, sub.id, sub.user_id, endsAt);
              await scheduleSubExpiry(env, {
                subId: sub.id,
                userId: sub.user_id,
                endsAt,
                invoiceId: inv.id,
              });
            }
            const title = "Pembayaran Berhasil";
            const message = `Subscription lunas — Rp${inv.amount.toLocaleString("id-ID")}`;
            broadcast(env, {
              type: "invoice_paid",
              scope: "admin",
              data: {
                invoice_id: inv.id,
                subscription_id: inv.subscription_id,
                user_id: inv.user_id,
                amount: inv.amount,
                paid_at: now,
                by: "admin",
              },
            });
            broadcast(env, {
              type: "invoice_paid",
              userId: inv.user_id,
              data: {
                invoice_id: inv.id,
                subscription: { ...sub, status: "active" },
                user_id: inv.user_id,
                amount: inv.amount,
                period_end: inv.period_end,
                period_start: inv.period_start,
                paid_at: now,
                status: "paid",
                by: "admin",
              },
            });
            await createNotifications(DB, env, {
              type: "payment_success",
              toUser: {
                userId: inv.user_id,
                title,
                message,
              },
              toAdmin: {
                title,
                message,
              },
            });
          }
        }
        if (t.user_id) {
          broadcast(env, {
            type: "payment_received",
            userId: t.user_id,
            data: { id: t.id, status: "paid", amount: t.amount },
          });
          broadcast(env, {
            type: "transaction_updated",
            userId: t.user_id,
            data: {
              id: t.id,
              trx_id: t.trx_id,
              merchantId,
              status: "paid",
              amount: t.amount,
              paid_at: Date.now(),
            },
          });
        }
      }
    } catch {
      // Error sesi GoPay / fetch — jangan expire, biar di-retry round berikutnya.
    }
  }
}
/** TX expired → tandai expired + gagalkan invoice + batalkan sub pending. Pengganti cron hourly. */
async function expireTx(
  DB: Db,
  env: Env,
  t: { id: string; user_id?: string | null; type?: string | null },
  merchantId: string,
): Promise<void> {
  await updateTransactionStatus(DB, t.id, "expired");
  if (t.type === "subscription") {
    await updateInvoiceByTransaction(DB, t.id, "failed");
    const inv = await getInvoiceByTransaction(DB, t.id);
    const sub = inv ? await getSubscription(DB, inv.subscription_id) : null;
    if (sub && sub.status === "pending") {
      await updateSubscription(DB, sub.id, { status: "cancelled" });
      await insertLog(
        DB,
        "INFO",
        `Pending sub ${sub.id} dibatalkan (QRIS expired)`,
        null,
        sub.user_id,
      );
    }
  }
  if (t.user_id) {
    broadcast(env, {
      type: "qris_expired",
      userId: t.user_id,
      data: { id: t.id, merchantId, status: "expired" },
    });
  }
}

/** Cek apakah masih ada transaksi pending (limit 1). */
export async function hasPending(DB: Db): Promise<boolean> {
  const rows = await queryTransactions(DB, { status: "pending", limit: 1 });
  return rows.length > 0;
}
