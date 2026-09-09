import type { DurableObject } from "@cloudflare/workers-types";
import { createDb } from "../db/client";
import {
  getPlan,
  getSubscription,
  insertLog,
  updateSubscription,
} from "../db/repositories";
import { broadcast } from "../services/realtime";
import { createNotifications } from "../utils/notification.helper";
import type { Env } from "../types";
import { logger, setLogLevel } from "../utils/logger";

export type SubExpiryJob = {
  subId: string;
  userId: string;
  endsAt: number;
  invoiceId?: string | null;
};

/** Satu sub = satu DO (`sub_<id>`) = satu alarm. Set saat sub aktif, tembak pas ends_at. */
export class SubTimer implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.state = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    setLogLevel(this.env.LOG_LEVEL);
    const url = new URL(request.url);
    if (url.pathname === "/schedule" && request.method === "POST") {
      const b = (await request.json()) as Partial<SubExpiryJob>;
      const subId = typeof b.subId === "string" ? b.subId : "";
      const endsAt = typeof b.endsAt === "number" ? b.endsAt : 0;
      if (!subId || !endsAt) return new Response("bad", { status: 400 });
      const userId = typeof b.userId === "string" ? b.userId : "";
      const invoiceId = typeof b.invoiceId === "string" ? b.invoiceId : null;
      await this.state.storage.put("job", { subId, userId, endsAt, invoiceId });
      await this.state.storage.setAlarm(Math.max(Date.now(), endsAt));
      return new Response("ok");
    }
    if (url.pathname === "/cancel" && request.method === "POST") {
      await this.state.storage.delete("job");
      await this.state.storage.deleteAlarm();
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  async alarm() {
    setLogLevel(this.env.LOG_LEVEL);
    const job = await this.state.storage.get<SubExpiryJob>("job");
    if (!job) return;
    const handle = createDb(this.env);
    try {
      const sub = await getSubscription(handle.db, job.subId);
      if (!sub || sub.status !== "active") return;
      const endsAt = sub.ends_at ?? job.endsAt;
      if (!endsAt) {
        await this.state.storage.delete("job");
        return;
      }
      if (endsAt > Date.now()) {
        await this.state.storage.setAlarm(endsAt);
        return;
      }
      await updateSubscription(handle.db, sub.id, { status: "expired" });
      await insertLog(
        handle.db,
        "INFO",
        `Sub ${sub.id} expired (DO timer); user ${sub.user_id} turun ke free`,
        null,
        sub.user_id,
      );
      const freePlan = await getPlan(handle.db, "p_free");
      await broadcast(this.env, {
        type: "subscription_cancelled",
        userId: sub.user_id,
        data: {
          plan_id: "p_free",
          plan_name: freePlan?.name,
          max_merchant: freePlan?.max_merchants,
          daily_paid_limit: freePlan?.daily_paid_limit,
          type: freePlan?.type,
          status: "active",
          created_at: Date.now(),
        },
      });
      await createNotifications(handle.db, this.env, {
        type: "subscription_cancelled",
        toUser: {
          userId: sub.user_id,
          title: "Langganan Berakhir",
          message: "Masa aktif langganan habis. Perpanjang dari menu Billing.",
        },
      });
      await this.state.storage.delete("job");
    } finally {
      await handle.client.end().catch(() => {});
    }
  }
}

/** Jadwalkan alarm expiry pas ends_at. Idempoten — jadwal baru timpa lama. */
export async function scheduleSubExpiry(
  env: Env,
  job: SubExpiryJob,
): Promise<void> {
  try {
    const stub = env.SUB_TIMER.get(env.SUB_TIMER.idFromName(`sub_${job.subId}`));
    await stub.fetch("http://internal/schedule", {
      method: "POST",
      body: JSON.stringify(job),
    });
  } catch (err) {
    logger.error(
      `[subtimer] schedule gagal ${job.subId}: ${(err as Error).message}`,
    );
  }
}

/** Batalkan timer (admin cancel). Alarm basi yg lolos tetap no-op via cek status DB. */
export async function cancelSubExpiry(
  env: Env,
  subId: string,
): Promise<void> {
  try {
    const stub = env.SUB_TIMER.get(env.SUB_TIMER.idFromName(`sub_${subId}`));
    await stub.fetch("http://internal/cancel", { method: "POST" });
  } catch {}
}
