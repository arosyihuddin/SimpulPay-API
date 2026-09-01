/**
 * Seed data awal: plans + settings system-wide.
 * Idempotent — aman di-run berulang. Update value plan yang udah ada.
 * Usage: bun run seed
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import {
  createPlan,
  getPlan,
  updatePlan,
} from "../src/db/repositories/plans.repository";
import {
  getUserByUsername,
  createUser,
} from "../src/db/repositories/user.repository";
import { setSystemSetting } from "../src/db/repositories/systemSettings.repository";
import { hashPassword } from "../src/utils/auth.helper";

const cs =
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
  process.env.DATABASE_URL;
if (!cs) {
  console.error("DATABASE_URL / HYPERDRIVE local belum di-set di .env");
  process.exit(1);
}

const client = postgres(cs, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

// ── Plans ───────────────────────────────────────────
// dailyPaidLimit: null = unlimited (Business). Harga dalam rupiah.
type SeedPlan = {
  id: string;
  name: string;
  type: "free" | "paid";
  price: number;
  maxMerchants: number;
  dailyPaidLimit: number | null;
  featuresJson: string | null;
};
const plans: SeedPlan[] = [
  { id: "p_free", name: "Free", type: "free", price: 0, maxMerchants: 1, dailyPaidLimit: 10, featuresJson: null },
  { id: "p_starter", name: "Starter", type: "paid", price: 49000, maxMerchants: 3, dailyPaidLimit: 50, featuresJson: JSON.stringify({ priority_support: true }) },
  { id: "p_business", name: "Business", type: "paid", price: 79000, maxMerchants: 10, dailyPaidLimit: null, featuresJson: JSON.stringify({ priority_support: true, analytics: true }) },
];

for (const p of plans) {
  const existing = await getPlan(db, p.id);
  if (existing) {
    // Update value terbaru (harga/limit berubah dari seed sebelumnya)
    await updatePlan(db, p.id, {
      price: p.price,
      maxMerchants: p.maxMerchants,
      dailyPaidLimit: p.dailyPaidLimit,
      featuresJson: p.featuresJson,
      name: p.name,
      type: p.type,
      active: true,
    });
    console.log(`plan ${p.id} di-update`);
    continue;
  }
  await createPlan(db, p);
  console.log(`plan ${p.id} dibuat`);
}

// ── Admin user (pengganti setup) ─────────────────────
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const existingAdmin = await getUserByUsername(db, adminUsername);
if (!existingAdmin) {
  await createUser(db, {
    id: crypto.randomUUID(),
    username: adminUsername,
    passwordHash: await hashPassword(adminPassword),
    role: "admin",
  });
  console.log(`admin '${adminUsername}' dibuat`);
} else {
  console.log(`admin '${adminUsername}' sudah ada`);
}

// ── System settings ───────────────────────────────────
// maintenance: false default — toggle via admin POST /admin/maintenance
await setSystemSetting(db, "maintenance", "false");
console.log("system_settings maintenance=false (default)");

await client.end();
console.log("seed selesai ✓");
