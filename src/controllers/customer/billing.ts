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
