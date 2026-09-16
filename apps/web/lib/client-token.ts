"use client";

// Operatör token'ı tarayıcıda tutulur (localStorage) ve yazma isteklerine
// Authorization başlığı olarak eklenir. Sadece bu cihazda kalır, sunucuya
// yalnızca istek başlığında gider.
const KEY = "evaluator-ingest-token";

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(value: string): void {
  try {
    const v = value.trim();
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mod / site verisi kapalı — sessizce geç */
  }
}

/** Yazma isteklerinin başlıkları. json=false ise Content-Type eklenmez (gövdesiz DELETE). */
export function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

/** 401/503 için operatöre ne yapacağını söyleyen mesaj. Diğer durumlarda null. */
export function authMessage(status: number): string | null {
  if (status === 401)
    return "Token geçersiz veya girilmedi — /admin sayfasının en üstündeki alana operatör token'ını gir.";
  if (status === 503)
    return "Sunucuda INGEST_TOKEN tanımlı değil — Vercel ortam değişkenlerini kontrol et.";
  return null;
}
