import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireToken(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  await db.delete(schema.teams).where(eq(schema.teams.id, id));
  return NextResponse.json({ ok: true });
}
