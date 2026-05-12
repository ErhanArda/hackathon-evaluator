import { config as loadEnv } from "dotenv";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { teams } from "../lib/schema";

// Load env from apps/web/.env.local (one level up from this script's dir)
loadEnv({ path: path.join(__dirname, "..", ".env.local") });
loadEnv();

const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "POSTGRES_URL veya DATABASE_URL set edilmeli (apps/web/.env.local içine koy)."
  );
  process.exit(1);
}

const sample = [
  { id: "t01", name: "Takım 01", repoUrl: "https://github.com/example/team-01" },
  { id: "t02", name: "Takım 02", repoUrl: "https://github.com/example/team-02" },
  { id: "t03", name: "Takım 03", repoUrl: "https://github.com/example/team-03" },
  { id: "t04", name: "Takım 04", repoUrl: "https://github.com/example/team-04" },
  { id: "t05", name: "Takım 05", repoUrl: "https://github.com/example/team-05" },
  { id: "t06", name: "Takım 06", repoUrl: "https://github.com/example/team-06" },
  { id: "t07", name: "Takım 07", repoUrl: "https://github.com/example/team-07" },
  { id: "t08", name: "Takım 08", repoUrl: "https://github.com/example/team-08" },
  { id: "t09", name: "Takım 09", repoUrl: "https://github.com/example/team-09" },
  { id: "t10", name: "Takım 10", repoUrl: "https://github.com/example/team-10" },
  { id: "t11", name: "Takım 11", repoUrl: "https://github.com/example/team-11" },
  { id: "t12", name: "Takım 12", repoUrl: "https://github.com/example/team-12" },
];

async function main() {
  const client = postgres(url!, { prepare: false, max: 2 });
  const db = drizzle(client);
  for (const t of sample) {
    await db
      .insert(teams)
      .values({ id: t.id, name: t.name, repoUrl: t.repoUrl })
      .onConflictDoUpdate({
        target: teams.id,
        set: { name: t.name, repoUrl: t.repoUrl },
      });
    console.log(`✓ ${t.id} ${t.name}`);
  }
  await client.end();
  console.log(`\nSeed tamam: ${sample.length} takım.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
