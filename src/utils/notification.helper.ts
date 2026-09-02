import { Db } from "../db/client";
import { getAdminId, insertNotification, type NotificationType } from "../db/repositories";
import { notifyUser } from "../services/realtime";
import { Env } from "../types";

export type NotificationInput = {
  type: NotificationType;
  /** Target user (DB + WS u:<userId>). Opsional. */
  toUser?: { userId: string; merchantId?: string | null; title: string; message: string };
  /** Target admin (DB + WS s:admin). Opsional — gak semua notif ke admin. */
  toAdmin?: { title: string; message: string };
};

/** Satu panggil dua-duanya: insert DB + kirim WS. WS = {title, message, type, created_at}. */
export async function createNotifications(
  db: Db,
  env: Env,
  n: NotificationInput,
) {
  const send = (userId: string, title: string, message: string) => {
    notifyUser(env, {
      type: "notification",
      userId,
      data: { title, message, type: n.type, created_at: Date.now() },
    });
  };

  if (n.toUser) {
    await insertNotification(db, {
      userId: n.toUser.userId,
      merchantId: n.toUser.merchantId ?? null,
      type: n.type,
      title: n.toUser.title,
      message: n.toUser.message,
    });
    send(n.toUser.userId, n.toUser.title, n.toUser.message);
  }
  if (n.toAdmin) {
    const adminId = await getAdminId(db);
    await insertNotification(db, {
      userId: adminId,
      type: n.type,
      title: n.toAdmin.title,
      message: n.toAdmin.message,
    });
    notifyUser(env, {
      type: "notification",
      scope: "admin",
      data: { title: n.toAdmin.title, message: n.toAdmin.message, type: n.type, created_at: Date.now() },
    });
  }
}
