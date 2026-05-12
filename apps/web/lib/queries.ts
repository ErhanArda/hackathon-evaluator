import { db, schema } from "./db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { CRITERIA, TOTAL_MAX } from "./criteria";

export type LeaderRow = {
  team: typeof schema.teams.$inferSelect;
  evaluation: typeof schema.evaluations.$inferSelect | null;
  scoresByCriterion: Record<string, number>;
  totalScore: number | null;
  maxScore: number;
};

export async function getLeaderboard(): Promise<LeaderRow[]> {
  const teams = await db.select().from(schema.teams).orderBy(schema.teams.name);
  if (teams.length === 0) return [];

  // Fetch all evaluations, dedupe latest per team in JS (avoids raw SQL snake_case mismatch)
  const allEvals = await db
    .select()
    .from(schema.evaluations)
    .orderBy(desc(schema.evaluations.createdAt));
  const latestByTeam = new Map<string, typeof schema.evaluations.$inferSelect>();
  for (const ev of allEvals) {
    if (!latestByTeam.has(ev.teamId)) latestByTeam.set(ev.teamId, ev);
  }

  const evalIds = Array.from(latestByTeam.values()).map((e) => e.id);
  let scores: (typeof schema.criterionScores.$inferSelect)[] = [];
  if (evalIds.length > 0) {
    scores = await db
      .select()
      .from(schema.criterionScores)
      .where(inArray(schema.criterionScores.evaluationId, evalIds));
  }
  const scoresByEval = new Map<string, Record<string, number>>();
  for (const s of scores) {
    const m = scoresByEval.get(s.evaluationId) ?? {};
    m[s.criterion] = s.score;
    scoresByEval.set(s.evaluationId, m);
  }

  const rows: LeaderRow[] = teams.map((t) => {
    const ev = latestByTeam.get(t.id) ?? null;
    return {
      team: t,
      evaluation: ev,
      scoresByCriterion: ev ? scoresByEval.get(ev.id) ?? {} : {},
      totalScore: ev ? ev.totalScore : null,
      maxScore: ev?.maxScore ?? TOTAL_MAX,
    };
  });

  // Sort: if any team has displayOrder, manual mode (asc nulls last);
  // otherwise auto mode (by totalScore desc).
  const hasManual = teams.some((t) => t.displayOrder != null);
  if (hasManual) {
    rows.sort((a, b) => {
      const ao = a.team.displayOrder;
      const bo = b.team.displayOrder;
      if (ao == null && bo == null) return 0;
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo;
    });
  } else {
    rows.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1));
  }
  return rows;
}

export async function getTeamDetail(teamId: string) {
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
  if (!team) return null;

  const evals = await db
    .select()
    .from(schema.evaluations)
    .where(eq(schema.evaluations.teamId, teamId))
    .orderBy(desc(schema.evaluations.createdAt));

  const evalIds = evals.map((e) => e.id);
  const scores = evalIds.length
    ? await db
        .select()
        .from(schema.criterionScores)
        .where(inArray(schema.criterionScores.evaluationId, evalIds))
    : [];

  const scoreIds = scores.map((s) => s.id);
  const rationales = scoreIds.length
    ? await db
        .select()
        .from(schema.aiRationales)
        .where(inArray(schema.aiRationales.criterionScoreId, scoreIds))
    : [];

  const rationaleByScore = new Map(rationales.map((r) => [r.criterionScoreId, r]));
  const scoresByEval = new Map<string, (typeof schema.criterionScores.$inferSelect & { rationale?: typeof schema.aiRationales.$inferSelect })[]>();
  for (const s of scores) {
    const arr = scoresByEval.get(s.evaluationId) ?? [];
    arr.push({ ...s, rationale: rationaleByScore.get(s.id) });
    scoresByEval.set(s.evaluationId, arr);
  }

  return {
    team,
    evaluations: evals.map((e) => ({
      ...e,
      scores: (scoresByEval.get(e.id) ?? []).sort(
        (a, b) => CRITERIA.findIndex((c) => c.key === a.criterion) - CRITERIA.findIndex((c) => c.key === b.criterion)
      ),
    })),
  };
}
