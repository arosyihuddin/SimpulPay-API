import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { AppEnv } from "../types";
import { health, apiHealth, qrPage, qrStatus } from "../controllers/public.controller";
import { login, logout } from "../controllers/customer/auth";

// Public gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const publicRoutes = new Hono<AppEnv>();

// Login/logout satu-satunya di sini — dipakai customer & admin (cookie sama)
publicRoutes.post("/login", login);
publicRoutes.post("/logout", logout);

publicRoutes.get("/health", health);
publicRoutes.get("/api/health", apiHealth);

publicRoutes.get("/docs", swaggerUI({ url: "/docs/json" }));

publicRoutes.get("/qr/:id", qrPage);
publicRoutes.get("/api/qr-status/:id", qrStatus);

export { publicRoutes };
