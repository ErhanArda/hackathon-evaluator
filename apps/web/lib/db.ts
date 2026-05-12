import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "";

if (!connectionString) {
  console.warn("[db] POSTGRES_URL/DATABASE_URL not set — DB calls will fail.");
}

const client = postgres(connectionString, {
  prepare: false,
  max: 5,
});

export const db = drizzle(client, { schema });
export { schema };
