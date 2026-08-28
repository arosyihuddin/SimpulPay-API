// Route admin (cookie httpOnly): semua handler di controller
import { Elysia } from "elysia";
import {
  setupStatus,
  setupDb,
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
  deriveAdmin,
} from "../controllers/admin.controller";

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .get("/setup-status", setupStatus)
  .post("/setup-db", async ({ body }) => setupDb(body))
  .post("/setup", async ({ body, set }) => setup(body, set))
  .post("/login", async ({ body, set }) => login(body, set))
  .post("/logout", async ({ set, headers }) => logout(set, headers))

  // ---- Protected admin ----
  .guard({}, (app) =>
    app
      .derive(deriveAdmin)
      .get("/me", async ({ adminToken }) => me(adminToken))
      .post("/change-password", async ({ body }) => changePassword(body))
      .get("/dashboard", dashboard)
      .post("/qris", async ({ body }) => createQris(body))
      .get("/qris", async ({ query }) => listQris(query))
      .get("/transactions", async ({ query }) => listTransactions(query))
      .get("/logs", async ({ query }) => listLogs(query))
      .get("/settings", settings)
      .post("/api-key", async ({ body }) => apiKey(body))
      .post("/qris-parse", async ({ body }) => qrisParse(body))
      .post("/qris-static", async ({ body }) => qrisStatic(body))
      .post("/merchant-id", async ({ body }) => merchantId(body))
      .post("/otp-request", async ({ body }) => otpRequest(body))
      .post("/otp-verify", async ({ body }) => otpVerify(body))
      .post("/refresh-session", refreshSessionCtl)
      .delete("/gobiz-session", deleteGoBizCtl),
  );