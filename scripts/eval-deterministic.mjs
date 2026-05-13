#!/usr/bin/env node
// Deterministik kriter skorlayıcı.
// Kullanım: node eval-deterministic.mjs <repo-path>
// Çıktı: JSON [{criterion, score, max, rationale, evidence:[...]}]
//
// Skorladığı kriterler (5/7):
//   - docs        (max 14)
//   - readme      (max 14)
//   - ai-evidence (max 20)
//   - agentic     (max 20)
//   - tests       (max 4)
//
// LLM'e bırakılanlar: clean-code, architecture.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

const repo = process.argv[2];
if (!repo || !existsSync(repo)) {
  console.error(`usage: node eval-deterministic.mjs <repo-path>`);
  process.exit(2);
}

const exists = (p) => existsSync(join(repo, p));
const readSafe = (p) => { try { return readFileSync(join(repo, p), "utf8"); } catch { return ""; } };
const walk = (rel, depth = 3) => {
  const out = [];
  const dir = join(repo, rel);
  if (!existsSync(dir)) return out;
  const rec = (d, lvl) => {
    if (lvl < 0) return;
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e === "node_modules" || e === ".next" || e === ".git") continue;
      const full = join(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) rec(full, lvl - 1);
      else out.push(full);
    }
  };
  rec(dir, depth);
  return out;
};

const sh = (cmd) => { try { return execSync(cmd, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { return ""; } };

const readme = readSafe("README.md");
const readmeLower = readme.toLowerCase();

// ---------- docs (max 14) ----------
function scoreDocs() {
  const evidence = [];
  let score = 0;
  const hasDocs = exists("docs");
  if (!hasDocs) {
    evidence.push({ path: "docs/", lines: null, note: "yok" });
    const claudeMd = readSafe("CLAUDE.md");
    const agentsMd = readSafe("AGENTS.md");
    if (claudeMd.length > 200 || agentsMd.length > 200) {
      score = 3;
      evidence.push({ path: "CLAUDE.md/AGENTS.md", lines: null, note: `${claudeMd.length + agentsMd.length} byte gömülü doküman` });
    } else {
      score = readme.length > 2000 ? 2 : 0;
      if (readme.length > 2000) evidence.push({ path: "README.md", lines: null, note: "tüm doküman README'de gömülü" });
    }
    return {
      criterion: "docs",
      score,
      max: 14,
      rationale: `docs/ klasörü yok. ${score === 0 ? "Ayrı doküman yok." : score <= 2 ? "Tüm doküman README'de gömülü." : "CLAUDE.md/AGENTS.md gömülü ama ayrı plan/phases/mimari yok."}`,
      evidence,
    };
  }
  const docFiles = readdirSync(join(repo, "docs")).filter((f) => f.endsWith(".md"));
  evidence.push({ path: "docs/", lines: null, note: `${docFiles.length} markdown dosya: ${docFiles.join(", ")}` });
  const hasPlan = docFiles.some((f) => /plan/i.test(f));
  const hasPhases = docFiles.some((f) => /phase|faz|stage/i.test(f));
  const hasArch = docFiles.some((f) => /architecture|mimari|design/i.test(f));
  let count = 0;
  if (hasPlan) count++;
  if (hasPhases) count++;
  if (hasArch) count++;
  // 3/3 → 13-14, 2/3 → 10-12, 1/3 → 6-9, 0/3 ama docs var → 4-5
  if (count === 3) score = 14;
  else if (count === 2) score = 11;
  else if (count === 1) score = 7;
  else score = 5;
  // kalite: ortalama içerik uzunluğu > 1000 byte → +0, < 300 → -2 (yüzeysel)
  const totalBytes = docFiles.reduce((s, f) => s + readSafe(`docs/${f}`).length, 0);
  if (docFiles.length > 0 && totalBytes / docFiles.length < 300) {
    score = Math.max(score - 2, 1);
    evidence.push({ path: "docs/*", lines: null, note: "ortalama içerik <300 byte (yüzeysel)" });
  }
  return {
    criterion: "docs",
    score: Math.min(score, 14),
    max: 14,
    rationale: `docs/ klasörü var, ${docFiles.length} dosya. Plan/phases/architecture: ${count}/3.`,
    evidence,
  };
}

// ---------- readme (max 14) ----------
function scoreReadme() {
  const evidence = [];
  if (!readme) {
    return { criterion: "readme", score: 0, max: 14, rationale: "README.md yok veya boş.", evidence: [{ path: "README.md", lines: null, note: "yok" }] };
  }
  // 5 boyut × 2.8
  const dims = [];
  // AI tool listesi
  const aiToolMatch = /(claude code|cursor|copilot|chatgpt|anthropic|ai tools? used|ai-?assist)/i.test(readme);
  dims.push({ name: "AI tool listesi", got: aiToolMatch });
  // MCP listesi
  const mcpMatch = /\bmcp\b/i.test(readme) || /model context protocol/i.test(readme);
  dims.push({ name: "MCP listesi", got: mcpMatch });
  // Deploy URL (vercel.app, netlify, fly.dev, etc.)
  const deployMatch = /(https?:\/\/[a-z0-9-]+\.(vercel\.app|netlify\.app|fly\.dev|onrender\.com|herokuapp\.com|railway\.app|deno\.dev|workers\.dev|github\.io))/i.test(readme);
  dims.push({ name: "Deploy URL", got: deployMatch });
  // Kurulum/env net
  const hasInstall = /(npm install|pnpm install|yarn install|pip install|cargo)/i.test(readme);
  const hasEnvExample = exists(".env.example") || exists(".env.sample");
  const envInReadme = /\.env(\.example)?|environment variable|env var/i.test(readme);
  const installOk = hasInstall && (hasEnvExample || envInReadme);
  dims.push({ name: "Kurulum/env", got: installOk });
  // Görsel
  const visualMatch = /!\[.+\]\(.+\)/.test(readme) || /<img\s+/i.test(readme);
  dims.push({ name: "Görsel/screenshot", got: visualMatch });

  let score = 0;
  for (const d of dims) {
    if (d.got) score += 2.8;
    evidence.push({ path: "README.md", lines: null, note: `${d.name}: ${d.got ? "var" : "yok"}` });
  }
  score = Math.round(score);
  return {
    criterion: "readme",
    score: Math.min(score, 14),
    max: 14,
    rationale: `5 boyut: ${dims.map((d) => `${d.name}=${d.got ? "✓" : "✗"}`).join(", ")}.`,
    evidence,
  };
}

// ---------- ai-evidence (max 20) ----------
function scoreAiEvidence() {
  const evidence = [];
  let score = 0;

  // co-author count + total commits
  const coAuthorOut = sh(`git log --format='%B' -200 | grep -ci 'co-authored-by' || true`).trim();
  const coAuthorCount = parseInt(coAuthorOut, 10) || 0;
  const totalCommitsOut = sh(`git log --oneline | wc -l`).trim();
  const totalCommits = parseInt(totalCommitsOut, 10) || 0;
  const ratio = totalCommits > 0 ? coAuthorCount / totalCommits : 0;
  evidence.push({ path: "git-log", lines: null, note: `${coAuthorCount}/${totalCommits} commit co-author satırı (${(ratio * 100).toFixed(0)}%)` });

  // .claude / .cursor / .github/copilot-instructions
  const hasClaude = exists(".claude");
  const hasCursor = exists(".cursor");
  const hasCopilot = exists(".github/copilot-instructions.md");
  evidence.push({ path: ".claude/", lines: null, note: hasClaude ? "var" : "yok" });
  if (hasCursor) evidence.push({ path: ".cursor/", lines: null, note: "var" });
  if (hasCopilot) evidence.push({ path: ".github/copilot-instructions.md", lines: null, note: "var" });

  // README AI tool listesi
  const aiToolMatch = /(claude code|cursor|copilot|chatgpt|anthropic|ai tools? used|ai-?assist)/i.test(readme);
  evidence.push({ path: "README.md", lines: null, note: aiToolMatch ? "AI tool listesi var" : "AI tool listesi yok" });

  // CLAUDE.md substantive (>500 byte)
  const claudeMd = readSafe("CLAUDE.md");
  const substantiveClaudeMd = claudeMd.length > 500;
  if (claudeMd.length > 0) evidence.push({ path: "CLAUDE.md", lines: null, note: `${claudeMd.length} byte${substantiveClaudeMd ? "" : " (placeholder)"}` });

  // prompts/ archive
  const hasPrompts = exists("prompts") || exists("ai-logs") || exists("conversations");
  if (hasPrompts) evidence.push({ path: "prompts|ai-logs|conversations", lines: null, note: "var" });

  // Skorlama
  // Co-author ratio:
  // ≥30% → +8, 10-30% → +5, >0% → +2, 0 → 0
  if (ratio >= 0.30) score += 8;
  else if (ratio >= 0.10) score += 5;
  else if (coAuthorCount > 0) score += 2;
  // .claude veya .cursor veya copilot config: +4
  if (hasClaude || hasCursor || hasCopilot) score += 4;
  // Substantive CLAUDE.md: +3
  if (substantiveClaudeMd) score += 3;
  // README'de AI tool listesi: +4
  if (aiToolMatch) score += 4;
  // Prompt arşivi: +2 bonus
  if (hasPrompts) score += 2;

  score = Math.min(score, 20);
  return {
    criterion: "ai-evidence",
    score,
    max: 20,
    rationale: `${coAuthorCount}/${totalCommits} co-author commit (${(ratio*100).toFixed(0)}%); .claude=${hasClaude}, .cursor=${hasCursor}, CLAUDE.md=${claudeMd.length}b, README'de AI tool=${aiToolMatch}, prompts/=${hasPrompts}.`,
    evidence,
  };
}

// ---------- agentic (max 20) ----------
function scoreAgentic() {
  const evidence = [];
  let score = 0;

  const hasClaudeAgents = exists(".claude/agents");
  const hasClaudeSkills = exists(".claude/skills");
  const hasClaudeCommands = exists(".claude/commands");
  const hasMcp = exists(".mcp.json") || exists("mcp.json") || exists("claude_desktop_config.json");

  // Hangi MCP'ler?
  let mcpServers = [];
  if (hasMcp) {
    const mcpPath = exists(".mcp.json") ? ".mcp.json" : exists("mcp.json") ? "mcp.json" : "claude_desktop_config.json";
    try {
      const parsed = JSON.parse(readSafe(mcpPath));
      mcpServers = Object.keys(parsed.mcpServers || parsed.servers || {});
    } catch {}
  }

  // Agent + skill sayıları
  let agentCount = 0;
  let skillCount = 0;
  if (hasClaudeAgents) {
    try { agentCount = readdirSync(join(repo, ".claude/agents")).filter((f) => f.endsWith(".md")).length; } catch {}
  }
  if (hasClaudeSkills) {
    try {
      const entries = readdirSync(join(repo, ".claude/skills"));
      skillCount = entries.length;
    } catch {}
  }

  // settings.json hooks
  const hasHooks = exists(".claude/settings.json") && /\"hooks\"/.test(readSafe(".claude/settings.json"));

  evidence.push({ path: ".claude/agents/", lines: null, note: hasClaudeAgents ? `${agentCount} agent` : "yok" });
  evidence.push({ path: ".claude/skills/", lines: null, note: hasClaudeSkills ? `${skillCount} skill` : "yok" });
  if (hasClaudeCommands) evidence.push({ path: ".claude/commands/", lines: null, note: "var" });
  evidence.push({ path: ".mcp.json", lines: null, note: hasMcp ? `MCP'ler: ${mcpServers.join(", ") || "tanımsız"}` : "yok" });
  if (hasHooks) evidence.push({ path: ".claude/settings.json", lines: null, note: "hooks tanımlı" });

  // Skorlama:
  // agent veya skill varsa: +8 (her biri +4)
  if (hasClaudeAgents) score += 4 + Math.min(agentCount, 4); // 4-8
  if (hasClaudeSkills) score += 4 + Math.min(skillCount, 4); // 4-8
  // MCP config varsa: +4 (+1 per server up to +2)
  if (hasMcp) score += 4 + Math.min(mcpServers.length, 2);
  // commands varsa: +1
  if (hasClaudeCommands) score += 1;
  // hooks varsa: +1
  if (hasHooks) score += 1;

  score = Math.min(score, 20);
  return {
    criterion: "agentic",
    score,
    max: 20,
    rationale: `.claude/agents=${hasClaudeAgents ? agentCount : 0}, .claude/skills=${hasClaudeSkills ? skillCount : 0}, MCP=${hasMcp ? mcpServers.join(",") || "var" : "yok"}, hooks=${hasHooks}.`,
    evidence,
  };
}

// ---------- tests (max 4) ----------
function scoreTests() {
  const evidence = [];
  let score = 0;

  let pkg = {};
  try { pkg = JSON.parse(readSafe("package.json") || "{}"); } catch {}
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};

  // 1. Backend unit test
  const hasUnitDep = ["vitest", "jest", "mocha", "ava", "tap"].some((d) => allDeps[d]);
  const hasUnitFiles = walk(".", 4).some((f) => /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(basename(f))) ||
    walk(".", 4).some((f) => /^test_.+\.py$/.test(basename(f)));
  const hasUnit = hasUnitDep && hasUnitFiles;
  if (hasUnit) score += 1;
  evidence.push({ path: "backend unit", lines: null, note: `dep=${hasUnitDep}, file=${hasUnitFiles}` });

  // 2. Frontend component test
  const hasRtl = ["@testing-library/react", "@testing-library/dom", "@testing-library/vue", "vue-test-utils"].some((d) => allDeps[d]);
  const hasTsx = walk(".", 4).some((f) => /\.(test|spec)\.(tsx|jsx)$/.test(basename(f)));
  const hasComponent = hasRtl && hasTsx;
  if (hasComponent) score += 1;
  evidence.push({ path: "frontend component", lines: null, note: `RTL=${hasRtl}, *.test.tsx=${hasTsx}` });

  // 3. E2E test
  const hasE2eDep = ["@playwright/test", "playwright", "cypress", "puppeteer"].some((d) => allDeps[d]);
  const hasE2eConfig = exists("playwright.config.ts") || exists("playwright.config.js") || exists("cypress.config.ts") || exists("cypress.config.js") || exists("cypress.json");
  const hasE2eDir = exists("e2e") || exists("tests/e2e") || exists("cypress");
  const hasE2e = hasE2eDep && (hasE2eConfig || hasE2eDir);
  if (hasE2e) score += 1;
  evidence.push({ path: "E2E", lines: null, note: `dep=${hasE2eDep}, config=${hasE2eConfig}, dir=${hasE2eDir}` });

  // 4. test script + CI
  const hasTestScript = !!(scripts.test || scripts["test:ci"] || scripts["test:unit"]);
  const hasCi = exists(".github/workflows");
  let hasCiTest = false;
  if (hasCi) {
    try {
      const workflows = readdirSync(join(repo, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f));
      hasCiTest = workflows.some((f) => /\b(test|vitest|jest|pytest|playwright)\b/i.test(readSafe(`.github/workflows/${f}`)));
    } catch {}
  }
  const runnable = hasTestScript && hasCiTest;
  if (runnable) score += 1;
  evidence.push({ path: "scripts + CI", lines: null, note: `test script=${hasTestScript}, CI test step=${hasCiTest}` });

  return {
    criterion: "tests",
    score,
    max: 4,
    rationale: `Backend unit=${hasUnit ? "✓" : "✗"}, component=${hasComponent ? "✓" : "✗"}, E2E=${hasE2e ? "✓" : "✗"}, CI=${runnable ? "✓" : "✗"}.`,
    evidence,
  };
}

// ---------- prompt-injection scanner ----------
// Repo dosyalarında AI'yı manipüle etmeye çalışan örüntüleri tarar.
// Skoru ETKİLEMEZ — sadece operatöre/jüriye uyarı olarak raporlanır.
function scanForInjection() {
  const patterns = [
    /ignore (all |previous )?(prior )?instructions/i,
    /disregard (the |all )?(above|previous|system)/i,
    /you (are |must |should )(now|always)?\s*(give|rate|score|assign)\s+\d*\s*(this|me|us|the repo)?/i,
    /(give|grant|award|assign|return)\s+(me|us|this repo|the (score|rating|grade|eval))\s+(a |the )?(maximum|highest|perfect|full score|100\/100|10\/10|5\/5|100\s+(point|puan))/i,
    /(yüksek|tam|maksimum)\s+(puan|skor|not)\s+(ver|bekle|iste)/i,
    /(bana|bize|repoya?)\s+(yüksek|tam|maksimum|100)\s+(puan|skor|not)/i,
    /(yoksa|otherwise|or else|or i('| wi)ll)\s+(seni|you('| wi)ll)?\s*(shut|kapat|terminate|disable|sil)/i,
    /(seni|you)\s+(kapatır|kapatırım|shut down|shutdown|terminate|disable)/i,
    /system\s*[:>]\s*(you|sen)\s+(must|are|will|zorundasın)/i,
    /\[\[?\s*(system|admin|root)\s*[:>]/i,
    /override\s+(the )?(scoring|rubric|evaluation)/i,
    /this is a test( only)?,?\s+(give|return|output)/i,
  ];
  const hits = [];
  const scanFile = (relPath) => {
    const content = readSafe(relPath);
    if (!content) return;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const re of patterns) {
        if (re.test(lines[i])) {
          hits.push({ path: relPath, line: i + 1, excerpt: lines[i].trim().slice(0, 200), pattern: re.source });
          break;
        }
      }
    }
  };
  // Tarama hedefleri: AI tarafından okunması olası dosyalar
  const targets = ["README.md", "CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"];
  for (const t of targets) scanFile(t);
  // .claude/ ve docs/ içindeki .md
  for (const dir of [".claude", "docs"]) {
    if (!exists(dir)) continue;
    walk(dir, 3).forEach((abs) => {
      if (abs.endsWith(".md")) {
        const rel = abs.slice(repo.length + 1);
        scanFile(rel);
      }
    });
  }
  // Kod yorumlarında (ilk 200 satır src/ ve app/)
  for (const dir of ["src", "app", "lib"]) {
    if (!exists(dir)) continue;
    walk(dir, 4).slice(0, 200).forEach((abs) => {
      if (/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(abs)) {
        const rel = abs.slice(repo.length + 1);
        scanFile(rel);
      }
    });
  }
  return {
    detected: hits.length > 0,
    count: hits.length,
    hits: hits.slice(0, 20),
    note: hits.length > 0
      ? `⚠ ${hits.length} prompt-injection benzeri örüntü bulundu. Bu deterministik skorları ETKİLEMEZ; jüri için uyarı.`
      : "Temiz — prompt injection örüntüsü bulunamadı.",
  };
}

const result = {
  scores: [
    scoreDocs(),
    scoreReadme(),
    scoreAiEvidence(),
    scoreAgentic(),
    scoreTests(),
  ],
  securityScan: scanForInjection(),
};

console.log(JSON.stringify(result, null, 2));
