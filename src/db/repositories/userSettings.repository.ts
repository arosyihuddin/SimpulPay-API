import { eq } from "drizzle-orm";
import { userSettings } from "../schema";
import type { Db } from "../client";

export async function getUserSettings(
  db: Db,
  userId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.user_id, userId));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function upsertUserSetting(
  db: Db,
  userId: string,
  key: string,
  value: string,
) {
  await db
    .insert(userSettings)
    .values({ user_id: userId, key, value, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: [userSettings.user_id, userSettings.key],
      set: { value, updated_at: Date.now() },
    });
}
