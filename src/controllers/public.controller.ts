import type { Context } from "hono";
import type { AppEnv } from "../types";

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

