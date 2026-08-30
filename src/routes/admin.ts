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

export const adminRoutes = new Hono<AppEnv>()
  .get("/setup-status", setupStatus)
  .post("/setup", setup)
  .post("/login", login)
  .post("/logout", logout)
  .use("*", adminAuth, adminGuard)
  .get("/me", me)
  .post("/change-password", changePassword)
  .get("/dashboard", dashboard)
  .post("/qris", createQris)
  .get("/qris", listQris)
  .get("/transactions", listTransactions)
  .get("/logs", listLogs)
  .get("/users", listUsersCtl)
  .post("/users", createUserCtl)
  .patch("/users/:id", updateUserCtl)
  .delete("/users/:id", deleteUserCtl)
  .get("/settings", settings)
  .post("/api-key", apiKey)
  .post("/qris-parse", qrisParse)
  .post("/qris-static", qrisStatic)
  .post("/merchant-id", merchantId)
  .post("/otp-request", otpRequest)
  .post("/otp-verify", otpVerify)
  .post("/refresh-session", refreshSessionCtl)
  .delete("/gobiz-session", deleteGoBizCtl);
