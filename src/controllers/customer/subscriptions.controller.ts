import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId } from "./helpers";
import {
  getPlan,
  getActivePlanForUser,
  getPendingSubscription,
  createSubscription,
  updateSubscription,
  createInvoice,
  insertTransaction,
  insertLog,
  getAdminPaymentMerchant,
  countMerchantsByUser,
  countPaidToday,
} from "../../db/repositories";
import {
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
} from "../../services/qris";
import { broadcast } from "../../services/realtime";
import { createNotifications } from "../../utils/notification.helper";

/**
 * GET /subscriptions
 * Subscription aktif user. 1 objek atau null (→ free plan fallback di frontend).
 * Pending subscription gak muncul di sini — lewat GET /invoices.
 */
export async function listMySubscriptionsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);

  if (c.get("user")?.role === "admin") {
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

  const [active, merchantsUsed, paidToday] = await Promise.all([
    getActivePlanForUser(DB, userId),
    countMerchantsByUser(DB, userId),
    countPaidToday(DB, userId),
  ]);

  // Fallback: free plan
  if (!active) {
    const freePlan = await getPlan(DB, "p_free");
    return c.json({
      success: true,
      data: {
        subscription: {
          id: null,
          plan_id: "p_free",
          plan_name: freePlan?.name,
          max_merchant: freePlan?.max_merchants,
          daily_paid_limit: freePlan?.daily_paid_limit,
          type: freePlan?.type,
          status: freePlan?.active ? "active" : "inactive",
          starts_at: null,
          ends_at: null,
          created_at: null,
        },
        usage: {
          merchants_used: merchantsUsed,
          paid_today_used: paidToday,
        },
      },
    });
  }

  const { plan, subscription: sub } = active;
  return c.json({
    success: true,
    data: {
      subscription: {
        id: sub.id,
        plan_id: sub.plan_id,
        plan_name: plan?.name ?? null,
        max_merchant: plan?.max_merchants,
        daily_paid_limit: plan?.daily_paid_limit,
        type: plan?.type,
        status: sub.status,
        starts_at: sub.starts_at,
        ends_at: sub.ends_at,
        created_at: sub.created_at,
      },
      usage: {
        merchants_used: merchantsUsed,
        paid_today_used: paidToday,
      },
    },
  });
}

/**
 * POST /subscriptions
 * Buat pending subscription + invoice + QRIS transaction.
 * Status jadi active setelah payment terverifikasi (via polling /invoices atau admin approve).
 */
export async function createSubscriptionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const user = c.get("user");
  const userId = user?.userId ?? currentUserId(c);
  const body = await c.req.json();
  const planId = body?.plan_id;
  if (!planId) bad("plan_id wajib diisi");
  const plan = await getPlan(DB, planId);
  if (!plan) bad("Plan tidak ditemukan", 404);
  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;

  // Upgrade/downgrade berbayar: pending dulu, bayar via QRIS merchant admin.
  const pending = await getPendingSubscription(DB, userId);
  if (pending)
    await updateSubscription(DB, pending.id, { status: "cancelled" });

  const adminMerchant = await getAdminPaymentMerchant(DB);
  if (!adminMerchant)
    bad(
      "Admin belum mengonfigurasi merchant pembayaran. Hubungi administrator.",
      500,
    );
  const staticTemplate = await getQrisStatic(DB, adminMerchant.id);
  if (!staticTemplate) bad("Merchant pembayaran belum punya QRIS static.", 500);

  const subId = "sub_" + crypto.randomUUID().slice(0, 8);
  await createSubscription(DB, {
    id: subId,
    userId,
    planId,
    status: "pending",
    startsAt: now,
    endsAt: null,
  });

  const { code, pay } = uniqueAmount(plan.price);
  const dynamicCode = generateDynamicQRIS(staticTemplate, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "SUB-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const expiresAt = now + qrisExpiryMs();

  await insertTransaction(DB, {
    id: qrisId,
    code: dynamicCode!,
    amount: pay,
    baseAmount: plan.price,
    uniqueCode: code,
    trxId,
    merchantId: adminMerchant.id,
    userId: adminMerchant.user_id,
    createdAt: now,
    expiresAt,
    type: "subscription",
  });

  const invoiceId = "inv_" + crypto.randomUUID().slice(0, 8);
  await createInvoice(DB, {
    id: invoiceId,
    userId,
    subscriptionId: subId,
    transactionId: qrisId,
    amount: pay,
    periodStart: now,
    periodEnd: now + monthMs,
  });
  broadcast(c.env, {
    type: "invoice_pending",
    userId,
    scope: "admin",
    data: {
      invoice_id: invoiceId,
      subscription_id: subId,
      user_id: userId,
      user_name: user?.name ?? null,
      user_email: user?.email ?? null,
      plan_id: plan.id,
      code: dynamicCode,
      amount: pay,
      periodStart: now,
    },
  });
  await createNotifications(DB, c.env, {
    type: "invoice_pending",
    toAdmin: {
      title: "Invoice Baru",
      message: `Invoice ${invoiceId} — ${plan.name} — Rp${pay.toLocaleString("id-ID")}`,
    },
  });
  const stub = c.env.APP_HUB.get(c.env.APP_HUB.idFromName("global"));
  c.executionCtx.waitUntil(stub.fetch("http://internal/start-pooling"));
  await insertLog(
    DB,
    "INFO",
    "Upgrade plan " +
      plan.name +
      " | User " +
      userId +
      " | sub " +
      subId +
      " | Rp " +
      plan.price +
      " (+" +
      code +
      ") | QRIS " +
      qrisId,
    null,
    userId,
  );

  return c.json({
    success: true,
    data: {
      subscription_id: subId,
      invoice_id: invoiceId,
      qris_id: qrisId,
      trx_id: trxId,
      qris_code: dynamicCode,
      amount: plan.price,
      unique_code: code,
      amount_to_pay: pay,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
}
