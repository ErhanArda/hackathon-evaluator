import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // 'pending' | 'processing' | 'done' | 'failed' | 'active'
  const teamId = searchParams.get("teamId");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const conditions = [];
  if (status === "active") {
    conditions.push(inArray(schema.evalRequests.status, ["pending", "processing"]));
  } else if (status) {
    conditions.push(eq(schema.evalRequests.status, status));
  }
  if (teamId) conditions.push(eq(schema.evalRequests.teamId, teamId));

  const rows = await db
    .select()
    .from(schema.evalRequests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.evalRequests.requestedAt))
    .limit(limit);
  return NextResponse.json({ requests: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.teamId !== "string") {
    return NextResponse.json({ error: "teamId required" }, { status: 400 });
  }

  // Verify team exists
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, body.teamId));
  if (!team) {
    return NextResponse.json({ error: "team not found" }, { status: 404 });
  }

  // Avoid duplicate pending/processing requests for the same team
  const existing = await db
    .select()
    .from(schema.evalRequests)
    .where(
      and(
        eq(schema.evalRequests.teamId, body.teamId),
        eq(schema.evalRequests.status, "pending")
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ request: existing[0], deduplicated: true }, { status: 200 });
  }

  const id = `req_${nanoid(10)}`;
  const [created] = await db
    .insert(schema.evalRequests)
    .values({ id, teamId: body.teamId, status: "pending" })
    .returning();
  return NextResponse.json({ request: created }, { status: 201 });
}
