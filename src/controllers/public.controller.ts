import type { Context } from "hono";
import type { AppEnv } from "../types";

export const health = (c: Context<AppEnv>) =>
  c.json({
    status: "OK",
    service: "GoPay Partner API Gateway",
    timestamp: new Date(),
  });

export const apiHealth = (c: Context<AppEnv>) =>
  c.json({
    success: true,
    message: "Layanan GoMerch API Berfungsi Normal",
    timestamp: new Date(),
  });

