import { settings } from "../schema";
import type { Db } from "../client";

export async function setSetting(db: Db, key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updated_at: Date.now() },
    });
}
