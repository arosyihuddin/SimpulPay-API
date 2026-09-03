import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";
import { broadcast } from "../../services/realtime";
import { createNotifications } from "../../utils/notification.helper";
import {
  getInvoice,
  listInvoices,
  countInvoicesByStatus,
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
  const q = c.req.query("q") || undefined;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const filter = { userId, subscriptionId, status, q };
  const [
    invoices,
    {
      total,
      pending: pendingCount,
      paid: paidCount,
      overdue: overdueCount,
      failed: failedCount,
    },
  ] = await Promise.all([
    listInvoices(DB, { ...filter, limit, offset }),
    countInvoicesByStatus(DB, {}),
  ]);
  return c.json({
    success: true,
    data: {
      invoices,
      total,
      pending_count: pendingCount,
      paid_count: paidCount,
      overdue_count: overdueCount,
      failed_count: failedCount,
    },
  });
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
  if (sub && (sub.status === "pending" || sub.status === "expired")) {
    const endsAt =
      inv.period_end && inv.period_end > now
        ? inv.period_end
        : now + 30 * 24 * 60 * 60 * 1000;
    await activateSubscriptionSwap(DB, sub.id, sub.user_id, endsAt);
    await insertLog(
      DB,
      "SUCCESS",
      `Invoice ${id} di-approve admin; sub ${sub.id} aktif`,
      null,
      sub.user_id,
    );
    broadcast(c.env, {
      type: "invoice_paid",
      scope: "admin",
      data: {
        invoice_id: id,
        subscription_id: sub.id,
        user_id: sub.user_id,
        amount: inv.amount,
        paid_at: now,
        by: "admin",
      },
    });
    broadcast(c.env, {
      type: "invoice_paid",
      userId: sub.user_id,
      data: {
        invoice_id: id,
        subscription: { ...sub, status: "active" },
        user_id: sub.user_id,
        amount: inv.amount,
        period_end: inv.period_end,
        period_start: inv.period_start,
        paid_at: now,
        status: "paid",
        by: "admin",
      },
    });
    await createNotifications(DB, c.env, {
      type: "payment_success",
      toUser: {
        userId: sub.user_id,
        title: "Pembayaran Berhasil",
        message: `Invoice ${id} dikonfirmasi admin — subscription aktif`,
      },
    });
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
    await insertLog(
      DB,
      "INFO",
      `Invoice ${id} ditolak admin; sub ${sub.id} dibatalkan`,
      null,
      sub.user_id,
    );
    broadcast(c.env, {
      type: "invoice_rejected",
      scope: "admin",
      data: {
        invoice_id: id,
        subscription_id: sub.id,
        user_id: sub.user_id,
        amount: inv.amount,
        by: "admin",
      },
    });
    broadcast(c.env, {
      type: "subscription_cancelled",
      userId: sub.user_id,
      data: {
        subscription_id: sub.id,
        invoice_id: id,
        status: "failed",
        plan_id: sub.plan_id,
        cancelled_at: Date.now(),
      },
    });
  }
  return c.json({ success: true });
}
