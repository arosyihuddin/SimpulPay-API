import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId, bad } from "./helpers";
import {
  getUserSettings,
  setUserSettings,
} from "../../db/repositories";
import { generateSecret, sendTestWebhook } from "../../services/webhook";

const DEFAULTS: Record<string, string> = {
  default_currency: "IDR",
  qris_expiry_minutes: "2",
  min_amount: "100",
  max_amount: "10000000",
  fee_percent: "0",
  pooling_interval: "8",
  webhook_enabled: "false",
  webhook_url: "",
  webhook_secret: "",
};

// pooling_interval disimpan detik; nilai legacy ≥1000 dibaca sebagai ms.
function normalizePooling(raw: unknown): string {
  const v = parseFloat(String(raw ?? ""));
  if (!Number.isFinite(v) || v <= 0) return String(raw ?? "");
  return String(v >= 1000 ? Math.round(v / 1000) : v);
}

// Secret gak bisa di-set langsung — cuma bisa di-rotate via nilai "regenerate"
const ALLOWED_UPDATES = new Set(
  Object.keys(DEFAULTS).filter((k) => k !== "webhook_secret"),
);

function mergeSettings(dbRows: Record<string, string>): Record<string, string> {
  const merged = { ...DEFAULTS, ...dbRows };
  merged.pooling_interval = normalizePooling(merged.pooling_interval);
  return merged;
}

export async function settings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merged = mergeSettings(await getUserSettings(DB, userId));
  // Jangan bocorin secret di list settings umum
  delete merged.webhook_secret;
  return c.json({ success: true, data: { settings: merged } });
}

export async function updateSettings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  if (typeof body !== "object" || !body) bad("Request body harus object");

  const NUM_KEYS = ["min_amount", "max_amount", "fee_percent", "qris_expiry_minutes", "pooling_interval"];
  for (const key of NUM_KEYS) {
    if (body[key] === undefined) continue;
    const v = Number(body[key]);
    if (isNaN(v) || v < 0) bad(`${key} harus angka ≥ 0`);
  }
  if (body.fee_percent !== undefined && Number(body.fee_percent) > 100) bad("fee_percent maksimal 100");
  if (body.qris_expiry_minutes !== undefined && (Number(body.qris_expiry_minutes) < 1 || Number(body.qris_expiry_minutes) > 1440)) bad("qris_expiry_minutes minimal 1, maksimal 1440");
  if (body.pooling_interval !== undefined && Number(body.pooling_interval) <= 0) bad("pooling_interval harus > 0");
  if (
    body.min_amount !== undefined &&
    body.max_amount !== undefined &&
    Number(body.max_amount) < Number(body.min_amount)
  ) {
    bad("max_amount harus ≥ min_amount");
  }

  const current = await getUserSettings(DB, userId);
  const next = { ...current };

  // Rotate secret via nilai khusus "regenerate"
  if (body.webhook_secret === "regenerate") {
    next.webhook_secret = generateSecret();
  }

  // Pertama kali set webhook_url (sebelumnya kosong) → generate secret
  const url = String(body.webhook_url ?? "");
  if (url && !next.webhook_url) {
    next.webhook_secret = generateSecret();
  }

  for (const [key, val] of Object.entries(body)) {
    if (ALLOWED_UPDATES.has(key)) {
      // pooling_interval selalu simpan detik (legacy ms ikut dikonversi)
      next[key] = key === "pooling_interval" ? normalizePooling(val) : String(val);
    }
  }

  await setUserSettings(DB, userId, next);

  const merged = mergeSettings(next);
  delete merged.webhook_secret;
  return c.json({ success: true, data: { settings: merged } });
}

/** POST /settings/webhook/test — kirim payload dummy, tanpa queue. */
export async function testWebhookCtl(c: Context<AppEnv>) {
  const r = await sendTestWebhook(getDb(c), currentUserId(c));
  return c.json({ success: r.ok, data: r });
}

/** GET /settings/webhook — satu-satunya tempat liat webhook_secret. */
export async function webhookInfo(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merged = mergeSettings(await getUserSettings(DB, userId));
  return c.json({
    success: true,
    data: {
      webhook_url: merged.webhook_url ?? "",
      webhook_enabled: merged.webhook_enabled ?? "false",
      webhook_secret: merged.webhook_secret ?? "",
    },
  });
}
