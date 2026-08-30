import { Hono } from "hono";
import { adminGuard, cookieAuth } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  setupStatus,
  setup,
  listUsersCtl,
  createUserCtl,
  updateUserCtl,
  deleteUserCtl,
} from "../controllers/admin/auth";
import { listLogs } from "../controllers/admin/dashboard";
import { createPlanCtl, updatePlanCtl, deletePlanCtl, listSubscriptionsCtl, getSubscriptionCtl, cancelSubscriptionCtl, listInvoicesCtl, getInvoiceCtl, markInvoicePaidCtl } from "../controllers/admin/billing";
import { createAnnouncementCtl, updateAnnouncementCtl, deleteAnnouncementCtl } from "../controllers/admin/announcements";
import { changePassword } from "../controllers/customer/auth";
import { listAnnouncementsCtl, getAnnouncementCtl } from "../controllers/customer/announcements";
import { listPlansCtl, getPlanCtl } from "../controllers/customer/billing";

// Admin gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const adminPublicRoutes = new Hono<AppEnv>();

// Setup bootstrap — open, gak kena guard (bikin admin pertama, pre-auth)
adminPublicRoutes.get("/setup-status", setupStatus);
adminPublicRoutes.post("/setup", setup);

const adminRoutes = new Hono<AppEnv>();

// Di bawah ini butuh cookie session + role admin
adminRoutes.use("*", cookieAuth, adminGuard);

adminRoutes.post("/change-password", changePassword);

adminRoutes.get("/logs", listLogs);
adminRoutes.get("/users", listUsersCtl);
adminRoutes.post("/users", createUserCtl);
adminRoutes.patch("/users/{id}", updateUserCtl);
adminRoutes.delete("/users/{id}", deleteUserCtl);

// Announcements (admin write; read di customer routes)
adminRoutes.post("/announcements", createAnnouncementCtl);
adminRoutes.get("/announcements", listAnnouncementsCtl);
adminRoutes.get("/announcements/{id}", getAnnouncementCtl);
adminRoutes.patch("/announcements/{id}", updateAnnouncementCtl);
adminRoutes.delete("/announcements/{id}", deleteAnnouncementCtl);

// Billing: admin write plans + subscriptions/invoices admin
adminRoutes.post("/plans", createPlanCtl);
adminRoutes.get("/plans", listPlansCtl);
adminRoutes.get("/plans/{id}", getPlanCtl);
adminRoutes.patch("/plans/{id}", updatePlanCtl);
adminRoutes.delete("/plans/{id}", deletePlanCtl);
adminRoutes.get("/subscriptions", listSubscriptionsCtl);
adminRoutes.get("/subscriptions/{id}", getSubscriptionCtl);
adminRoutes.post("/subscriptions/{id}/cancel", cancelSubscriptionCtl);
adminRoutes.get("/invoices", listInvoicesCtl);
adminRoutes.get("/invoices/{id}", getInvoiceCtl);
adminRoutes.post("/invoices/{id}/paid", markInvoicePaidCtl);

export { adminPublicRoutes, adminRoutes };
