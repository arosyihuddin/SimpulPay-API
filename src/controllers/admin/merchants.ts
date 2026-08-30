import { createMerchant, getMerchant, listMerchantsByUser, countMerchantsByUser, updateMerchant, deleteMerchant, deleteGoBizSession, insertLog, getActiveSubscription, getPlan } from "../../db/queries";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId } from "./helpers";

export async function createMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const name = (body?.name || "").trim();
  if (name.length < 2) bad("Nama merchant minimal 2 karakter");
  const type = body?.type === "shopeepay" ? "shopeepay" : "gopay";

  // Limit per plan: hitung merchant yang udah dipakai, blokir kalau mentok.
  const sub = await getActiveSubscription(DB, userId);
  const plan = sub ? await getPlan(DB, sub.plan_id) : null;
  const limit = plan?.max_merchants ?? 1;
  const count = await countMerchantsByUser(DB, userId);
  if (count >= limit) {
    bad(`Batas maksimal ${limit} merchant untuk plan ${plan?.name ?? "Free"}. Upgrade plan untuk menambah merchant.`, 403);
  }

  const id = "m_" + crypto.randomUUID().slice(0, 8);
  await createMerchant(DB, { id, userId, name, type, gopayMerchantId: body?.gopay_merchant_id ? String(body.gopay_merchant_id) : null, qrisStatic: body?.qris_static ? String(body.qris_static) : null });
  await insertLog(DB, "INFO", "Merchant dibuat: " + name + " (" + type + ")");
  return c.json({ success: true, data: { id } });
}

export async function listMerchantsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchants = await listMerchantsByUser(DB, userId);
  return c.json({
    success: true,
    data: { merchants: merchants.map((m) => ({ id: m.id, type: m.type, name: m.name, status: m.status, gopay_merchant_id: m.gopay_merchant_id, qris_static_set: !!m.qris_static, created_at: m.created_at, updated_at: m.updated_at })) },
  });
}

export async function updateMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const merchant = await getMerchant(DB, id);
  if (!merchant) bad("Merchant tidak ditemukan", 404);
  if (merchant.user_id !== userId) bad("Akses ditolak", 403);
  const body = await c.req.json();
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) bad("Nama merchant minimal 2 karakter");
    patch.name = name;
  }
  if (body?.type !== undefined) {
    const type = String(body.type).trim();
    if (!["gopay", "shopeepay"].includes(type)) bad("Type harus gopay atau shopeepay");
    patch.type = type;
  }
  if (body?.gopay_merchant_id !== undefined) patch.gopayMerchantId = body.gopay_merchant_id ? String(body.gopay_merchant_id) : null;
  if (body?.qris_static !== undefined) patch.qrisStatic = body.qris_static ? String(body.qris_static) : null;
  if (body?.status !== undefined) {
    const status = String(body.status).trim();
    if (!["active", "inactive"].includes(status)) bad("Status harus active atau inactive");
    patch.status = status;
  }
  await updateMerchant(DB, id, patch);
  await insertLog(DB, "INFO", "Merchant diubah: " + merchant.name);
  return c.json({ success: true });
}

export async function deleteMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const merchant = await getMerchant(DB, id);
  if (!merchant) bad("Merchant tidak ditemukan", 404);
  if (merchant.user_id !== userId) bad("Akses ditolak", 403);
  await deleteGoBizSession(DB, id);
  await deleteMerchant(DB, id);
  await insertLog(DB, "INFO", "Merchant dihapus: " + merchant.name);
  return c.json({ success: true });
}