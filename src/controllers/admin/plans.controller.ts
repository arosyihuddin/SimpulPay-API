import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";
import { createPlan, getPlan, updatePlan, deletePlan } from "../../db/repositories";

export async function createPlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
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

export async function updatePlanCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
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
  const id = paramId(c);
  if (!(await getPlan(DB, id))) bad("Plan tidak ditemukan", 404);
  await deletePlan(DB, id);
  return c.json({ success: true });
}