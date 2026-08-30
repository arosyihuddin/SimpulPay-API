import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { AppEnv } from "../types";
import { health, apiHealth, qrPage, qrStatus } from "../controllers/public.controller";

// Public gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/health", health);
publicRoutes.get("/api/health", apiHealth);

publicRoutes.get("/docs", swaggerUI({ url: "/docs/json" }));

publicRoutes.get("/qr/{id}", qrPage);
publicRoutes.get("/api/qr-status/{id}", qrStatus);

export { publicRoutes };
