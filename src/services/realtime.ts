import type { Env } from "../types";

export type RealtimeEvent = {
  type: string;
  scope?: string;
  userId?: string;
  data?: unknown;
};

async function post(env: Env, path: string, ev: RealtimeEvent) {
  try {
    const stub = env.APP_HUB.get(env.APP_HUB.idFromName("global"));
    await stub.fetch("http://internal" + path, {
      method: "POST",
      body: JSON.stringify(ev),
    });
  } catch {
  }
}

/**
 * Broadcast per-user: kirim event data sistem (qris_created, qris_expired,
 * transaction_updated, log) ke semua socket milik userId.
 * Scope tetap didukung di DO (buat nanti) tapi sekarang gak dipakai.
 */
export async function broadcast(env: Env, ev: RealtimeEvent) {
  await post(env, "/broadcast", ev);
}

/** Khusus notifikasi (payment_success / notification) ke satu user. */
export async function notifyUser(env: Env, userId: string, ev: RealtimeEvent) {
  await post(env, "/notify-user", { ...ev, userId });
}
