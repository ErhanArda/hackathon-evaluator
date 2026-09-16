import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { CRITERIA, TOTAL_MAX } from "@/lib/criteria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Eksiksiz ilişkisel dump — bir hackathon'u arşivleyip veritabanını yeni
 * hackathon için sıfırlamak içindir.
 *
 * /api/export.xlsx yeterli DEĞİL: yalnız her takımın SON değerlendirmesinin
 * gerekçelerini içerir, geçmiş değerlendirmelerin kriter puanları dışarı
 * çıkmaz. Bu endpoint beş tablonun tamamını verir.
 *
 * Salt okuma ve token istemez: içindeki her şey zaten public endpoint'lerden
 * erişilebilir (takımlar + üyeler /api/teams'de, değerlendirmeler
 * /api/evaluations'da, kriter puanları ve gerekçeler /teams/<id> sayfalarında).
 * Bu endpoint yalnız hepsini tek dosyada topluyor.
 */
export async function GET() {
  const [teams, evaluations, criterionScores, aiRationales, evalRequests] = await Promise.all([
    db.select().from(schema.teams),
    db.select().from(schema.evaluations),
    db.select().from(schema.criterionScores),
    db.select().from(schema.aiRationales),
    db.select().from(schema.evalRequests),
  ]);

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      rubric: { criteria: CRITERIA, totalMax: TOTAL_MAX },
      counts: {
        teams: teams.length,
        evaluations: evaluations.length,
        criterionScores: criterionScores.length,
        aiRationales: aiRationales.length,
        evalRequests: evalRequests.length,
      },
      tables: { teams, evaluations, criterionScores, aiRationales, evalRequests },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="hackathon-full-export.json"`,
      },
    }
  );
}
