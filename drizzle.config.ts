import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // .env pakai key Hyperdrive local (wrangler dev); DATABASE_URL jadi fallback.
    url:
      process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
      process.env.DATABASE_URL ??
      "",
  },
});
