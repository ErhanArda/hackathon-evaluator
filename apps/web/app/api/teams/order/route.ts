import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/teams/order
// Body: { order: ["t01", "t05", ...] }  // new display order
// Sets display_order = index (0-based) for each id; ids not in array stay unchanged.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.order)) {
    return NextResponse.json({ error: "order array required" }, { status: 400 });
  }
  const ids: string[] = body.order;
  if (!ids.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "order must be array of string ids" }, { status: 400 });
  }
  // Reset to auto mode: empty array clears display_order on all teams.
  if (ids.length === 0) {
    await db.update(schema.teams).set({ displayOrder: null });
    return NextResponse.json({ ok: true, mode: "auto" });
  }
  // Apply order indices sequentially
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(schema.teams)
      .set({ displayOrder: i })
      .where(eq(schema.teams.id, ids[i]));
  }
  // Null out any team not in the supplied list (so they fall to the bottom in manual mode)
  if (ids.length > 0) {
    await db.execute(
      sql`UPDATE teams SET display_order = NULL WHERE id <> ALL(${ids})`
    );
  }
  return NextResponse.json({ ok: true, mode: "manual", count: ids.length });
}
