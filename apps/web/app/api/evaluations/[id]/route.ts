import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tek bir değerlendirmeyi kalıcı olarak siler.
 *
 * `criterion_scores` ve onların `ai_rationales` kayıtları şemadaki
 * `onDelete: "cascade"` zinciriyle kendiliğinden gider (schema.ts).
 * `eval_requests.evaluation_id` ise FK DEĞİL, düz bir text kolonu — o yüzden
 * silinen değerlendirmeye işaret eden kuyruk satırları elle boşaltılır, aksi
 * halde takım detay sayfası var olmayan bir evaluationId'yi göstermeye çalışır.
 *
 * Geri alınamaz. Koruma açıksa (EVALUATOR_REQUIRE_AUTH=1) Bearer token ister.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireToken(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  await db
    .update(schema.evalRequests)
    .set({ evaluationId: null })
    .where(eq(schema.evalRequests.evaluationId, id));

  const deleted = await db
    .delete(schema.evaluations)
    .where(eq(schema.evaluations.id, id))
    .returning({ id: schema.evaluations.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "evaluation not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: deleted[0].id });
}
