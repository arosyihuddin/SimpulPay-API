// Public routes: halaman QRIS customer + cek status (handler di controller)
import { Elysia } from "elysia";
import { health, apiHealth, qrPage, qrStatus } from "../controllers/public.controller";

export const publicRoutes = new Elysia({ prefix: "" })
  .get("/health", health)
  .get("/api/health", apiHealth)
  .get("/qr/:id", async ({ params, query }) => qrPage(params, query))
  .get("/api/qr-status/:id", async ({ params, headers }) =>
    qrStatus(params.id, headers),
  );