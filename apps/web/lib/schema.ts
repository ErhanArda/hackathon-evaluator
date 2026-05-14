import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  members: text("members").array(),
  displayOrder: integer("display_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const evaluations = pgTable("evaluations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  totalScore: integer("total_score").notNull(),
  maxScore: integer("max_score").notNull().default(100),
  evaluator: text("evaluator").notNull(),
  modelNote: text("model_note"),
  // {detected: bool, count: int, hits: [{path,line,excerpt,pattern}], note: string}
  securityScan: jsonb("security_scan"),
  // Geç commit cezası ham puanı (örn. 5 → totalScore'dan düşülmüş)
  latePenalty: integer("late_penalty").default(0),
  // {applied,points,cutoff,lateCommit:{hash,when}} — geç commit detayı
  latePenaltyDetail: jsonb("late_penalty_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const criterionScores = pgTable("criterion_scores", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  criterion: text("criterion").notNull(),
  score: integer("score").notNull(),
  max: integer("max").notNull(),
});

export const aiRationales = pgTable("ai_rationales", {
  id: text("id").primaryKey(),
  criterionScoreId: text("criterion_score_id").notNull().references(() => criterionScores.id, { onDelete: "cascade" }),
  rationale: text("rationale").notNull(),
  evidence: jsonb("evidence"),
});

export const evalRequests = pgTable("eval_requests", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | processing | done | failed
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  evaluationId: text("evaluation_id"),
  errorMsg: text("error_msg"),
  // per-agent live state: { analist: {status, startedAt, completedAt}, developer: ..., reviewer: ..., 'ai-evidence': ..., tester: ... }
  agentStates: jsonb("agent_states"),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type CriterionScore = typeof criterionScores.$inferSelect;
export type AiRationale = typeof aiRationales.$inferSelect;
export type EvalRequest = typeof evalRequests.$inferSelect;
