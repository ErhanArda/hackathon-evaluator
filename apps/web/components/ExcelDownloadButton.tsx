"use client";

import { useRef, useState } from "react";

const FALLBACK_NAME = "hackathon-leaderboard.xlsx";

/** Content-Disposition başlığından dosya adını çıkarır; okunamazsa sabit ada düşer. */
function filenameFrom(header: string | null): string {
  if (!header) return FALLBACK_NAME;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      /* bozuk encoding — aşağıdaki düz filename'e düş */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : FALLBACK_NAME;
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/**
 * Excel export'u <a href> ile değil fetch ile indirir. Düz link'te tarayıcı
 * indirmeyi kendi yönetir ve JS "bitti"yi hiç öğrenemez; blob'a çekince
 * spinner'ı yanıt gelene kadar gösterip tam da inerken durdurabiliyoruz.
 * Route her takım için ayrı sorgu attığından yanıt saniyeler sürebiliyor.
 */
export function ExcelDownloadButton({
  variant = "button",
}: {
  variant?: "button" | "nav";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // setLoading asenkron: aynı tick'te gelen ikinci tıklama `loading`'i hâlâ
  // false görür ve ikinci bir indirme başlatır. Ref senkron yazıldığı için
  // gerçek kilit bu; disabled yalnız React yeniden render ettikten sonra tutar.
  const inFlight = useRef(false);

  async function download() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    let objectUrl: string | null = null;
    try {
      const res = await fetch("/api/export.xlsx");
      if (!res.ok) {
        setError(`Excel üretilemedi (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filenameFrom(res.headers.get("Content-Disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (objectUrl) {
        // Tarayıcı indirmeyi kuyruğa alana kadar URL yaşamalı.
        const url = objectUrl;
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      inFlight.current = false;
      setLoading(false);
    }
  }

  const className =
    variant === "nav"
      ? "inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 disabled:cursor-wait disabled:opacity-70"
      : "inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700 disabled:cursor-wait disabled:opacity-70";

  const idleLabel = variant === "nav" ? "Excel" : "📊 Excel indir";

  const button = (
    <button
      type="button"
      onClick={download}
      disabled={loading}
      aria-busy={loading}
      title={error ?? undefined}
      className={className}
    >
      {loading ? (
        <>
          <Spinner />
          <span>Hazırlanıyor…</span>
        </>
      ) : (
        <span>{idleLabel}</span>
      )}
    </button>
  );

  // Header dar; orada hatayı tooltip olarak bırakıp düzeni bozmuyoruz.
  if (variant === "nav") return button;

  return (
    <div className="flex flex-col items-end gap-1">
      {button}
      {error && <span className="text-xs text-rose-700">{error}</span>}
      <span aria-live="polite" className="sr-only">
        {loading ? "Excel hazırlanıyor" : error ? `Hata: ${error}` : ""}
      </span>
    </div>
  );
}
