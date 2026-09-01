import {
  queryTransactions,
  updateTransactionStatus,
  updateInvoiceByTransaction,
  getUserSettings,
  getMerchant,
} from "../db/repositories";
import { verifyPayment } from "./gojek";
import { broadcast } from "./realtime";
import { createDb } from "../db/client";
import type { Env } from "../types";

const MIN_INTERVAL_MS = 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Loop polling GoBiz utk satu merchant. Jalan di waitUntil, mati sendiri
 *  begitu gak ada lagi transaksi PENDING (semua PAID/EXPIRED). */
export async function runPooling(env: Env, merchantId: string, userId: string) {
  const handle = createDb(env);
  const DB = handle.db;
  try {
    const settings = await getUserSettings(DB, userId);
    const interval = Math.max(
      MIN_INTERVAL_MS,
      parseInt(settings.pooling_interval || "8000", 10) || 8000,
    );
    while (true) {
      const rows = await queryTransactions(DB, {
        merchantId,
        status: "pending",
        limit: 100,
      });
      if (rows.length === 0) break;
      let alive = 0;
      const now = Date.now();
      for (const t of rows) {
        if (t.expires_at <= now) {
          await updateTransactionStatus(DB, t.id, "expired");
          continue;
        }
        alive++;
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
          // Sesi GoBiz invalid (merchant jadi inactive) → expire semua pending + hentikan pooling.
          const m = await getMerchant(DB, merchantId);
          if (!m || m.status !== "active") {
            for (const p of rows) {
              await updateTransactionStatus(DB, p.id, "expired");
            }
            console.debug(`Pooling merchant ${merchantId} berhenti (sesi invalid)`);
            return;
          }
          // sesi expired / jaringan error → coba lagi iterasi berikutnya
        }
      }
      if (alive === 0) break;
      await sleep(interval);
    }
  } finally {
    await handle.client.end().catch(() => {});
  }
}

// Anti double-loop: 1 loop aktif per merchant.
const active = new Set<string>();

export async function startPooling(
  env: Env,
  merchantId: string,
  userId: string,
): Promise<void> {
  if (active.has(merchantId)) return;
  active.add(merchantId);
  try {
    await runPooling(env, merchantId, userId);
  } finally {
    active.delete(merchantId);
  }
}
