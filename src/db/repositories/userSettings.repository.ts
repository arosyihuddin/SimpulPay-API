import { eq } from "drizzle-orm";
import { users } from "../schema";
import type { Db } from "../client";

export async function getUserSettings(
  db: Db,
  userId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ settings_json: users.settings_json })
    .from(users)
    .where(eq(users.id, userId));
  const raw = rows[0]?.settings_json;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Overwrite seluruh settings — dipakai pas PATCH bulk. */
export async function setUserSettings(
  db: Db,
  userId: string,
  settings: Record<string, string>,
) {
  await db
    .update(users)
    .set({ settings_json: JSON.stringify(settings), updated_at: Date.now() })
    .where(eq(users.id, userId));
}