"use client";

import { useCallback, useEffect, useState } from "react";

type Req = {
  id: string;
  teamId: string;
  status: "pending" | "processing" | "done" | "failed";
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMsg: string | null;
};

type Team = {
  id: string;
  name: string;
  repoUrl: string;
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function QueuePanel() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [teams, setTeams] = useState<Map<string, Team>>(new Map());
  const [now, setNow] = useState<number>(() => Date.now());
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [rRes, tRes] = await Promise.all([
        fetch("/api/eval-requests?status=active&limit=50"),
        fetch("/api/teams"),
      ]);
      if (rRes.ok) {
        const data = await rRes.json();
        setReqs(data.requests as Req[]);
      }
      if (tRes.ok) {
        const data = await tRes.json();
        const m = new Map<string, Team>();
        for (const t of data.teams as Team[]) m.set(t.id, t);
        setTeams(m);
      }
      setLoaded(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function cancel(reqId: string) {
    if (!confirm("Bu request iptal edilsin mi?")) return;
    await fetch(`/api/eval-requests/${reqId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed", errorMsg: "Admin iptal etti" }),
    });
    refresh();
  }

  const pendingCount = reqs.filter((r) => r.status === "pending").length;
  const processingCount = reqs.filter((r) => r.status === "processing").length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-3 text-base font-semibold">
          <span>Kuyruk Durumu</span>
          <span className="text-xs font-normal text-slate-500">
            ⏳ {pendingCount} pending · 🔄 {processingCount} processing
          </span>
        </div>
        <span className="text-xs text-slate-400">5 sn'de bir yenilenir</span>
      </div>
      {reqs.length === 0 && loaded && (
        <div className="px-4 py-6 text-center text-sm text-slate-400">
          ✓ Kuyruk boş — tüm değerlendirmeler tamam.
        </div>
      )}
      {reqs.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {reqs.map((r) => {
            const t = teams.get(r.teamId);
            const startTs = r.status === "processing" && r.startedAt
              ? new Date(r.startedAt).getTime()
              : new Date(r.requestedAt).getTime();
            const elapsed = now - startTs;
            const isProc = r.status === "processing";
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span
                  className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                    isProc
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {isProc ? "🔄 İşleniyor" : "⏳ Bekliyor"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t?.name ?? r.teamId}</div>
                  <div className="truncate text-xs text-slate-500">
                    {t?.repoUrl ?? "—"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-xs">
                    {formatElapsed(elapsed)}
                  </div>
                  <div className="text-[11px] text-slate-400">{r.id}</div>
                </div>
                <button
                  onClick={() => cancel(r.id)}
                  className="shrink-0 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                >
                  İptal
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
