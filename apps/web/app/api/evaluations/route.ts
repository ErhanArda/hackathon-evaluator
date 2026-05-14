import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
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

type SecurityScan = {
  detected?: boolean;
  count?: number;
  hits?: Array<{ path: string; line: number; excerpt: string; pattern?: string }>;
  note?: string;
};

type LatePenalty = {
  applied?: boolean;
  points?: number;
  cutoff?: string;
  lateCommit?: { hash?: string; when?: string } | null;
};

type IncomingBody = {
  teamId: string;
  evaluator?: string;
  modelNote?: string;
  scores: IncomingScore[];
  securityScan?: SecurityScan;
  latePenalty?: LatePenalty;
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
  const rawTotal = body.scores.reduce((sum, s) => sum + s.score, 0);
  const penaltyPoints = body.latePenalty?.applied ? (body.latePenalty.points ?? 0) : 0;
  const total = rawTotal; // penalty skoru düşürmez, max'ı düşürür

  const evalId = nanoid(12);
  await db.insert(schema.evaluations).values({
    id: evalId,
    teamId: body.teamId,
    totalScore: total,
    maxScore: TOTAL_MAX - penaltyPoints, // late penalty max'ı düşürür (100→95)
    evaluator: body.evaluator ?? "claude-code",
    modelNote: body.modelNote ?? null,
    securityScan: body.securityScan ?? null,
    latePenalty: penaltyPoints,
    latePenaltyDetail: body.latePenalty ?? null,
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

  return NextResponse.json({ id: evalId, totalScore: total, maxScore: TOTAL_MAX - penaltyPoints }, { status: 201 });
}
