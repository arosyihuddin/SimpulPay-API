import { eq } from "drizzle-orm";
import { systemSettings } from "../schema";
import type { Db } from "../client";

export async function getSystemSetting(
  db: Db,
  key: string,
): Promise<string | null> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key));
  return rows[0]?.value ?? null;
}

export async function setSystemSetting(
  db: Db,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updated_at: Date.now() },
    });
}
