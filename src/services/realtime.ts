import type { Env } from "../types";

export async function broadcast(env: Env, ev: { type: string; scope?: string; data?: unknown }) {
  try {
    const stub = env.MERCHANT_WS.get(env.MERCHANT_WS.idFromName("global"));
    await stub.fetch("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify(ev),
    });
  } catch {
  }
}
