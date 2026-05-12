import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db
    .select()
    .from(schema.evalRequests)
    .where(eq(schema.evalRequests.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ request: row });
}

type PatchBody = {
  status?: "pending" | "processing" | "done" | "failed";
  evaluationId?: string | null;
  errorMsg?: string | null;
  // when set, atomic compare-and-swap: only update if current status === expectFromStatus
  expectFromStatus?: "pending" | "processing" | "done" | "failed";
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const updates: Partial<typeof schema.evalRequests.$inferInsert> = {};
  if (body.status) {
    updates.status = body.status;
    if (body.status === "processing") updates.startedAt = new Date();
    if (body.status === "done" || body.status === "failed") updates.completedAt = new Date();
  }
  if (body.evaluationId !== undefined) updates.evaluationId = body.evaluationId;
  if (body.errorMsg !== undefined) updates.errorMsg = body.errorMsg;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const where = body.expectFromStatus
    ? and(
        eq(schema.evalRequests.id, id),
        eq(schema.evalRequests.status, body.expectFromStatus)
      )
    : eq(schema.evalRequests.id, id);

  const updated = await db
    .update(schema.evalRequests)
    .set(updates)
    .where(where)
    .returning();

  if (updated.length === 0) {
    // either not found, or compare-and-swap mismatch
    return NextResponse.json({ error: "not found or status mismatch", updated: false }, { status: 409 });
  }
  return NextResponse.json({ request: updated[0], updated: true });
}
