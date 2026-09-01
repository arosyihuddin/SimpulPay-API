import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";
import {
  listSubscriptions,
  countSubscriptions,
  getSubscription,
  updateSubscription,
} from "../../db/repositories";

export async function listSubscriptionsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query;
  const userId = q("user_id") || undefined;
  const status = q("status") as
    | "active"
    | "pending"
    | "cancelled"
    | "expired"
    | undefined;
  const startFrom = q("start_from") ? Number(q("start_from")) : undefined;
  const startTo = q("start_to") ? Number(q("start_to")) : undefined;
  const endFrom = q("end_from") ? Number(q("end_from")) : undefined;
  const endTo = q("end_to") ? Number(q("end_to")) : undefined;
  const includeFree = q("include_free") === "1";
  const limit = Math.min(parseInt(q("limit") ?? "50", 10) || 50, 100);
  const offset = parseInt(q("offset") ?? "0", 10) || 0;

  const filter = { userId, status, startFrom, startTo, endFrom, endTo, includeFree };
  const [subscriptions, total] = await Promise.all([
    listSubscriptions(DB, { ...filter, limit, offset }),
    countSubscriptions(DB, filter),
  ]);
  return c.json({
    success: true,
    data: { subscriptions, total },
  });
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
