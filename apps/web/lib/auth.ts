import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Yazma yapan route handler'larının ilk satırı.
 * null dönerse istek geçer; NextResponse dönerse handler onu döndürmeli.
 *
 * VARSAYILAN: KAPALI — yazma endpoint'leri açıktır, hiçbir token gerekmez.
 * Bu, güvenilir bir iç ortamda (tek operatör, kurum ağı) kasıtlı tercihtir;
 * terminalden `/evaluate` ve `/process-queue` hiçbir kurulum olmadan çalışır.
 *
 * KORUMAYI AÇMAK: Vercel'de `EVALUATOR_REQUIRE_AUTH=1` ve `INGEST_TOKEN=<sır>`
 * tanımla. O anda tüm yazma endpoint'leri `Authorization: Bearer <INGEST_TOKEN>`
 * ister; okuma endpoint'leri her iki durumda da public kalır.
 *
 * Anahtar `INGEST_TOKEN`'ın kendisi DEĞİL, ayrı bir flag: token zaten
 * ortamda tanımlı olabilir (post-evaluation.sh onu gönderiyor) ve yalnız
 * varlığı yüzünden kimsenin kilitlenmemesi gerekir.
 */
export function requireToken(req: NextRequest): NextResponse | null {
  const enabled = /^(1|true|yes|on)$/i.test(process.env.EVALUATOR_REQUIRE_AUTH ?? "");
  if (!enabled) return null;

  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "EVALUATOR_REQUIRE_AUTH açık ama INGEST_TOKEN tanımlı değil — yazma endpoint'leri kapalı. Token'ı ekle ya da flag'i kaldır.",
      },
      { status: 503 }
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  const supplied = match?.[1]?.trim() ?? "";

  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return NextResponse.json(
      { error: "unauthorized — geçerli bir 'Authorization: Bearer <INGEST_TOKEN>' başlığı gerekli" },
      { status: 401 }
    );
  }
  return null;
}
