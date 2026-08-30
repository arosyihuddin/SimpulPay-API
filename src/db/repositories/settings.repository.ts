import { eq } from "drizzle-orm";
import { settings } from "../schema";
import type { Db } from "../client";

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updated_at: Date.now() },
    });
}
