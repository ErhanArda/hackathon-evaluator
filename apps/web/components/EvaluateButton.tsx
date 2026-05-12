"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "queued" | "processing" | "done" | "failed";

const AGENTS = [
  { key: "analist",     label: "Analist",      desc: "docs + readme"        },
  { key: "developer",   label: "Developer",    desc: "temiz kod (context7)" },
  { key: "reviewer",    label: "Reviewer",     desc: "mimari (context7)"    },
  { key: "ai-evidence", label: "AI Evidence",  desc: "agentic + AI izleri"  },
] as const;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function EvaluateButton({
  teamId,
  repoUrl,
  hasEvaluation,
}: {
  teamId: string;
  repoUrl: string;
  hasEvaluation: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const command = `/evaluate ${repoUrl} team-id=${teamId}`;
  const [copied, setCopied] = useState(false);

  // Mount: pick up any existing request for this team
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/eval-requests?teamId=${encodeURIComponent(teamId)}&limit=1`
        );
        if (!r.ok) return;
        const data = await r.json();
        const latest = data.requests?.[0];
        if (cancelled || !latest) return;
        if (latest.status === "pending" || latest.status === "processing") {
          setRequestId(latest.id);
          setStatus(latest.status === "pending" ? "queued" : "processing");
          if (latest.requestedAt) setStartedAt(new Date(latest.requestedAt).getTime());
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Elapsed time ticker (1s)
  useEffect(() => {
    if (status !== "queued" && status !== "processing") {
      if (tickerRef.current) clearInterval(tickerRef.current);
      return;
    }
    tickerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [status]);

  // Status polling (3s)
  useEffect(() => {
    if (!requestId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/eval-requests/${requestId}`);
        if (!r.ok) return;
        const data = await r.json();
        const s: Status =
          data.request.status === "pending"
            ? "queued"
            : (data.request.status as Status);
        setStatus(s);
        if (s === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          router.refresh();
        }
        if (s === "failed") {
          setErrorMsg(data.request.errorMsg ?? "bilinmeyen hata");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [requestId, status, router]);

  async function trigger() {
    setStatus("queued");
    setErrorMsg(null);
    setStartedAt(Date.now());
    try {
      const r = await fetch("/api/eval-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErrorMsg(data.error ?? `HTTP ${r.status}`);
        setStatus("failed");
        return;
      }
      setRequestId(data.request.id);
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("failed");
    }
  }

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may fail outside https */
    }
  }

  async function cancel() {
    if (!requestId) {
      setStatus("idle");
      setStartedAt(null);
      return;
    }
    if (!confirm("Değerlendirme iptal edilsin mi?")) return;
    try {
      await fetch(`/api/eval-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed", errorMsg: "İptal edildi" }),
      });
    } catch {
      /* ignore */
    }
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus("idle");
    setStartedAt(null);
    setRequestId(null);
    router.refresh();
  }

  const isBusy = status === "queued" || status === "processing";
  const elapsed = startedAt ? now - startedAt : 0;
  const buttonLabel = isBusy
    ? `⏱ ${formatElapsed(elapsed)}`
    : status === "done"
    ? "✓ Tamamlandı"
    : status === "failed"
    ? "✗ Tekrar dene"
    : hasEvaluation
    ? "🤖 Yeniden değerlendir"
    : "🤖 Değerlendir";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {hasEvaluation ? "Yeniden değerlendir" : "Değerlendir"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            4 sub-agent paralel çalışır. <strong>Küçük repo: 30-90 sn · Büyük repo: 2-5 dk.</strong> Süre, repo
            boyutuna göre değişir (analist/developer dosyaları gerçekten okur).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isBusy && (
            <button
              onClick={cancel}
              className="rounded-md border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              İptal
            </button>
          )}
          <button
            onClick={trigger}
            disabled={isBusy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {buttonLabel}
          </button>
        </div>
      </div>

      {isBusy && (
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline justify-between text-xs text-slate-600">
            <span>
              {status === "queued"
                ? "⏳ Worker bekleniyor (cron her dakika)"
                : "🔄 Sub-agent'lar koşuyor — paralel"}
            </span>
            <span className="font-mono text-slate-500">
              elapsed: {formatElapsed(elapsed)}
              {requestId && <span className="ml-2 opacity-60">{requestId}</span>}
            </span>
          </div>

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AGENTS.map((a) => (
              <li
                key={a.key}
                className={`rounded-md border p-2 text-xs ${
                  status === "processing"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.label}</span>
                  {status === "processing" ? (
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  ) : (
                    <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] opacity-70">{a.desc}</div>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-slate-400">
            * Sub-agent'lar gerçek zamanlı bağımsız çalışır; tek tek bittiklerini bekleyemiyoruz, hepsi
            tamamlanınca skor toplu güncellenir.
          </p>
        </div>
      )}

      {status === "failed" && errorMsg && (
        <div className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-900">
          Hata: {errorMsg}
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
          Worker yoksa: komutu manuel kopyala
        </summary>
        <div className="mt-2 flex items-center gap-2">
          <pre className="flex-1 overflow-x-auto rounded bg-slate-100 p-2 font-mono text-xs text-slate-800">
            {command}
          </pre>
          <button
            onClick={copyCmd}
            className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          >
            {copied ? "✓" : "📋"}
          </button>
        </div>
      </details>
    </div>
  );
}
