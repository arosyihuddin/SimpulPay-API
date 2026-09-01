import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";
import {
  listSubscriptions,
  countSubscriptionsByStatus,
  getSubscription,
  updateSubscription,
} from "../../db/repositories";

export async function listSubscriptionsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.req.query("user_id") || undefined;
  const status = c.req.query("status") as
    | "active"
    | "pending"
    | "cancelled"
    | "expired"
    | undefined;
  const startFrom = c.req.query("start_from") ? Number(c.req.query("start_from")) : undefined;
  const startTo = c.req.query("start_to") ? Number(c.req.query("start_to")) : undefined;
  const endFrom = c.req.query("end_from") ? Number(c.req.query("end_from")) : undefined;
  const endTo = c.req.query("end_to") ? Number(c.req.query("end_to")) : undefined;
  const includeFree = c.req.query("include_free") === "1";
  const q = c.req.query("q") || undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;

  const filter = {
    userId,
    status,
    startFrom,
    startTo,
    endFrom,
    endTo,
    includeFree,
    q,
  };
  const [subscriptions, { total, active: activeCount, cancelled: cancelledCount, expired: expiredCount }] =
    await Promise.all([
      listSubscriptions(DB, { ...filter, limit, offset }),
      countSubscriptionsByStatus(DB, {}),
    ]);
  return c.json({
    success: true,
    data: {
      subscriptions,
      total,
      active_count: activeCount,
      cancelled_count: cancelledCount,
      expired_count: expiredCount,
    },
  });
}

export async function cancelSubscriptionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = paramId(c);
  const sub = await getSubscription(DB, id);
  if (!sub) bad("Subscription tidak ditemukan", 404);
  await updateSubscription(DB, id, { status: "cancelled" });
  return c.json({ success: true });
}
