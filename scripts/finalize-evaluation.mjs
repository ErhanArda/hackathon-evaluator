#!/usr/bin/env node
// Deterministik script çıktısı + LLM agent JSON'larını birleştirip
// /api/evaluations'a POST eder, ardından request'i done işaretler.
//
// Neden script: bu birleştirmeyi orchestrator LLM'in elle yapması hem yavaştı
// (payload JSON'unu satır satır yazmak) hem kırılgandı — eksik kriter, max'ı
// aşan skor, mükerrer kriter ve bozuk JSON sessizce geçebiliyordu.
//
// Kullanım:
//   node scripts/finalize-evaluation.mjs \
//     --base https://... --team <teamId> --req <requestId> \
//     --det <det.json> --llm <clean-code.json> --llm <architecture.json> \
//     [--repo-path /tmp/.../repo] [--dry-run]
//
// --llm dosyaları agent'ın döndürdüğü JSON'dur: ya tek nesne ya dizi.
// Kod fence ile sarılmış olsa bile ayıklanır.

import { readFileSync } from "node:fs";

const RUBRIC = {
  "ai-evidence": 20,
  agentic: 20,
  docs: 14,
  readme: 14,
  "clean-code": 14,
  architecture: 14,
  tests: 4,
};
const TOTAL_MAX = Object.values(RUBRIC).reduce((a, b) => a + b, 0); // 100

function parseArgs(argv) {
  const out = { llm: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") { out.dryRun = true; continue; }
    const k = a.replace(/^--/, "");
    const v = argv[++i];
    if (k === "llm") out.llm.push(v);
    else out[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

/** Agent çıktısı kod fence veya çevresinde metinle gelebilir — JSON'u ayıkla. */
function extractJson(raw) {
  const text = raw.trim();
  try { return JSON.parse(text); } catch { /* devam */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* devam */ }
  }
  // ilk [ veya { ile son ] veya } arası
  for (const [open, close] of [["[", "]"], ["{", "}"]]) {
    const s = text.indexOf(open);
    const e = text.lastIndexOf(close);
    if (s !== -1 && e > s) {
      try { return JSON.parse(text.slice(s, e + 1)); } catch { /* devam */ }
    }
  }
  throw new Error("JSON ayıklanamadı");
}

const args = parseArgs(process.argv);
for (const req of ["base", "team", "det"]) {
  if (!args[req]) {
    console.error(`eksik argüman: --${req}`);
    process.exit(2);
  }
}

const det = JSON.parse(readFileSync(args.det, "utf8"));
const scores = [...(det.scores ?? [])];

for (const p of args.llm) {
  let parsed;
  try {
    parsed = extractJson(readFileSync(p, "utf8"));
  } catch (err) {
    console.error(`! ${p}: ${err.message} — bu kriter 0 puanla eklenecek`);
    continue;
  }
  for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
    if (item && typeof item.criterion === "string") scores.push(item);
  }
}

// ---- normalize + doğrula ----
const problems = [];
const seen = new Map();
const clean = [];

for (const s of scores) {
  const key = s.criterion;
  if (!(key in RUBRIC)) { problems.push(`bilinmeyen kriter atlandı: ${key}`); continue; }
  if (seen.has(key)) { problems.push(`mükerrer kriter atlandı: ${key}`); continue; }
  const max = RUBRIC[key];
  let score = Number(s.score);
  if (!Number.isFinite(score)) { problems.push(`${key}: skor sayı değil -> 0`); score = 0; }
  score = Math.max(0, Math.min(Math.round(score), max));
  if (Math.round(Number(s.score)) !== score) problems.push(`${key}: skor ${s.score} -> ${score} (0..${max} aralığına çekildi)`);
  let rationale = typeof s.rationale === "string" ? s.rationale.trim() : "";
  if (!rationale) { rationale = "Gerekçe üretilmedi."; problems.push(`${key}: rationale boş`); }
  let evidence = Array.isArray(s.evidence) ? s.evidence : [];
  if (args.repoPath) {
    // evidence path'lerini repo-göreli yap — jüri ekranında /tmp/... görünmesin
    const prefix = args.repoPath.replace(/\/+$/, "") + "/";
    evidence = evidence.map((e) => ({
      ...e,
      path: typeof e?.path === "string" && e.path.startsWith(prefix) ? e.path.slice(prefix.length) : e?.path,
    }));
  }
  seen.set(key, true);
  clean.push({ criterion: key, score, max, rationale, evidence });
}

// eksik kriterleri 0 ile doldur
for (const [key, max] of Object.entries(RUBRIC)) {
  if (seen.has(key)) continue;
  clean.push({ criterion: key, score: 0, max, rationale: "Agent yanıtı eksikti veya parse edilemedi.", evidence: [] });
  problems.push(`eksik kriter 0 ile dolduruldu: ${key}`);
}

// rubric sırasına diz
const order = Object.keys(RUBRIC);
clean.sort((a, b) => order.indexOf(a.criterion) - order.indexOf(b.criterion));

const total = clean.reduce((s, c) => s + c.score, 0);
const scan = det.securityScan ?? {};
let note = "deterministik script (5 kriter) + 2 LLM agent (developer+reviewer) · context7 MCP";
if (scan.detected) note += ` · ⚠ ${scan.count} prompt-injection örüntüsü`;
if (det.latePenalty?.applied) note += ` · ⏰ ${det.latePenalty.lateCommitCount} geç commit`;

const payload = {
  teamId: args.team,
  evaluator: "claude-code",
  modelNote: note,
  scores: clean,
  securityScan: scan,
  latePenalty: det.latePenalty ?? {},
};

for (const c of clean) console.log(`  ${c.criterion.padEnd(13)} ${String(c.score).padStart(2)}/${c.max}`);
console.log(`  ${"TOPLAM".padEnd(13)} ${total}/${TOTAL_MAX}`);
if (problems.length) {
  console.log("  düzeltmeler:");
  for (const p of problems) console.log(`    - ${p}`);
}

if (args.dryRun) {
  console.log("  --dry-run: POST edilmedi");
  process.exit(0);
}

const headers = { "Content-Type": "application/json" };
if (process.env.INGEST_TOKEN) headers.Authorization = `Bearer ${process.env.INGEST_TOKEN}`;

const base = args.base.replace(/\/+$/, "");
const res = await fetch(`${base}/api/evaluations`, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`POST /api/evaluations HTTP ${res.status}: ${JSON.stringify(body)}`);
  process.exit(1);
}
console.log(`  eval=${body.id} total=${body.totalScore}/${body.maxScore}`);

if (args.req) {
  const byCriterion = Object.fromEntries(clean.map((c) => [c.criterion, c.score]));
  const detTotal = (det.scores ?? []).reduce((s, c) => s + c.score, 0);
  const states = [
    ["script", detTotal],
    ["developer", byCriterion["clean-code"]],
    ["reviewer", byCriterion.architecture],
  ];
  await Promise.all(
    states.map(([agent, score]) =>
      fetch(`${base}/api/eval-requests/${args.req}/agent-state`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ agent, status: "done", score }),
      }).catch(() => {})
    )
  );
  // compare-and-swap: operatör iptal ettiyse (status=failed) diriltme
  const done = await fetch(`${base}/api/eval-requests/${args.req}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "done", evaluationId: body.id, expectFromStatus: "processing" }),
  });
  if (done.status === 409) console.log("  request 'processing' değil (iptal edilmiş?) — done işaretlenmedi");
  else console.log(`  request ${args.req} -> done`);
}
