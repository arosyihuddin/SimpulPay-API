import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { AppEnv } from "../types";
import { health, apiHealth } from "../controllers/public.controller";
import { login, logout } from "../controllers/customer/auth";
import { googleCallback, googleStart } from "../controllers/customer/oauth";
import { sessionOk } from "../middleware/guards";
import { cookieToken } from "../utils/auth.helper";
import { getDb } from "../db/client";

// Public gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const publicRoutes = new Hono<AppEnv>();

publicRoutes.post("/login", login);
publicRoutes.post("/logout", logout);
publicRoutes.get("/auth/google", googleStart);
publicRoutes.get("/auth/google/callback", googleCallback);
publicRoutes.get("/health", health);
publicRoutes.get("/api/health", apiHealth);
publicRoutes.get("/docs", swaggerUI({ url: "/docs/json" }));
publicRoutes.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }
  const scope = c.req.query("scope") ?? undefined;
  const userId = await sessionOk(getDb(c), cookieToken(c));
  if (!userId) return c.text("Unauthorized", 401);

  // kalau client minta scope, wajib admin
  if (scope) {
    const user = await import("../db/repositories/user.repository");
    const u = await user.getUserById(getDb(c), userId);
    if (!u || u.role !== "admin") return c.text("Forbidden", 403);
  }

  const stub = c.env.APP_HUB.get(c.env.APP_HUB.idFromName("global"));
  const url = new URL("http://internal");
  url.searchParams.set("user_id", userId);
  if (scope) url.searchParams.set("scope", scope);
  return stub.fetch(
    new Request(url.toString(), { headers: { Upgrade: "websocket" } }),
  );
});

export { publicRoutes };
