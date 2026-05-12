"use client";

import { useState } from "react";

export function EvaluateButton({
  teamId,
  repoUrl,
  hasEvaluation,
}: {
  teamId: string;
  repoUrl: string;
  hasEvaluation: boolean;
}) {
  const command = `/evaluate ${repoUrl} team-id=${teamId}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API may fail in non-https local
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {hasEvaluation ? "Yeniden değerlendir" : "Değerlendir"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Bu komutu Claude Code oturumuna yapıştır — 4 sub-agent paralel çalışır, ~30-60 sn'de skor güncellenir.
          </p>
        </div>
        <button
          onClick={copy}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
        >
          {copied ? "✓ Kopyalandı" : "📋 Komutu kopyala"}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto rounded bg-slate-100 p-2 font-mono text-xs text-slate-800">
        {command}
      </pre>
    </div>
  );
}
