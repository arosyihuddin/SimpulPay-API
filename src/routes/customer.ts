import { Hono } from "hono";
import { customerGuard, cookieAuth } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  me,
  changePassword,
  updateProfile,
  dashboard,
    listLogsCtl,
  createQris,
  listTransactions,
  getTransactionCode,
  recentTransactions,
  transactionVolume,
  merchantTransactions,
  settings,
  updateSettings,
  webhookInfo,
  testWebhookCtl,
  createApiKeyCtl,
  listApiKeysCtl,
  deleteApiKeyCtl,
  qrisParse,
  otpRequest,
  otpVerify,
  refreshSessionCtl,
  createMerchantCtl,
  listMerchantsCtl,
  merchantSummary,
  updateMerchantCtl,
  deleteMerchantCtl,
  listNotificationsCtl,
  markNotificationReadCtl,
  markAllNotificationsReadCtl,
  listAnnouncementsCtl,
  markAnnouncementReadCtl,
} from "../controllers/customer";
import {
  listPlansCtl,
  getPlanCtl,
} from "../controllers/customer/plans.controller";
import {
  listMySubscriptionsCtl,
  createSubscriptionCtl,
} from "../controllers/customer/subscriptions.controller";
import { listMyInvoicesCtl } from "../controllers/customer/invoices.controller";
import {
  createSandboxQris,
  simulateSandboxPay,
  simulateSandboxExpire,
} from "../controllers/sandbox.controller";
// Customer gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const customerRoutes = new Hono<AppEnv>();

// Semua route butuh cookie session (role apa pun)
const customerAuth = [cookieAuth, customerGuard] as const;

customerRoutes.get("/me", ...customerAuth, me);
customerRoutes.patch("/profile", ...customerAuth, updateProfile);
customerRoutes.post("/change-password", ...customerAuth, changePassword);

// Dashboard: butuh merchant (query/header)
customerRoutes.get("/dashboard", ...customerAuth, dashboard);
customerRoutes.get("/logs", ...customerAuth, listLogsCtl);
customerRoutes.get("/transactions", ...customerAuth, listTransactions);
customerRoutes.get("/transactions/recent", ...customerAuth, recentTransactions);
customerRoutes.get("/transactions/volume", ...customerAuth, transactionVolume);
customerRoutes.get(
  "/transactions/:id/code",
  ...customerAuth,
  getTransactionCode,
);
// Sandbox: QRIS tanpa merchant (merchant_id NULL), bayar via tombol simulasi.
customerRoutes.post("/sandbox/qris", ...customerAuth, createSandboxQris);
customerRoutes.post("/sandbox/qris/:id/simulate-pay", ...customerAuth, simulateSandboxPay);
customerRoutes.post("/sandbox/qris/:id/simulate-expire", ...customerAuth, simulateSandboxExpire);

// Merchants
customerRoutes.post("/merchants", ...customerAuth, createMerchantCtl);
customerRoutes.get("/merchants", ...customerAuth, listMerchantsCtl);
customerRoutes.get("/merchants/summary", ...customerAuth, merchantSummary);
customerRoutes.patch("/merchants/:id", ...customerAuth, updateMerchantCtl);
customerRoutes.delete("/merchants/:id", ...customerAuth, deleteMerchantCtl);
customerRoutes.get(
  "/merchants/:id/transactions",
  ...customerAuth,
  merchantTransactions,
);
customerRoutes.post("/merchants/:id/qris-parse", ...customerAuth, qrisParse);
customerRoutes.post("/merchants/:id/otp-request", ...customerAuth, otpRequest);
customerRoutes.post("/merchants/:id/otp-verify", ...customerAuth, otpVerify);
customerRoutes.post(
  "/merchants/:id/refresh",
  ...customerAuth,
  refreshSessionCtl,
);
customerRoutes.post("/merchants/:id/qris", ...customerAuth, createQris);
// API keys
customerRoutes.post("/api-keys", ...customerAuth, createApiKeyCtl);
customerRoutes.get("/api-keys", ...customerAuth, listApiKeysCtl);
customerRoutes.delete("/api-keys/:id", ...customerAuth, deleteApiKeyCtl);

// Notifications
customerRoutes.get("/notifications", ...customerAuth, listNotificationsCtl);
customerRoutes.post("/notifications/read-all", ...customerAuth, markAllNotificationsReadCtl);
customerRoutes.post(
  "/notifications/:id/read",
  ...customerAuth,
  markNotificationReadCtl,
);

// Settings
customerRoutes.get("/settings", ...customerAuth, settings);
customerRoutes.patch("/settings", ...customerAuth, updateSettings);
customerRoutes.get("/settings/webhook", ...customerAuth, webhookInfo);
customerRoutes.post("/settings/webhook/test", ...customerAuth, testWebhookCtl);

// Billing: customer baca plan, self-service subscribe
customerRoutes.get("/plans", ...customerAuth, listPlansCtl);
customerRoutes.get("/plans/:id", ...customerAuth, getPlanCtl);
customerRoutes.get("/subscriptions", ...customerAuth, listMySubscriptionsCtl);
customerRoutes.post("/subscriptions", ...customerAuth, createSubscriptionCtl);
customerRoutes.get("/invoices", ...customerAuth, listMyInvoicesCtl);

// Announcements: baca broadcast + dismiss/hide banner per user
customerRoutes.get("/announcements", ...customerAuth, listAnnouncementsCtl);
customerRoutes.post(
  "/announcements/:id/read",
  ...customerAuth,
  markAnnouncementReadCtl,
);

export { customerRoutes };
