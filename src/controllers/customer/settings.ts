import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId, bad } from "./helpers";
import { getUserSettings, upsertUserSetting } from "../../db/repositories";

const DEFAULTS: Record<string, string> = {
  default_currency: "IDR",
  qris_expiry_minutes: "15",
  min_amount: "100",
  max_amount: "10000000",
  fee_percent: "0",
  pooling_interval: "5000",
  webhook_enabled: "false",
};

const ALLOWED_UPDATES = new Set(Object.keys(DEFAULTS));

function mergeSettings(dbRows: Record<string, string>): Record<string, string> {
  return { ...DEFAULTS, ...dbRows };
}

export async function settings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const rows = await getUserSettings(DB, userId);
  return c.json({ success: true, data: { settings: mergeSettings(rows) } });
}

export async function updateSettings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  if (typeof body !== "object" || !body) bad("Request body harus object");

  // Filter hanya key whitelist, simpan perubahan
  for (const [key, val] of Object.entries(body)) {
    if (ALLOWED_UPDATES.has(key)) {
      await upsertUserSetting(DB, userId, key, String(val));
    }
  }

  const rows = await getUserSettings(DB, userId);
  return c.json({ success: true, data: { settings: mergeSettings(rows) } });
}