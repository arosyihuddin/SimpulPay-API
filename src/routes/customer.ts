import { Hono } from "hono";
import { customerGuard, merchantGuard, cookieAuth } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  me,
  changePassword,
  dashboard,
  listLogsCtl,
  createQris,
  listTransactions,
  merchantTransactions,
  settings,
  createApiKeyCtl,
  listApiKeysCtl,
  deleteApiKeyCtl,
  qrisParse,
  otpRequest,
  otpVerify,
  refreshSessionCtl,
  deleteGoBizCtl,
  createMerchantCtl,
  listMerchantsCtl,
  updateMerchantCtl,
  deleteMerchantCtl,
  listNotificationsCtl,
  markNotificationReadCtl,
  listAnnouncementsCtl,
  getAnnouncementCtl,
  listPlansCtl,
  getPlanCtl,
  createSubscriptionCtl,
} from "../controllers/customer";

// Customer gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const customerRoutes = new Hono<AppEnv>();

// Semua route butuh cookie session (role apa pun)
const customerAuth = [cookieAuth, customerGuard] as const;

customerRoutes.get("/me", ...customerAuth, me);
customerRoutes.post("/change-password", ...customerAuth, changePassword);

// Dashboard: butuh merchant (query/header)
customerRoutes.get("/dashboard", ...customerAuth, dashboard);
customerRoutes.get("/logs", ...customerAuth, listLogsCtl);
customerRoutes.post("/qris", ...customerAuth, merchantGuard, createQris);
customerRoutes.get("/transactions", ...customerAuth, listTransactions);

// Merchants
customerRoutes.post("/merchants", ...customerAuth, createMerchantCtl);
customerRoutes.get("/merchants", ...customerAuth, listMerchantsCtl);
customerRoutes.patch("/merchants/:id", ...customerAuth, updateMerchantCtl);
customerRoutes.delete("/merchants/:id", ...customerAuth, deleteMerchantCtl);
customerRoutes.get("/merchants/:id", ...customerAuth, merchantTransactions);
customerRoutes.post("/qris-parse", ...customerAuth, qrisParse);
customerRoutes.post("/otp-request/:id", ...customerAuth, otpRequest);
customerRoutes.post("/otp-verify/:id", ...customerAuth, otpVerify);
customerRoutes.post("/refresh-session/:id", ...customerAuth, refreshSessionCtl);
customerRoutes.delete("/gobiz-session/:id", ...customerAuth, deleteGoBizCtl);

// API keys
customerRoutes.post("/api-keys", ...customerAuth, createApiKeyCtl);
customerRoutes.get("/api-keys", ...customerAuth, listApiKeysCtl);
customerRoutes.delete("/api-keys/:id", ...customerAuth, deleteApiKeyCtl);

// Notifications
customerRoutes.get("/notifications", ...customerAuth, listNotificationsCtl);
customerRoutes.post(
  "/notifications/:id/read",
  ...customerAuth,
  markNotificationReadCtl,
);

// Settings
customerRoutes.get("/settings", ...customerAuth, merchantGuard, settings);

// Billing: customer baca plan, self-service subscribe
customerRoutes.get("/plans", ...customerAuth, listPlansCtl);
customerRoutes.get("/plans/:id", ...customerAuth, getPlanCtl);
customerRoutes.post("/subscriptions", ...customerAuth, createSubscriptionCtl);

// Announcements: baca broadcast
customerRoutes.get("/announcements", ...customerAuth, listAnnouncementsCtl);
customerRoutes.get("/announcements/:id", ...customerAuth, getAnnouncementCtl);

export { customerRoutes };
