import { eq, lte } from "drizzle-orm";
import { webhookQueue } from "../db/schema";
import type { Db } from "../db/client";
import { getUserSettings, insertLog } from "../db/repositories";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000]; // 1m, 5m, 30m

/** Generate secret random — 32 char hex. */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256(secret, body) → hex. Dipakai verifikasi signature di webhook. */
export async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function webhookCfg(settings: Record<string, string>) {
  return {
    url: settings.webhook_url ?? "",
    secret: settings.webhook_secret ?? "",
    enabled: settings.webhook_enabled === "true",
  };
}

async function deliverDetailed(
  DB: Db,
  userId: string,
  url: string,
  secret: string,
  payload: Record<string, unknown>,
  queueId?: string,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const body = JSON.stringify(payload);
  const signature = await signPayload(secret, body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SimpulPay-Signature": signature,
        "X-SimpulPay-Event": String(payload.event ?? ""),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`webhook HTTP ${res.status}`);
    }
    return { ok: true, status: res.status, error: null };
  } catch (err) {
    const msg = (err as Error).message;
    await insertLog(
      DB,
      "WARNING",
      `Webhook gagal${queueId ? " (queued)" : ""} ${url}: ${msg}`,
      null,
      userId,
    );
    return { ok: false, status: null, error: msg };
  }
}

async function deliver(
  DB: Db,
  userId: string,
  payload: Record<string, unknown>,
  queueId?: string,
): Promise<boolean> {
  const settings = await getUserSettings(DB, userId);
  const cfg = webhookCfg(settings);
  if (!cfg.enabled || !cfg.url) return true; // disabled → anggap sukses (drop)
  return (await deliverDetailed(DB, userId, cfg.url, cfg.secret, payload, queueId)).ok;
}

/** Tes manual dari dashboard — payload dummy transaction.paid, langsung tanpa queue. URL wajib, toggle boleh mati. */
export async function sendTestWebhook(
  DB: Db,
  userId: string,
): Promise<{ ok: boolean; status: number | null; error: string | null; event: string }> {
  const settings = await getUserSettings(DB, userId);
  const cfg = webhookCfg(settings);
  if (!cfg.url) return { ok: false, status: null, error: "Isi webhook URL dulu", event: "transaction.paid" };
  const r = await deliverDetailed(DB, userId, cfg.url, cfg.secret, {
    event: "transaction.paid",
    timestamp: Date.now(),
    test: true,
    data: {
      transaction_id: "TEST-001",
      amount: 50123,
      base_amount: 50000,
      unique_code: 123,
      fee_amount: 0,
      merchant_id: "test",
      merchant_name: "Tes Webhook",
      paid_at: Date.now(),
    },
  });
  return { ...r, event: "transaction.paid" };
}

/** Kirim webhook event ke user. Kalau gagal → masuk queue buat retry. */
export async function sendWebhook(
  DB: Db,
  userId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const settings = await getUserSettings(DB, userId);
  const cfg = webhookCfg(settings);
  if (!cfg.enabled || !cfg.url) return;

  const payload = { event, timestamp: Date.now(), data };
  const ok = await deliver(DB, userId, payload);
  if (ok) return;

  await DB.insert(webhookQueue).values({
    id: crypto.randomUUID(),
    user_id: userId,
    payload: JSON.stringify(payload),
    attempt: 0,
    next_retry_at: Date.now() + RETRY_DELAYS_MS[0],
    created_at: Date.now(),
  });
}

/** Proses queue — dipanggil tiap menit dari cron. */
export async function processWebhookQueue(DB: Db): Promise<void> {
  const now = Date.now();
  const due = await DB.select()
    .from(webhookQueue)
    .where(lte(webhookQueue.next_retry_at, now));

  for (const row of due) {
    const payload = JSON.parse(row.payload);
    const ok = await deliver(DB, row.user_id, payload, row.id);

    if (ok) {
      await DB.delete(webhookQueue).where(eq(webhookQueue.id, row.id));
      continue;
    }

    const attempt = row.attempt + 1;
    if (attempt >= MAX_ATTEMPTS) {
      await DB.delete(webhookQueue).where(eq(webhookQueue.id, row.id));
      await insertLog(
        DB,
        "ERROR",
        `Webhook gagal permanen (${MAX_ATTEMPTS}x) untuk user ${row.user_id}, event ${payload.event}`,
        null,
        row.user_id,
      );
      continue;
    }

    await DB.update(webhookQueue)
      .set({
        attempt,
        next_retry_at: Date.now() + RETRY_DELAYS_MS[attempt],
      })
      .where(eq(webhookQueue.id, row.id));
  }
}
