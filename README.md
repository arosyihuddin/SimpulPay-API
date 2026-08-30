# GoMerch API

Gateway pembayaran QRIS GoPay/GoBiz — generate QRIS dinamis EMVCo, verifikasi pembayaran via API Gojek merchant, anti double-claim.

- **Runtime:** Cloudflare Workers + Hono
- **DB:** PostgreSQL via postgres.js + Drizzle ORM (Hyperdrive di prod, Supabase pooler di dev)
- **Auth:** API key utk endpoint publik, cookie httpOnly session utk admin
- **Login GoBiz:** OTP lewat dashboard (Settings → Login GoBiz)

> Frontend admin SPA dipisah di repo **GoMerch-Client** (React + Vite).

## Struktur

```
src/
  index.ts            ← entrypoint Worker (Hono + cron + Durable Object)
  types.ts            ← Env, AppEnv (type binding)
  db/
    schema.ts         ← Drizzle schema pg-core
    client.ts         ← per-request DB lifecycle (getDb/closeDb/createDb)
    queries.ts        ← query functions (qris, claims, logs, settings, sessions)
    repositories/     ← user.repository.ts
  services/           ← sessionManager, gobizAuth, qris, gojek, realtime, qrDecoder
  routes/             ← public.ts, v1.ts, admin.ts
  controllers/        ← v1, public, admin
  middleware/         ← guards.ts, errorHandler.ts
  durable_objects/    ← merchantWS.ts (WebSocket broadcast)
```

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars   # isi DATABASE_URL-mu
bun run dev                      # wrangler dev :8787
```

## Database

- PostgreSQL via `postgres.js` + Drizzle ORM
- Prod: Hyperdrive binding (`HYPERDRIVE`)
- Dev: `DATABASE_URL` di `.dev.vars` (Supabase pooler port 6543)
- Migrasi: `drizzle-kit generate` + jalanin SQL di `migrations/` manual

## Deploy

```bash
bun run deploy   # wrangler deploy
```

Secret di-set via dashboard atau `wrangler secret put <NAME>`.