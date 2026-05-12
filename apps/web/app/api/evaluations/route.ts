import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkBearer } from "@/lib/auth";
import { CRITERIA, TOTAL_MAX } from "@/lib/criteria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingScore = {
  criterion: string;
  score: number;
  max: number;
  rationale: string;
  evidence?: unknown;
};

type IncomingBody = {
  teamId: string;
  evaluator?: string;
  modelNote?: string;
  scores: IncomingScore[];
};

export async function GET() {
  const rows = await db
    .select()
    .from(schema.evaluations)
    .orderBy(desc(schema.evaluations.createdAt))
    .limit(200);
  return NextResponse.json({ evaluations: rows });
}

export async function POST(req: NextRequest) {
  if (!checkBearer(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as IncomingBody | null;
  if (!body || typeof body.teamId !== "string" || !Array.isArray(body.scores)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const validKeys = new Set(CRITERIA.map((c) => c.key));
  for (const s of body.scores) {
    if (!validKeys.has(s.criterion as never)) {
      return NextResponse.json({ error: `unknown criterion: ${s.criterion}` }, { status: 400 });
    }
    if (typeof s.score !== "number" || typeof s.max !== "number" || typeof s.rationale !== "string") {
      return NextResponse.json({ error: "score/max/rationale required per item" }, { status: 400 });
    }
  }
  const total = body.scores.reduce((sum, s) => sum + s.score, 0);

  const evalId = nanoid(12);
  await db.insert(schema.evaluations).values({
    id: evalId,
    teamId: body.teamId,
    totalScore: total,
    maxScore: TOTAL_MAX,
    evaluator: body.evaluator ?? "claude-code",
    modelNote: body.modelNote ?? null,
  });

  for (const s of body.scores) {
    const csId = nanoid(12);
    await db.insert(schema.criterionScores).values({
      id: csId,
      evaluationId: evalId,
      criterion: s.criterion,
      score: s.score,
      max: s.max,
    });
    await db.insert(schema.aiRationales).values({
      id: nanoid(12),
      criterionScoreId: csId,
      rationale: s.rationale,
      evidence: s.evidence ?? null,
    });
  }

  return NextResponse.json({ id: evalId, totalScore: total, maxScore: TOTAL_MAX }, { status: 201 });
}
