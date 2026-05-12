"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "queued" | "processing" | "done" | "failed";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const command = `/evaluate ${repoUrl} team-id=${teamId}`;
  const [copied, setCopied] = useState(false);

  // Check if there's already a pending request for this team on mount
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
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Poll while queued/processing
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

  const isBusy = status === "queued" || status === "processing";
  const buttonLabel =
    status === "queued"
      ? "⏳ Sıraya alındı..."
      : status === "processing"
      ? "🔄 Sub-agent'lar çalışıyor..."
      : status === "done"
      ? "✓ Tamamlandı"
      : status === "failed"
      ? "✗ Hata — tekrar dene"
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
            Tıklayınca kuyruğa eklenir; aktif Claude Code worker'ı (otomatik /process-queue) 30-60 sn içinde
            4 sub-agent'ı paralel koşturur ve sayfa otomatik yenilenir.
          </p>
        </div>
        <button
          onClick={trigger}
          disabled={isBusy}
          className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>

      {(status === "queued" || status === "processing") && (
        <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          {status === "queued"
            ? "Worker'ın bu request'i alması bekleniyor (genelde <5 sn)..."
            : "4 sub-agent paralel çalışıyor (analist + developer + reviewer + ai-evidence)..."}
          {requestId && <span className="ml-2 font-mono opacity-70">{requestId}</span>}
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
