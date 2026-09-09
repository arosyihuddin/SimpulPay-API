import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId } from "./helpers";
import {
  listInvoices,
  countInvoicesByStatus,
  getTransaction,
} from "../../db/repositories";


/**
 * GET /invoices
 * Read-only. Verify via AppHub pooling (POST /subscriptions pancing
 * /start-pooling + alarm loop + cron tiap menit). GET verifikasi = dobel call Gojek.
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

  // Sertakan qris_code utk invoice pending → client bisa render QR ulang.
  const out = await Promise.all(
    invoices.map(async (i) => {
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
