import { Hono } from "hono";
import { apiKeyGuard } from "../middleware/guards";
import type { AppEnv } from "../types";
import {
  health,
  createQris,
  getQris,
  checkPayment,
  listTransactions,
  monthTransactions,
  tokenStatus,
  logs,
} from "../controllers/v1.controller";

export const v1Routes = new Hono<AppEnv>()
  .use("*", apiKeyGuard)
  .get("/health", health)
  .post("/qris", createQris)
  .get("/qris/:id", getQris)
  .post("/payment/check", checkPayment)
  .get("/transactions", listTransactions)
  .get("/transactions/month", monthTransactions)
  .get("/token-status", tokenStatus)
  .get("/logs", logs);
