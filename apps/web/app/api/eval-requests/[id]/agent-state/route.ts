import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/eval-requests/:id/agent-state
// Body: { agent: "analist", status: "running" | "done" | "failed", score?: number, note?: string }
// Atomically merges into agent_states JSONB without overwriting other agents.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.agent !== "string" || typeof body.status !== "string") {
    return NextResponse.json({ error: "agent + status required" }, { status: 400 });
  }
  const agent = body.agent;
  const stateUpdate: Record<string, unknown> = { status: body.status };
  if (body.status === "running") stateUpdate.startedAt = new Date().toISOString();
  if (body.status === "done" || body.status === "failed") stateUpdate.completedAt = new Date().toISOString();
  if (typeof body.score === "number") stateUpdate.score = body.score;
  if (typeof body.note === "string") stateUpdate.note = body.note;

  // jsonb_set with COALESCE so we can initialize an empty object
  const json = JSON.stringify(stateUpdate);
  await db.execute(sql`
    UPDATE eval_requests
    SET agent_states = jsonb_set(
      COALESCE(agent_states, '{}'::jsonb),
      ARRAY[${agent}],
      ${json}::jsonb,
      true
    )
    WHERE id = ${id}
  `);

  return NextResponse.json({ ok: true, agent, state: stateUpdate });
}
