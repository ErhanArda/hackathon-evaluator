import { LeaderboardTable } from "@/components/LeaderboardTable";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SetupBanner } from "@/components/SetupBanner";
import { getLeaderboard } from "@/lib/queries";
import { isDbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <SetupBanner />
      </div>
    );
  }

  let rows: Awaited<ReturnType<typeof getLeaderboard>> = [];
  try {
    rows = await getLeaderboard();
  } catch (err) {
    console.error("[leaderboard] failed:", err);
  }
  const evaluated = rows.filter((r) => r.totalScore != null).length;

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={5000} />
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} takım kayıtlı · {evaluated} değerlendirme tamamlandı · 5 sn'de bir yenilenir
          </p>
        </div>
        <a
          href="/api/export.xlsx"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700"
        >
          📊 Excel indir
        </a>
      </div>
      <LeaderboardTable rows={rows} />
    </div>
  );
}
