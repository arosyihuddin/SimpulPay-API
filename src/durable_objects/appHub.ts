import { verifyMerchantPending, hasPending } from "../services/pooling";
import { getUserSettings } from "../db/repositories";
import { createDb } from "../db/client";
import type { DurableObject } from "@cloudflare/workers-types";
import type { Db } from "../db/client";
import type { Env } from "../types";
import { logger } from "../utils/logger";

const MIN_INTERVAL_MS = 1000;
const DEFAULT_INTERVAL_MS = 8000;

const tagUser = (id: string) => `u:${id}`;
const tagScope = (s: string) => `s:${s}`;

export class AppHub implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private pooling = false;

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

    // —— Broadcast (data sistem, per-user; scope cadangan buat nanti) ——
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const ev: {
        type: string;
        data?: unknown;
        userId?: string;
        scope?: string;
      } = await request.json();
      this.broadcast(ev.type, ev.data, ev.userId, ev.scope);
      return new Response(null, { status: 200 });
    }

    // —— Notify (notifikasi) — routing sama kayak broadcast: u:<id> + s:<scope> ——
    if (url.pathname === "/notify-user" && request.method === "POST") {
      const ev: {
        type: string;
        data?: unknown;
        userId?: string;
        scope?: string;
      } = await request.json();
      this.broadcast(ev.type, ev.data, ev.userId, ev.scope);
      return new Response(null, { status: 200 });
    }

    // —— WebSocket upgrade: customer = ?user_id, admin = ?scope ——
    const userId = url.searchParams.get("user_id");
    const scope = url.searchParams.get("scope") ?? undefined;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    logger.debug(`New Client Connected: ${userId}`);
    logger.debug(`Client has connected : ${client.readyState}`);

    // Hibernation API: tag routing survive eviction.
    // Scope = dimensi tambahan (opsional), bukan pengganti userId.
    const tags: string[] = [];
    if (userId) tags.push(tagUser(userId));
    if (scope) tags.push(tagScope(scope));
    this.state.acceptWebSocket(server, tags);

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    await this.pool();
  }

  /** 1 round pooling: verify semua pending, schedule alarm kalo masih ada pending.
   *  Interval alarm = min pooling_interval dari user yg punya pending.
   *  Guard pooling flag: alarm 1-8 dtk + /start-pooling + cron tiap menit bisa overlap
   *  (verify Gojek lambat) → tanpa guard = dobel call + SQLITE_BUSY di Miniflare. */
  private async pool() {
    if (this.pooling) return;
    this.pooling = true;
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
        const next = Date.now() + interval;
        const cur = await this.state.storage.getAlarm();
        if (cur == null || cur > next) await this.state.storage.setAlarm(next);
      }
    } finally {
      this.pooling = false;
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

  /** Kirim ke socket bertag userId (data sistem) + tambahan scope kalo ada. */
  broadcast(type: string, data?: unknown, userId?: string, scope?: string) {
    const text = JSON.stringify({ type, data });
    const tags: string[] = [];
    if (userId) tags.push(tagUser(userId));
    if (scope) tags.push(tagScope(scope));
    for (const tag of tags) {
      for (const ws of this.state.getWebSockets(tag)) {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      }
    }
  }
}
