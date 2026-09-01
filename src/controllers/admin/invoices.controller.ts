import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";
import {
  getInvoice,
  listInvoices,
  countInvoices,
  updateInvoiceStatus,
  getSubscription,
  updateSubscription,
  activateSubscriptionSwap,
  insertLog,
} from "../../db/repositories";

export async function listInvoicesCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.req.query("user_id") || undefined;
  const subscriptionId = c.req.query("subscription_id") || undefined;
  const status = c.req.query("status") as
    | "pending"
    | "paid"
    | "overdue"
    | "failed"
    | undefined;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const invoices = await listInvoices(DB, { userId, subscriptionId, status, limit, offset });
  const total = await countInvoices(DB, userId);
  return c.json({ success: true, data: { invoices, total } });
}

export async function getInvoiceCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const inv = await getInvoice(DB, id);
  if (!inv) bad("Invoice tidak ditemukan", 404);
  return c.json({ success: true, data: inv });
}

/**
 * Approve manual: invoice paid + activate sub pending (swap sub aktif lama).
 */
export async function markInvoicePaidCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const inv = await getInvoice(DB, id);
  if (!inv) bad("Invoice tidak ditemukan", 404);
  const now = Date.now();
  await updateInvoiceStatus(DB, id, "paid", now);
  const sub = await getSubscription(DB, inv.subscription_id);
  if (sub && sub.status === "pending") {
    const endsAt =
      inv.period_end && inv.period_end > now ? inv.period_end : now + 30 * 24 * 60 * 60 * 1000;
    await activateSubscriptionSwap(DB, sub.id, sub.user_id, endsAt);
    await insertLog(DB, "SUCCESS", `Invoice ${id} di-approve admin; sub ${sub.id} aktif`, null, sub.user_id);
  }
  return c.json({ success: true });
}

/**
 * Reject manual: invoice failed + cancel sub pending.
 */
export async function rejectInvoiceCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const inv = await getInvoice(DB, id);
  if (!inv) bad("Invoice tidak ditemukan", 404);
  await updateInvoiceStatus(DB, id, "failed");
  const sub = await getSubscription(DB, inv.subscription_id);
  if (sub && sub.status === "pending") {
    await updateSubscription(DB, sub.id, { status: "cancelled" });
    await insertLog(DB, "INFO", `Invoice ${id} ditolak admin; sub ${sub.id} dibatalkan`, null, sub.user_id);
  }
  return c.json({ success: true });
}