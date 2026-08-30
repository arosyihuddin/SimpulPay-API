import { createApiKey, deleteApiKey, listApiKeysByUser, insertLog } from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, currentUserId, bufToHex } from "./helpers";

export async function createApiKeyCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const label = (body?.label || "").trim() || null;
  const key = "gm_" + bufToHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const id = "k_" + crypto.randomUUID().slice(0, 8);
  await createApiKey(DB, { id, userId, key, label });
  await insertLog(DB, "INFO", "API key digenerate baru" + (label ? " (" + label + ")" : ""), null, userId);
  return c.json({ success: true, data: { id, api_key: key, api_key_masked: key.slice(0, 4) + "****" } });
}

export async function listApiKeysCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const mask = (v: string) => (v ? v.slice(0, 4) + "****" : "");
  const keys = await listApiKeysByUser(DB, userId);
  return c.json({
    success: true,
    data: { api_keys: keys.map((k) => ({ id: k.id, label: k.label, key_masked: mask(k.key), status: k.status, last_used_at: k.last_used_at, created_at: k.created_at })) },
  });
}

export async function deleteApiKeyCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const keys = await listApiKeysByUser(DB, currentUserId(c));
  if (!keys.some((k) => k.id === id)) bad("API key tidak ditemukan", 404);
  await deleteApiKey(DB, id);
  await insertLog(DB, "INFO", "API key dihapus", null, currentUserId(c));
  return c.json({ success: true });
}