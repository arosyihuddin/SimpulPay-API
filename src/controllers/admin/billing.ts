import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId, paramId } from "./helpers";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
  createSubscription,
  getSubscription,
  getActiveSubscription,
  listSubscriptions,
  updateSubscription,
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoiceStatus,
  countInvoices,
} from "../../db/queries";

// ── Plans ──────────────────────────────────────────

export async function createPlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  currentUserId(c);
  const body = await c.req.json();
  const name = (body?.name || "").trim();
  if (name.length < 2) bad("Nama plan minimal 2 karakter");
  const id = "p_" + crypto.randomUUID().slice(0, 8);
  await createPlan(DB, {
    id,
    name,
    type: body?.type === "free" ? "free" : "paid",
    price: parseInt(body?.price ?? "0", 10),
    maxMerchants: parseInt(body?.max_merchants ?? "1", 10),
    dailyPaidLimit: body?.daily_paid_limit !== undefined ? parseInt(body.daily_paid_limit, 10) : null,
    featuresJson: body?.features_json ? JSON.stringify(body.features_json) : null,
    active: body?.active !== false,
  });
  return c.json({ success: true, data: { id } });
}

export async function listPlansCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const onlyActive = c.req.query("active") !== "0";
  const plans = await listPlans(DB, onlyActive);
  return c.json({ success: true, data: { plans } });
}

export async function getPlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const plan = await getPlan(DB, id);
  if (!plan) bad("Plan tidak ditemukan", 404);
  return c.json({ success: true, data: plan });
}

export async function updatePlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  currentUserId(c);
  const id = paramId(c);
  if (!(await getPlan(DB, id))) bad("Plan tidak ditemukan", 404);
  const body = await c.req.json();
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) bad("Nama plan minimal 2 karakter");
    patch.name = name;
  }
  if (body?.type !== undefined) {
    if (!["free", "paid"].includes(body.type)) bad("Type harus free atau paid");
    patch.type = body.type;
  }
  if (body?.price !== undefined) patch.price = parseInt(body.price, 10);
  if (body?.max_merchants !== undefined) patch.maxMerchants = parseInt(body.max_merchants, 10);
  if (body?.daily_paid_limit !== undefined) patch.dailyPaidLimit = parseInt(body.daily_paid_limit, 10);
  if (body?.features_json !== undefined) patch.featuresJson = JSON.stringify(body.features_json);
  if (body?.active !== undefined) patch.active = body.active === true || body.active === "true";
  await updatePlan(DB, id, patch);
  return c.json({ success: true });
}

export async function deletePlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  currentUserId(c);
  const id = paramId(c);
  if (!(await getPlan(DB, id))) bad("Plan tidak ditemukan", 404);
  await deletePlan(DB, id);
  return c.json({ success: true });
}

// ── Subscriptions ──────────────────────────────────

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

export async function listSubscriptionsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.req.query("user_id") || undefined;
  const includeFree = c.req.query("include_free") === "1";
  const list = await listSubscriptions(DB, userId);
  if (!includeFree) {
    // Default: filter non-free plan. Batch lookup plan sekali buat avoid N+1.
    const planTypes = new Map<string, string>();
    for (const s of list) {
      if (!planTypes.has(s.plan_id)) {
        const p = await getPlan(DB, s.plan_id);
        planTypes.set(s.plan_id, p?.type ?? "paid");
      }
    }
    return c.json({
      success: true,
      data: { subscriptions: list.filter((s) => planTypes.get(s.plan_id) !== "free") },
    });
  }
  return c.json({ success: true, data: { subscriptions: list } });
}

export async function getSubscriptionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const sub = await getSubscription(DB, id);
  if (!sub) bad("Subscription tidak ditemukan", 404);
  return c.json({ success: true, data: sub });
}

export async function cancelSubscriptionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const sub = await getSubscription(DB, id);
  if (!sub) bad("Subscription tidak ditemukan", 404);
  await updateSubscription(DB, id, { status: "cancelled" });
  return c.json({ success: true });
}

// ── Invoices ───────────────────────────────────────

export async function listInvoicesCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.req.query("user_id") || undefined;
  const subscriptionId = c.req.query("subscription_id") || undefined;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const invoices = await listInvoices(DB, { userId, subscriptionId, limit, offset });
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

export async function markInvoicePaidCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const inv = await getInvoice(DB, id);
  if (!inv) bad("Invoice tidak ditemukan", 404);
  await updateInvoiceStatus(DB, id, "paid", Date.now());
  return c.json({ success: true });
}