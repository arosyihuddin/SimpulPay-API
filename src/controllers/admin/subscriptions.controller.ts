import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";
import {
  getPlan,
  listSubscriptions,
  getSubscription,
  updateSubscription,
} from "../../db/repositories";

export async function listSubscriptionsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = c.req.query("user_id") || undefined;
  const includeFree = c.req.query("include_free") === "1";
  const list = await listSubscriptions(DB, userId);
  if (!includeFree) {
    const planTypes = new Map<string, string>();
    for (const s of list) {
      if (!planTypes.has(s.plan_id)) {
        const p = await getPlan(DB, s.plan_id);
        planTypes.set(s.plan_id, p?.type ?? "paid");
      }
    }
    return c.json({
      success: true,
      data: {
        subscriptions: list.filter((s) => planTypes.get(s.plan_id) !== "free"),
      },
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
