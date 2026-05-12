import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamDetail } from "@/lib/queries";
import { isDbConfigured } from "@/lib/db";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SetupBanner } from "@/components/SetupBanner";
import { EvaluateButton } from "@/components/EvaluateButton";
import { CRITERIA, TOTAL_MAX } from "@/lib/criteria";
import { normalize100 } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function TeamDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <Link href="/" className="text-sm text-slate-500 hover:underline">← Leaderboard</Link>
        <SetupBanner />
      </div>
    );
  }

  let detail: Awaited<ReturnType<typeof getTeamDetail>> = null;
  try {
    detail = await getTeamDetail(id);
  } catch (err) {
    console.error("[team-detail] failed:", err);
  }
  if (!detail) notFound();

  const latest = detail.evaluations[0];
  const history = detail.evaluations.slice(1);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:underline">← Leaderboard</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{detail.team.name}</h1>
        <a
          href={detail.team.repoUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-sm text-slate-500 hover:underline"
        >
          {detail.team.repoUrl}
        </a>
        {detail.team.members && detail.team.members.length > 0 && (
          <div className="mt-2 text-xs text-slate-500">
            Üyeler: {detail.team.members.join(", ")}
          </div>
        )}
      </div>

      <EvaluateButton
        teamId={detail.team.id}
        repoUrl={detail.team.repoUrl}
        hasEvaluation={!!latest}
      />

      {!latest ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-slate-500">
          Henüz değerlendirilmedi. Yukarıdaki butonla komutu kopyala, Claude Code'a yapıştır.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline gap-4">
              <ScoreBadge score={latest.totalScore} max={latest.maxScore} size="lg" />
              <div className="text-2xl font-semibold">
                {normalize100(latest.totalScore, latest.maxScore)}
                <span className="text-base font-normal text-slate-400">/100</span>
              </div>
              <div className="ml-auto text-xs text-slate-500">
                {new Date(latest.createdAt).toLocaleString("tr-TR")} · {latest.evaluator}
              </div>
            </div>
            {latest.modelNote && (
              <p className="mt-2 text-xs text-slate-500">{latest.modelNote}</p>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Kriter Dökümü</h2>
            {CRITERIA.map((c) => {
              const s = latest.scores.find((x) => x.criterion === c.key);
              return (
                <details
                  key={c.key}
                  open
                  className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-4">
                    <div className="font-medium">{c.label}</div>
                    <ScoreBadge score={s?.score ?? null} max={c.max} />
                  </summary>
                  {s ? (
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="rounded-md bg-slate-50 p-3 text-slate-700">
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                          AI Gerekçesi
                        </div>
                        {s.rationale?.rationale ?? <span className="text-slate-400">—</span>}
                      </div>
                      {Array.isArray(s.rationale?.evidence) && s.rationale.evidence.length > 0 && (
                        <div className="rounded-md border border-slate-200 p-3">
                          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                            Evidence
                          </div>
                          <ul className="space-y-1 text-xs">
                            {(s.rationale.evidence as { path: string; lines?: string; note?: string }[]).map(
                              (e, i) => (
                                <li key={i} className="font-mono text-slate-600">
                                  <span className="text-slate-900">{e.path}</span>
                                  {e.lines ? `:${e.lines}` : ""}
                                  {e.note ? <span className="text-slate-500"> — {e.note}</span> : null}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-slate-400">Bu kriter için skor yok.</div>
                  )}
                </details>
              );
            })}
          </div>

          {history.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Tarihçe</h2>
              <ul className="rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between border-b border-slate-100 px-4 py-2 last:border-0">
                    <span className="text-slate-500">
                      {new Date(h.createdAt).toLocaleString("tr-TR")}
                    </span>
                    <ScoreBadge score={h.totalScore} max={h.maxScore} size="sm" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="text-xs text-slate-500">
        Toplam max puan: {TOTAL_MAX}
      </div>
    </div>
  );
}
