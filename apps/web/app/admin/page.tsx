import { AdminPanel } from "@/components/AdminPanel";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let teams: (typeof schema.teams.$inferSelect)[] = [];
  try {
    teams = await db.select().from(schema.teams).orderBy(schema.teams.name);
  } catch (err) {
    console.error("[admin] failed to load teams:", err);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <AdminPanel initialTeams={teams} />
    </div>
  );
}
