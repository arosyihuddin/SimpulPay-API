# GoMerch API

Gateway pembayaran QRIS GoPay/GoBiz — generate QRIS dinamis EMVCo, verifikasi pembayaran via API Gojek merchant, anti double-claim.

- **Runtime:** Bun + Elysia
- **DB:** SQLite (`data/gateway.db`, default) **atau** PostgreSQL (`DB_DRIVER=postgres` → `DATABASE_URL`). Multi-driver via Drizzle — siap pakai D1/Postgres/Cloudflare di masa depan.
- **Auth:** API key utk endpoint publik, cookie httpOnly session utk admin
- **Login GoBiz:** OTP lewat dashboard (Settings → Login GoBiz)

> Frontend admin SPA dipisah di repo **GoMerch-Client** (React + Vite).

## Struktur

```
src/
  main.ts             ← entrypoint Elysia (route + cron + static serve)
  db/
    schema.ts         ← Drizzle schema sqlite dialect
    schema.pg.ts      ← Drizzle schema postgres dialect
    client.ts         ← dual-driver client (sqlite | postgres, via DB_DRIVER)
  services/           ← sessionManager, gobizAuth, qris, gojek, realtime, qrDecoder
  routes/             ← public.ts, v1.ts, admin.ts
  controllers/        ← v1, public, admin
  middleware/         ← guards.ts, errorHandler.ts
  templates/          ← qr.html, expired.html (halaman pembayaran customer)
```

## Setup

```bash
bun install
cp .env.example .env   # isi variabel sesuai kebutuhan
bun run dev            # :3000
```

## Database

- Default **SQLite** di `data/gateway.db` (auto-buat, WAL).
- **PostgreSQL**:
  ```bash
  DB_DRIVER=postgres
  DATABASE_URL=postgres://user:pass@host:5432/gomerch
  ```
  Tabel dibuat otomatis saat boot (`ensureSchema`), idempoten.
- Punya `drizzle.config.ts` + `drizzle-kit` utk migrasi bila perlu.

## Production

```bash
bun start    # :3000
```

Docker:

```bash
docker compose up -d --build   # volume ./data persist sqlite + sesi
```

## Environment

| Var | Wajib | Keterangan |
|---|---|---|
| `PORT` | no | default `3000` |
| `API_KEY` | yes | kunci endpoint API publik (`X-Api-Key` / `?api_key=`) |
| `QRIS_STATIC` | yes | template QRIS statis merchant (tag 11 → 12 dinamis) |
| `GOPAY_MERCHANT_ID` | no | override merchant id |
| `ADMIN_USER` / `ADMIN_PASSWORD` | yes | login dashboard admin |
| `DB_DRIVER` | no | `sqlite` (default) \| `postgres` |
| `DATABASE_URL` | postgres-no | dipakai saat `DB_DRIVER=postgres` |
| `DATABASE_PATH` | no | default `./data/gateway.db` |

## Admin API & UI

Admin endpoint `/admin/*` (login, dashboard, qris, transaksi, logs, settings) dipakai oleh SPA di **GoMerch-Client**. CORS hanya utk `localhost:*` di dev; production bisa di-serve reverse-proxy ke domain sama.

Referensi API lengkap: `/docs` (Swagger) saat server jalan.
