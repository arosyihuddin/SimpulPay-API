import { listMerchantsByUser, listApiKeysByUser } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId } from "./helpers";

export async function settings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const mask = (v: string) => (v ? v.slice(0, 4) + "****" : "");
  const merchants = await listMerchantsByUser(DB, userId);
  const apiKeys = await listApiKeysByUser(DB, userId);
  return c.json({
    success: true,
    data: {
      merchants: merchants.map((m) => ({ id: m.id, type: m.type, name: m.name, status: m.status, gopay_merchant_id: m.gopay_merchant_id, qris_static_set: !!m.qris_static, qris_static_masked: m.qris_static ? m.qris_static.slice(0, 12) + "..." : "", created_at: m.created_at, updated_at: m.updated_at })),
      api_keys: apiKeys.map((k) => ({ id: k.id, label: k.label, key_masked: mask(k.key), status: k.status, last_used_at: k.last_used_at, created_at: k.created_at })),
    },
  });
}
