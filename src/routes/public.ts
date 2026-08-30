import { Hono } from "hono";
import type { AppEnv } from "../types";
import { health, apiHealth, qrPage, qrStatus } from "../controllers/public.controller";

export const publicRoutes = new Hono<AppEnv>()
  .get("/health", health)
  .get("/api/health", apiHealth)
  .get("/qr/:id", qrPage)
  .get("/api/qr-status/:id", qrStatus);
