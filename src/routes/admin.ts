import { Hono } from "hono";
import { adminGuard, cookieAuth } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  listUsersCtl,
  createUserCtl,
  updateUserCtl,
  deleteUserCtl,
} from "../controllers/admin/auth";
import {
  createPlanCtl,
  updatePlanCtl,
  deletePlanCtl,
} from "../controllers/admin/plans.controller";
import {
  listSubscriptionsCtl,
  cancelSubscriptionCtl,
  resyncSubTimersCtl,
} from "../controllers/admin/subscriptions.controller";
import {
  listInvoicesCtl,
  markInvoicePaidCtl,
  rejectInvoiceCtl,
} from "../controllers/admin/invoices.controller";
import {
  createAnnouncementCtl,
  updateAnnouncementCtl,
  deleteAnnouncementCtl,
} from "../controllers/admin/announcements";
import {
  getMaintenanceCtl,
  setMaintenanceCtl,
} from "../controllers/admin/maintenance";

// Admin gak masuk spec OpenAPI (swagger cuma untuk API v1) — pakai Hono biasa.
const adminRoutes = new Hono<AppEnv>();
const adminAuth = [cookieAuth, adminGuard] as const;

adminRoutes.get("/users", ...adminAuth, listUsersCtl);
adminRoutes.post("/users", ...adminAuth, createUserCtl);
adminRoutes.patch("/users/:id", ...adminAuth, updateUserCtl);
adminRoutes.delete("/users/:id", ...adminAuth, deleteUserCtl);
adminRoutes.post("/announcements", ...adminAuth, createAnnouncementCtl);
adminRoutes.patch("/announcements/:id", ...adminAuth, updateAnnouncementCtl);
adminRoutes.delete("/announcements/:id", ...adminAuth, deleteAnnouncementCtl);
adminRoutes.post("/plans", ...adminAuth, createPlanCtl);
adminRoutes.patch("/plans/:id", ...adminAuth, updatePlanCtl);
adminRoutes.delete("/plans/:id", ...adminAuth, deletePlanCtl);
adminRoutes.get("/subscribers", ...adminAuth, listSubscriptionsCtl);
adminRoutes.post("/subscribers/resync-timers", ...adminAuth, resyncSubTimersCtl);
adminRoutes.post(
  "/subscribers/:id/cancel",
  ...adminAuth,
  cancelSubscriptionCtl,
);
adminRoutes.get("/invoices", ...adminAuth, listInvoicesCtl);
adminRoutes.post("/invoices/:id/paid", ...adminAuth, markInvoicePaidCtl);
adminRoutes.post("/invoices/:id/reject", ...adminAuth, rejectInvoiceCtl);
adminRoutes.get("/maintenance", ...adminAuth, getMaintenanceCtl);
adminRoutes.post("/maintenance", ...adminAuth, setMaintenanceCtl);

export { adminRoutes };
