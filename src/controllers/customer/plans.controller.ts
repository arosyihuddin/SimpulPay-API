import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad } from "./helpers";
import { listPlans, getPlan } from "../../db/repositories";

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
  // Draft disembunyikan dari customer; admin tetap bisa baca.
  if (!plan.active && c.get("user")?.role !== "admin") bad("Plan tidak ditemukan", 404);
  return c.json({ success: true, data: plan });
}