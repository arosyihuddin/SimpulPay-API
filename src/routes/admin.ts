import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { adminGuard } from "../middleware/guards";
import type { AppEnv } from "../types";
import { cookieToken } from "../utils/auth.helper";
import {
  setupStatus,
  setup,
  login,
  logout,
  changePassword,
  me,
  dashboard,
  createQris,
  listQris,
  listTransactions,
  listLogs,
  settings,
  apiKey,
  qrisParse,
  qrisStatic,
  merchantId,
  otpRequest,
  otpVerify,
  refreshSessionCtl,
  deleteGoBizCtl,
  listUsersCtl,
  createUserCtl,
  updateUserCtl,
  deleteUserCtl,
} from "../controllers/admin.controller";

const adminAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("adminToken", cookieToken(c));
  await next();
};

// Admin gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const adminRoutes = new Hono<AppEnv>();

// Open (tanpa adminGuard)
adminRoutes.get("/setup-status", setupStatus);
adminRoutes.post("/setup", setup);
adminRoutes.post("/login", login);
adminRoutes.post("/logout", logout);

// Di bawah ini butuh cookie session
adminRoutes.use("*", adminAuth, adminGuard);

adminRoutes.get("/me", me);
adminRoutes.post("/change-password", changePassword);
adminRoutes.get("/dashboard", dashboard);
adminRoutes.post("/qris", createQris);
adminRoutes.get("/qris", listQris);
adminRoutes.get("/transactions", listTransactions);
adminRoutes.get("/logs", listLogs);
adminRoutes.get("/users", listUsersCtl);
adminRoutes.post("/users", createUserCtl);
adminRoutes.patch("/users/{id}", updateUserCtl);
adminRoutes.delete("/users/{id}", deleteUserCtl);
adminRoutes.get("/settings", settings);
adminRoutes.post("/api-key", apiKey);
adminRoutes.post("/qris-parse", qrisParse);
adminRoutes.post("/qris-static", qrisStatic);
adminRoutes.post("/merchant-id", merchantId);
adminRoutes.post("/otp-request", otpRequest);
adminRoutes.post("/otp-verify", otpVerify);
adminRoutes.post("/refresh-session", refreshSessionCtl);
adminRoutes.delete("/gobiz-session", deleteGoBizCtl);

export { adminRoutes };
