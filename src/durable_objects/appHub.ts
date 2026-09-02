import { verifyMerchantPending, hasPending } from "../services/pooling";
import { getUserSettings } from "../db/repositories";
import { createDb } from "../db/client";
import type { DurableObject } from "@cloudflare/workers-types";
import type { Db } from "../db/client";
import type { Env } from "../types";

const MIN_INTERVAL_MS = 1000;
const DEFAULT_INTERVAL_MS = 8000;

export class AppHub implements DurableObject {
  private scopes = new Map<WebSocket, string | undefined>();
  private state: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.state = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // —— Pooling trigger: verify langsung, jadwal alarm kalo masih ada pending ——
    if (url.pathname === "/start-pooling") {
      await this.pool();
      return new Response("ok");
    }

    // —— Broadcast ——
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const ev: { type: string; data?: unknown; scope?: string } =
        await request.json();
      this.broadcast(ev.type, ev.data, ev.scope);
      return new Response(null, { status: 200 });
    }

    // —— WebSocket upgrade ——
    const scope = url.searchParams.get("scope") ?? undefined;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.scopes.set(server, scope);

    server.addEventListener("close", () => {
      this.scopes.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    await this.pool();
  }

  /** 1 round pooling: verify semua pending, schedule alarm kalo masih ada pending.
   *  Interval alarm = min pooling_interval dari user yg punya pending. */
  private async pool() {
    const handle = createDb(this.env);
    try {
      const rows = await this.getPendingRows(handle.db);
      if (rows.length === 0) return;

      const merchantIds = new Set<string>();
      const userIds = new Set<string>();
      for (const t of rows) {
        if (t.merchant_id) merchantIds.add(t.merchant_id);
        if (t.user_id) userIds.add(t.user_id);
      }

      for (const merchantId of merchantIds) {
        await verifyMerchantPending(handle.db, this.env, merchantId);
      }

      if (await hasPending(handle.db)) {
        const interval = await this.getIntervalMs(handle.db, userIds);
        await this.state.storage.setAlarm(Date.now() + interval);
      }
    } finally {
      await handle.client.end().catch(() => {});
    }
  }

  private async getPendingRows(DB: Db) {
    const { queryTransactions } = await import("../db/repositories");
    return queryTransactions(DB, { status: "pending", limit: 500 });
  }

  /** Ambil pooling_interval terkecil dari semua user yg masih punya pending. */
  private async getIntervalMs(DB: Db, userIds: Set<string>): Promise<number> {
    let min = DEFAULT_INTERVAL_MS;
    for (const userId of userIds) {
      const settings = await getUserSettings(DB, userId);
      const v = parseInt(settings.pooling_interval ?? "", 10);
      if (!Number.isNaN(v) && v > 0) min = Math.min(min, v);
    }
    return Math.max(MIN_INTERVAL_MS, min);
  }

  broadcast(type: string, data?: unknown, scope?: string) {
    const text = JSON.stringify({ type, data });
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const clientScope = this.scopes.get(ws);
      if (scope === undefined) {
        ws.send(text);
      } else if (scope === "admin" && clientScope === "admin") {
        ws.send(text);
      } else if (clientScope === scope) {
        ws.send(text);
      }
    }
  }
}