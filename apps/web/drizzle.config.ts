import { config as loadEnv } from "dotenv";
import path from "node:path";
import type { Config } from "drizzle-kit";

// dotenv default loads .env; explicitly also load .env.local (Next.js convention)
loadEnv({ path: path.join(__dirname, ".env.local") });
loadEnv();

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.POSTGRES_URL ??
      process.env.DATABASE_URL ??
      "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
