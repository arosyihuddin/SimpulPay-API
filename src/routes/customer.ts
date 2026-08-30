import { Hono } from "hono";
import { customerGuard, merchantGuard, cookieAuth } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  me,
  changePassword,
  dashboard,
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

// Di bawah ini butuh cookie session
customerRoutes.use("*", cookieAuth, customerGuard);

customerRoutes.get("/me", me);
customerRoutes.post("/change-password", changePassword);

// Dashboard: butuh merchant (query/header)
customerRoutes.get("/dashboard", merchantGuard, dashboard);
customerRoutes.post("/qris", merchantGuard, createQris);
customerRoutes.get("/qris", merchantGuard, listQris);
customerRoutes.get("/transactions", merchantGuard, listTransactions);

// Merchant CRUD (tanpa merchantGuard — create/read/list pake userId)
customerRoutes.post("/merchants", createMerchantCtl);
customerRoutes.get("/merchants", listMerchantsCtl);
customerRoutes.patch("/merchants/{id}", merchantGuard, updateMerchantCtl);
customerRoutes.delete("/merchants/{id}", merchantGuard, deleteMerchantCtl);

// API keys
customerRoutes.post("/api-keys", createApiKeyCtl);
customerRoutes.get("/api-keys", listApiKeysCtl);
customerRoutes.delete("/api-keys/{id}", deleteApiKeyCtl);

// Notifications
customerRoutes.get("/notifications", listNotificationsCtl);
customerRoutes.post("/notifications/{id}/read", markNotificationReadCtl);

// Settings
customerRoutes.get("/settings", merchantGuard, settings);
customerRoutes.post("/qris-parse", qrisParse);
customerRoutes.post("/qris-static", merchantGuard, qrisStatic);
customerRoutes.post("/merchant-id", merchantGuard, merchantId);
customerRoutes.post("/otp-request", otpRequest);
customerRoutes.post("/otp-verify", merchantGuard, otpVerify);
customerRoutes.post("/refresh-session", merchantGuard, refreshSessionCtl);
customerRoutes.delete("/gobiz-session", merchantGuard, deleteGoBizCtl);

// Billing: customer baca plan, self-service subscribe
customerRoutes.get("/plans", listPlansCtl);
customerRoutes.get("/plans/{id}", getPlanCtl);
customerRoutes.post("/subscriptions", createSubscriptionCtl);

// Announcements: baca broadcast
customerRoutes.get("/announcements", listAnnouncementsCtl);
customerRoutes.get("/announcements/{id}", getAnnouncementCtl);

export { customerRoutes };
