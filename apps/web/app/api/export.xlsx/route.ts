import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getLeaderboard, getTeamDetail } from "@/lib/queries";
import { CRITERIA, labelFor } from "@/lib/criteria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await getLeaderboard();

  const wb = new ExcelJS.Workbook();
  wb.creator = "Hackathon Repo Evaluator";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Leaderboard");
  sheet.columns = [
    { header: "Sıra", key: "rank", width: 6 },
    { header: "Takım", key: "name", width: 24 },
    { header: "Repo", key: "repo", width: 38 },
    { header: "Toplam", key: "total", width: 10 },
    { header: "Max", key: "max", width: 8 },
    { header: "100 üzerinden", key: "norm", width: 14 },
    ...CRITERIA.map((c) => ({ header: c.label, key: c.key, width: 24 })),
  ];
  sheet.getRow(1).font = { bold: true };

  rows.forEach((row, i) => {
    const r: Record<string, string | number> = {
      rank: i + 1,
      name: row.team.name,
      repo: row.team.repoUrl,
      total: row.totalScore ?? "—",
      max: row.maxScore,
      norm: row.totalScore != null ? Math.round((row.totalScore * 100) / row.maxScore) : "—",
    };
    for (const c of CRITERIA) {
      r[c.key] = row.scoresByCriterion[c.key] ?? "—";
    }
    sheet.addRow(r);
  });

  const rationalesSheet = wb.addWorksheet("Rationale");
  rationalesSheet.columns = [
    { header: "Takım", key: "team", width: 22 },
    { header: "Kriter", key: "criterion", width: 22 },
    { header: "Puan", key: "score", width: 8 },
    { header: "AI Gerekçesi", key: "rationale", width: 80 },
    { header: "Evidence", key: "evidence", width: 60 },
  ];
  rationalesSheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    if (!row.evaluation) continue;
    const detail = await getTeamDetail(row.team.id);
    const latest = detail?.evaluations[0];
    if (!latest) continue;
    for (const s of latest.scores) {
      rationalesSheet.addRow({
        team: row.team.name,
        criterion: labelFor(s.criterion),
        score: `${s.score}/${s.max}`,
        rationale: s.rationale?.rationale ?? "",
        evidence: s.rationale?.evidence ? JSON.stringify(s.rationale.evidence) : "",
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const filename = `hackathon-leaderboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
