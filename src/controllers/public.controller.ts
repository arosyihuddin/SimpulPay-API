import type { Context } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db/client";
import { listPlans } from "../db/repositories";

export const health = (c: Context<AppEnv>) =>
  c.json({
    status: "OK",
    service: "SimpulPay",
    timestamp: Date.now(),
  });

export const apiHealth = (c: Context<AppEnv>) =>
  c.json({
    success: true,
    message: "Layanan SimpulPay Berfungsi Normal",
    timestamp: Date.now(),
  });

// Daftar paket publish untuk landing — tanpa auth, lolos maintenance.
export async function listPublicPlans(c: Context<AppEnv>) {
  const plans = await listPlans(getDb(c), true);
  return c.json({ success: true, data: { plans } });
}

