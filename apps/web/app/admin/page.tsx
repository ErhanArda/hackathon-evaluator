import { AdminPanel } from "@/components/AdminPanel";
import { QueuePanel } from "@/components/QueuePanel";
import { SetupBanner } from "@/components/SetupBanner";
import { db, schema, isDbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <SetupBanner />
      </div>
    );
  }
  let teams: (typeof schema.teams.$inferSelect)[] = [];
  try {
    teams = await db.select().from(schema.teams).orderBy(schema.teams.name);
  } catch (err) {
    console.error("[admin] failed to load teams:", err);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <QueuePanel />
      <AdminPanel initialTeams={teams} />
    </div>
  );
}
