import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Lokal (bun/node, TCP ok): pakai Neon direct URL via DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
