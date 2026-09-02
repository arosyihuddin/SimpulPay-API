import { queryTransactions, updateTransactionStatus, updateInvoiceByTransaction, getMerchant } from "../db/repositories";
import { verifyPayment } from "./gojek";
import { broadcast } from "./realtime";
import type { Db } from "../db/client";
import type { Env } from "../types";

const MAX_BATCH = 500;

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
    }
  }
  if (alive.length === 0) return;

  const merchant = await getMerchant(DB, merchantId);
  if (!merchant || merchant.status !== "active") {
    for (const t of alive) {
      await updateTransactionStatus(DB, t.id, "expired");
    }
    return;
  }

  for (const t of alive) {
    try {
      const matched = await verifyPayment(
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
        broadcast(env, {
          type: "payment_received",
          scope: "admin",
          data: { id: t.id, status: "paid", amount: t.amount },
        });
      }
    } catch {
      const m = await getMerchant(DB, merchantId);
      if (!m || m.status !== "active") {
        for (const p of alive) {
          await updateTransactionStatus(DB, p.id, "expired");
        }
        return;
      }
      // error jaringan / sesi expired → skip, iterasi berikutnya
    }
  }
}

/** Cek apakah masih ada transaksi pending (limit 1). */
export async function hasPending(DB: Db): Promise<boolean> {
  const rows = await queryTransactions(DB, { status: "pending", limit: 1 });
  return rows.length > 0;
}