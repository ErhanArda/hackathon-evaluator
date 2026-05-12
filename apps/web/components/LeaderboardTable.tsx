import Link from "next/link";
import type { LeaderRow } from "@/lib/queries";
import { CRITERIA } from "@/lib/criteria";
import { ScoreBadge } from "./ScoreBadge";
import { normalize100 } from "@/lib/scoring";

export function LeaderboardTable({ rows }: { rows: LeaderRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-slate-500">
        Henüz takım yok. <Link href="/admin" className="underline">Admin</Link>'den ekleyebilirsin.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-3 w-10">#</th>
            <th className="px-3 py-3">Takım</th>
            <th className="px-3 py-3">Toplam</th>
            <th className="px-3 py-3">/100</th>
            {CRITERIA.map((c) => (
              <th key={c.key} className="px-3 py-3 whitespace-nowrap" title={c.label}>
                {c.label.split(" ")[0]}
              </th>
            ))}
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((row, i) => {
            const rank = row.totalScore != null ? i + 1 : "—";
            return (
              <tr key={row.team.id} className="hover:bg-slate-50">
                <td className="px-3 py-3 font-medium text-slate-500">{rank}</td>
                <td className="px-3 py-3">
                  <div className="font-medium">{row.team.name}</div>
                  <a
                    href={row.team.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-500 hover:underline"
                  >
                    {row.team.repoUrl.replace(/^https?:\/\//, "")}
                  </a>
                </td>
                <td className="px-3 py-3">
                  <ScoreBadge score={row.totalScore} max={row.maxScore} size="lg" />
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {row.totalScore != null ? `${normalize100(row.totalScore, row.maxScore)}` : "—"}
                </td>
                {CRITERIA.map((c) => (
                  <td key={c.key} className="px-3 py-3">
                    <ScoreBadge
                      score={row.scoresByCriterion[c.key] ?? null}
                      max={c.max}
                      size="sm"
                    />
                  </td>
                ))}
                <td className="px-3 py-3 text-right">
                  <Link
                    href={`/teams/${row.team.id}`}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                  >
                    Detay →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
