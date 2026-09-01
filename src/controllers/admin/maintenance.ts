import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad } from "./helpers";
import { getSystemSetting, setSystemSetting, insertLog } from "../../db/repositories";

export async function getMaintenanceCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const maintenance = (await getSystemSetting(DB, "maintenance")) === "true";
  return c.json({ success: true, data: { maintenance } });
}

export async function setMaintenanceCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const on = body?.maintenance === true || body?.maintenance === "true";
  await setSystemSetting(DB, "maintenance", String(on));
  await insertLog(
    DB,
    "INFO",
    `Maintenance mode ${on ? "DIAKTIFKAN" : "dimatikan"} oleh admin`,
    null,
    c.get("userId") ?? undefined,
  );
  return c.json({ success: true, data: { maintenance: on } });
}
