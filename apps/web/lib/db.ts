import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (_db) return _db;
  const connectionString =
    process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL/DATABASE_URL not set. Set it in .env.local or in Vercel env vars."
    );
  }
  const client = postgres(connectionString, { prepare: false, max: 5 });
  _db = drizzle(client, { schema });
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export { schema };
