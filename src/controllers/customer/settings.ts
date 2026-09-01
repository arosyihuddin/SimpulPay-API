import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { currentUserId, bad } from "./helpers";
import {
  getUserSettings,
  setUserSettings,
} from "../../db/repositories";
import { generateSecret } from "../../services/webhook";

const DEFAULTS: Record<string, string> = {
  default_currency: "IDR",
  qris_expiry_minutes: "15",
  min_amount: "100",
  max_amount: "10000000",
  fee_percent: "0",
  pooling_interval: "8000",
  webhook_enabled: "false",
  webhook_url: "",
  webhook_secret: "",
};

// Secret gak bisa di-set langsung — cuma bisa di-rotate via nilai "regenerate"
const ALLOWED_UPDATES = new Set(
  Object.keys(DEFAULTS).filter((k) => k !== "webhook_secret"),
);

function mergeSettings(dbRows: Record<string, string>): Record<string, string> {
  return { ...DEFAULTS, ...dbRows };
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
      next[key] = String(val);
    }
  }

  await setUserSettings(DB, userId, next);

  const merged = mergeSettings(next);
  delete merged.webhook_secret;
  return c.json({ success: true, data: { settings: merged } });
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
