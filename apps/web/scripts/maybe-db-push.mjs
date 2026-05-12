import { spawnSync } from "node:child_process";

const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.log("[maybe-db-push] POSTGRES_URL not set — skipping drizzle-kit push.");
  console.log("[maybe-db-push] Add Postgres in Vercel Storage tab and redeploy.");
  process.exit(0);
}

console.log("[maybe-db-push] POSTGRES_URL detected — running drizzle-kit push --force");
const r = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status ?? 0);
