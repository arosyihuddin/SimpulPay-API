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
  getUserByEmail,
  createUser,
} from "../src/db/repositories/user.repository";
import { setSystemSetting } from "../src/db/repositories/systemSettings.repository";
import { hashPassword } from "../src/utils/auth.helper";

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("DATABASE_URL belum di-set di .env");
  process.exit(1);
}

// Seed jalan di bun/node (TCP ok), bukan di Workers — postgres.js tetap cocok.
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
  isFeatured?: boolean;
};
const plans: SeedPlan[] = [
  {
    id: "p_free",
    name: "Free",
    type: "free",
    price: 0,
    maxMerchants: 1,
    dailyPaidLimit: 10,
    featuresJson: null,
  },
  {
    id: "p_starter",
    name: "Starter",
    type: "paid",
    price: 49000,
    maxMerchants: 3,
    dailyPaidLimit: 50,
    featuresJson: JSON.stringify({ priority_support: true }),
    isFeatured: true,
  },
  {
    id: "p_business",
    name: "Business",
    type: "paid",
    price: 79000,
    maxMerchants: 10,
    dailyPaidLimit: null,
    featuresJson: JSON.stringify({ priority_support: true, analytics: true }),
  },
];

for (const p of plans) {
  const existing = await getPlan(db, p.id);
  if (existing) {
    await updatePlan(db, p.id, {
      price: p.price,
      maxMerchants: p.maxMerchants,
      dailyPaidLimit: p.dailyPaidLimit,
      featuresJson: p.featuresJson,
      name: p.name,
      type: p.type,
      active: true,
      isFeatured: p.isFeatured ?? false,
    });
    console.log(`plan ${p.id} di-update`);
    continue;
  }
  await createPlan(db, p);
  console.log(`plan ${p.id} dibuat`);
}

// ── Admin user ──────────────────────────────────────
const adminEmail = process.env.ADMIN_EMAIL || "admin@simpulpay.com";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const existingAdmin = await getUserByEmail(db, adminEmail);
if (!existingAdmin) {
  await createUser(db, {
    id: crypto.randomUUID(),
    email: adminEmail,
    passwordHash: await hashPassword(adminPassword),
    role: "admin",
  });
  console.log(`admin '${adminEmail}' dibuat`);
} else {
  console.log(`admin '${adminEmail}' sudah ada`);
}

// ── System settings ───────────────────────────────────
await setSystemSetting(db, "maintenance", "false");
console.log("system_settings maintenance=false (default)");

await client.end();
console.log("seed selesai ✓");
