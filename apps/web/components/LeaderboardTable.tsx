"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeaderRow } from "@/lib/queries";
import { CRITERIA } from "@/lib/criteria";
import { ScoreBadge } from "./ScoreBadge";
import { normalize100, rankColor } from "@/lib/scoring";

export function LeaderboardTable({ rows: initial }: { rows: LeaderRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualMode, setManualMode] = useState(
    initial.some((r) => r.team.displayOrder != null)
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-slate-500">
        Henüz takım yok. <Link href="/admin" className="underline">Admin</Link>'den ekleyebilirsin.
      </div>
    );
  }

  async function persist(orderIds: string[]) {
    setSaving(true);
    try {
      await fetch("/api/teams/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderIds }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function onDragStart(e: React.DragEvent<HTMLTableRowElement>, i: number) {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent<HTMLTableRowElement>, i: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIndex !== i) setOverIndex(i);
  }

  function onDrop(e: React.DragEvent<HTMLTableRowElement>, i: number) {
    e.preventDefault();
    if (dragIndex == null || dragIndex === i) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...rows];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    setRows(next);
    setDragIndex(null);
    setOverIndex(null);
    setManualMode(true);
    persist(next.map((r) => r.team.id));
  }

  function resetOrder() {
    setManualMode(false);
    persist([]); // empty array = clear display_order on all teams
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {manualMode ? (
            <>Manuel sıra · sürükleyerek değiştir</>
          ) : (
            <>Puana göre sıralı · sürükleyerek manuel sıraya geç</>
          )}
        </span>
        <div className="flex items-center gap-3">
          {saving && <span className="text-slate-400">kaydediliyor...</span>}
          {manualMode && (
            <button
              onClick={resetOrder}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            >
              Puana göre sıralamaya dön
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-3 w-8"></th>
              <th className="px-3 py-3 w-10">#</th>
              <th className="px-3 py-3">Takım</th>
              <th className="px-3 py-3" title="Tıkla → Excel için kopyala">/10</th>
              <th className="px-3 py-3">Toplam</th>
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
              const isDragging = dragIndex === i;
              const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
              return (
                <tr
                  key={row.team.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, i)}
                  onDragOver={(e) => onDragOver(e, i)}
                  onDrop={(e) => onDrop(e, i)}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  className={`hover:bg-slate-50 ${isDragging ? "opacity-40" : ""} ${
                    isOver ? "border-t-2 border-slate-900" : ""
                  }`}
                >
                  <td className="cursor-grab select-none px-2 text-slate-400" title="Sürükle">
                    ⋮⋮
                  </td>
                  <td className="px-3 py-3 font-medium text-slate-500">{rank}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{row.team.name}</div>
                    <a
                      href={row.team.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      onMouseDown={(e) => e.stopPropagation()}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      {row.team.repoUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </td>
                  <td className="px-3 py-3">
                    {row.totalScore != null ? (() => {
                      const v = (normalize100(row.totalScore, row.maxScore) / 10).toFixed(1);
                      const cls = rankColor(row.totalScore, row.maxScore);
                      return (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await navigator.clipboard.writeText(v);
                              const btn = e.currentTarget;
                              const orig = btn.textContent;
                              btn.textContent = "✓";
                              setTimeout(() => { btn.textContent = orig; }, 1200);
                            } catch {}
                          }}
                          title="Tıkla → panoya kopyala (Excel için)"
                          className={`inline-flex items-center rounded-md px-3 py-1.5 text-base font-semibold cursor-pointer hover:brightness-95 active:brightness-90 ${cls}`}
                        >
                          {v}
                        </button>
                      );
                    })() : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <ScoreBadge score={row.totalScore} max={row.maxScore} size="lg" />
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
                      onMouseDown={(e) => e.stopPropagation()}
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
    </div>
  );
}
