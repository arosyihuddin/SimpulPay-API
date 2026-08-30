import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { adminGuard, merchantGuard } from "../middleware/guards";
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
  listUsersCtl,
  createUserCtl,
  updateUserCtl,
  deleteUserCtl,
  createMerchantCtl,
  listMerchantsCtl,
  updateMerchantCtl,
  deleteMerchantCtl,
  listNotificationsCtl,
  markNotificationReadCtl,
  createPlanCtl,
  listPlansCtl,
  getPlanCtl,
  updatePlanCtl,
  deletePlanCtl,
  createSubscriptionCtl,
  listSubscriptionsCtl,
  getSubscriptionCtl,
  cancelSubscriptionCtl,
  listInvoicesCtl,
  getInvoiceCtl,
  markInvoicePaidCtl,
} from "../controllers/admin";

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

// Dashboard: butuh merchant (query/header)
adminRoutes.get("/dashboard", merchantGuard, dashboard);
adminRoutes.post("/qris", merchantGuard, createQris);
adminRoutes.get("/qris", merchantGuard, listQris);
adminRoutes.get("/transactions", merchantGuard, listTransactions);
adminRoutes.get("/logs", listLogs);
adminRoutes.get("/users", listUsersCtl);
adminRoutes.post("/users", createUserCtl);
adminRoutes.patch("/users/{id}", updateUserCtl);
adminRoutes.delete("/users/{id}", deleteUserCtl);

// Merchant CRUD (tanpa merchantGuard — create/read/list pake userId)
adminRoutes.post("/merchants", createMerchantCtl);
adminRoutes.get("/merchants", listMerchantsCtl);
adminRoutes.patch("/merchants/{id}", merchantGuard, updateMerchantCtl);
adminRoutes.delete("/merchants/{id}", merchantGuard, deleteMerchantCtl);

// API keys
adminRoutes.post("/api-keys", createApiKeyCtl);
adminRoutes.get("/api-keys", listApiKeysCtl);
adminRoutes.delete("/api-keys/{id}", deleteApiKeyCtl);

// Notifications
adminRoutes.get("/notifications", listNotificationsCtl);
adminRoutes.post("/notifications/{id}/read", markNotificationReadCtl);

// Settings
adminRoutes.get("/settings", merchantGuard, settings);
adminRoutes.post("/qris-parse", qrisParse);
adminRoutes.post("/qris-static", merchantGuard, qrisStatic);
adminRoutes.post("/merchant-id", merchantGuard, merchantId);
adminRoutes.post("/otp-request", otpRequest);
adminRoutes.post("/otp-verify", merchantGuard, otpVerify);
adminRoutes.post("/refresh-session", merchantGuard, refreshSessionCtl);
adminRoutes.delete("/gobiz-session", merchantGuard, deleteGoBizCtl);

// Billing: plans, subscriptions, invoices
adminRoutes.post("/plans", createPlanCtl);
adminRoutes.get("/plans", listPlansCtl);
adminRoutes.get("/plans/{id}", getPlanCtl);
adminRoutes.patch("/plans/{id}", updatePlanCtl);
adminRoutes.delete("/plans/{id}", deletePlanCtl);
adminRoutes.post("/subscriptions", createSubscriptionCtl);
adminRoutes.get("/subscriptions", listSubscriptionsCtl);
adminRoutes.get("/subscriptions/{id}", getSubscriptionCtl);
adminRoutes.post("/subscriptions/{id}/cancel", cancelSubscriptionCtl);
adminRoutes.get("/invoices", listInvoicesCtl);
adminRoutes.get("/invoices/{id}", getInvoiceCtl);
adminRoutes.post("/invoices/{id}/paid", markInvoicePaidCtl);

export { adminRoutes };
