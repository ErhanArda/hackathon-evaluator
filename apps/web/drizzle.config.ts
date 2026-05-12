import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ??
      process.env.DATABASE_URL ??
      "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
