import {
  queryTransactions,
  updateTransactionStatus,
  updateInvoiceByTransaction,
  getMerchant,
  getInvoiceByTransaction,
  getSubscription,
  activateSubscriptionSwap,
} from "../db/repositories";
import { verifyPayment } from "./gojek";
import { broadcast } from "./realtime";
import { createNotifications } from "../utils/notification.helper";
import type { Db } from "../db/client";
import type { Env } from "../types";

const MAX_BATCH = 500;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

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
  if (txs.length === 0) return;

  const now = Date.now();
  const alive = txs.filter((t) => t.expires_at > now);
  for (const t of txs) {
    if (t.expires_at <= now) {
      await updateTransactionStatus(DB, t.id, "expired");
      if (t.user_id) {
        broadcast(env, {
          type: "qris_expired",
          userId: t.user_id,
          data: { id: t.id, merchantId, status: "expired" },
        });
      }
    }
  }
  if (alive.length === 0) return;

  const merchant = await getMerchant(DB, merchantId);
  if (!merchant || merchant.status !== "active") {
    for (const t of alive) {
      await updateTransactionStatus(DB, t.id, "expired");
      if (t.user_id) {
        broadcast(env, {
          type: "qris_expired",
          userId: t.user_id,
          data: { id: t.id, merchantId, status: "expired" },
        });
      }
    }
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
        await updateTransactionStatus(DB, t.id, "paid");
        await updateInvoiceByTransaction(DB, t.id, "paid", Date.now());
        if (t.type === "subscription") {
          const inv = await getInvoiceByTransaction(DB, t.id);
          if (inv) {
            const sub = await getSubscription(DB, inv.subscription_id);
            if (sub && (sub.status === "pending" || sub.status === "expired")) {
              const endsAt = now + MONTH_MS;
              await activateSubscriptionSwap(DB, sub.id, sub.user_id, endsAt);
            }
            const title = "Pembayaran Berhasil";
            const message = `Subscription lunas — Rp${inv.amount.toLocaleString("id-ID")}`;
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

/** Cek apakah masih ada transaksi pending (limit 1). */
export async function hasPending(DB: Db): Promise<boolean> {
  const rows = await queryTransactions(DB, { status: "pending", limit: 1 });
  return rows.length > 0;
}
