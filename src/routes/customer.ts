import { Hono } from "hono";
import { customerGuard, merchantGuard, cookieAuth } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  me,
  changePassword,
  dashboard,
  listLogsCtl,
  createQris,
  listQris,
  listTransactions,
  settings,
  createApiKeyCtl,
  listApiKeysCtl,
  deleteApiKeyCtl,
  qrisParse,
  qrisStatic,
  merchantId,
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
customerRoutes.get("/dashboard", ...customerAuth, merchantGuard, dashboard);
customerRoutes.get("/logs", ...customerAuth, listLogsCtl);
customerRoutes.post("/qris", ...customerAuth, merchantGuard, createQris);
customerRoutes.get("/qris", ...customerAuth, merchantGuard, listQris);
customerRoutes.get("/transactions", ...customerAuth, merchantGuard, listTransactions);

// Merchant CRUD (tanpa merchantGuard — create/read/list pake userId)
customerRoutes.post("/merchants", ...customerAuth, createMerchantCtl);
customerRoutes.get("/merchants", ...customerAuth, listMerchantsCtl);
customerRoutes.patch("/merchants/{id}", ...customerAuth, merchantGuard, updateMerchantCtl);
customerRoutes.delete("/merchants/{id}", ...customerAuth, merchantGuard, deleteMerchantCtl);

// API keys
customerRoutes.post("/api-keys", ...customerAuth, createApiKeyCtl);
customerRoutes.get("/api-keys", ...customerAuth, listApiKeysCtl);
customerRoutes.delete("/api-keys/{id}", ...customerAuth, deleteApiKeyCtl);

// Notifications
customerRoutes.get("/notifications", ...customerAuth, listNotificationsCtl);
customerRoutes.post("/notifications/{id}/read", ...customerAuth, markNotificationReadCtl);

// Settings
customerRoutes.get("/settings", ...customerAuth, merchantGuard, settings);
customerRoutes.post("/qris-parse", ...customerAuth, qrisParse);
customerRoutes.post("/qris-static", ...customerAuth, merchantGuard, qrisStatic);
customerRoutes.post("/merchant-id", ...customerAuth, merchantGuard, merchantId);
customerRoutes.post("/otp-request", ...customerAuth, otpRequest);
customerRoutes.post("/otp-verify", ...customerAuth, merchantGuard, otpVerify);
customerRoutes.post("/refresh-session", ...customerAuth, merchantGuard, refreshSessionCtl);
customerRoutes.delete("/gobiz-session", ...customerAuth, merchantGuard, deleteGoBizCtl);

// Billing: customer baca plan, self-service subscribe
customerRoutes.get("/plans", ...customerAuth, listPlansCtl);
customerRoutes.get("/plans/{id}", ...customerAuth, getPlanCtl);
customerRoutes.post("/subscriptions", ...customerAuth, createSubscriptionCtl);

// Announcements: baca broadcast
customerRoutes.get("/announcements", ...customerAuth, listAnnouncementsCtl);
customerRoutes.get("/announcements/{id}", ...customerAuth, getAnnouncementCtl);

export { customerRoutes };
