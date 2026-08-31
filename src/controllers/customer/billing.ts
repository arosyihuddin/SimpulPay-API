import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId } from "./helpers";
import {
  getPlan,
  listPlans,
  getActiveSubscription,
  createSubscription,
  createInvoice,
  listInvoices,
} from "../../db/repositories";

export async function listPlansCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const onlyActive = c.req.query("active") !== "0";
  const plans = await listPlans(DB, onlyActive);
  return c.json({ success: true, data: { plans } });
}

export async function getPlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const plan = await getPlan(DB, id);
  if (!plan) bad("Plan tidak ditemukan", 404);
  return c.json({ success: true, data: plan });
}

export async function getMySubscriptionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  if (c.get("role") === "admin") {
    return c.json({
      success: true,
      data: {
        subscription: {
          id: "sub_admin",
          plan_id: "plan_admin",
          plan_name: "Admin",
          status: "active",
          starts_at: null,
          ends_at: null,
          created_at: null,
        },
      },
    });
  }
  const sub = await getActiveSubscription(DB, userId);
  if (!sub) return c.json({ success: true, data: { subscription: null } });
  const plan = await getPlan(DB, sub.plan_id);
  return c.json({
    success: true,
    data: {
      subscription: {
        id: sub.id,
        plan_id: sub.plan_id,
        plan_name: plan?.name ?? null,
        status: sub.status,
        starts_at: sub.starts_at,
        ends_at: sub.ends_at,
        created_at: sub.created_at,
      },
    },
  });
}

export async function listMyInvoicesCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const invoices = await listInvoices(DB, { userId });
  return c.json({
    success: true,
    data: {
      invoices: invoices.map((i) => ({
        id: i.id,
        subscription_id: i.subscription_id,
        amount: i.amount,
        status: i.status,
        period_start: i.period_start,
        period_end: i.period_end,
        paid_at: i.paid_at,
        created_at: i.created_at,
      })),
    },
  });
}

export async function createSubscriptionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const planId = body?.plan_id;
  if (!planId) bad("plan_id wajib diisi");
  if (!(await getPlan(DB, planId))) bad("Plan tidak ditemukan", 404);

  const existing = await getActiveSubscription(DB, userId);
  if (existing) bad("User sudah punya subscription aktif", 409);

  const id = "sub_" + crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  await createSubscription(DB, {
    id,
    userId,
    planId,
    startsAt: now,
    endsAt: now + monthMs,
  });

  // Generate invoice pertama
  await createInvoice(DB, {
    id: "inv_" + crypto.randomUUID().slice(0, 8),
    userId,
    subscriptionId: id,
    amount: body?.amount ?? 0,
    periodStart: now,
    periodEnd: now + monthMs,
  });

  return c.json({ success: true, data: { id } });
}
