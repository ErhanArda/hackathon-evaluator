import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  members: text("members").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const evaluations = pgTable("evaluations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  totalScore: integer("total_score").notNull(),
  maxScore: integer("max_score").notNull().default(30),
  evaluator: text("evaluator").notNull(),
  modelNote: text("model_note"),
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

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type CriterionScore = typeof criterionScores.$inferSelect;
export type AiRationale = typeof aiRationales.$inferSelect;
