import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Yazma yapan her route handler'ının ilk satırı.
 * Dönen değer null ise istek yetkili; NextResponse ise handler onu döndürmeli.
 *
 * Fail-closed: INGEST_TOKEN tanımlı değilse hiçbir yazma kabul edilmez.
 * Aksi halde env'i unutmak, endpoint'i sessizce herkese açık bırakırdı.
 */
export function requireToken(req: NextRequest): NextResponse | null {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "INGEST_TOKEN sunucuda tanımlı değil — yazma endpoint'leri kapalı. Vercel > Settings > Environment Variables'a ekleyip yeniden deploy et.",
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
