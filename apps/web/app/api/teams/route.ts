import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const teams = await db.select().from(schema.teams).orderBy(schema.teams.name);
  return NextResponse.json({ teams });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || typeof body.repoUrl !== "string") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const id = body.id ?? nanoid(10);
  const [created] = await db
    .insert(schema.teams)
    .values({
      id,
      name: body.name,
      repoUrl: body.repoUrl,
      members: Array.isArray(body.members) ? body.members : null,
    })
    .onConflictDoUpdate({
      target: schema.teams.id,
      set: { name: body.name, repoUrl: body.repoUrl, members: Array.isArray(body.members) ? body.members : null },
    })
    .returning();
  return NextResponse.json({ team: created }, { status: 201 });
}
