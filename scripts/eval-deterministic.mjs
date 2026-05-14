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

  // AI yapılandırma klasörü/dosyaları — Claude/Cursor/Copilot/Codex/Gemini/Aider/Continue/Windsurf/Codeium vb.
  const aiConfigCandidates = [
    ".claude",
    ".cursor",
    ".cursorrules",
    ".github/copilot-instructions.md",
    ".codex",
    ".gemini",
    "GEMINI.md",
    "AGENTS.md",
    ".aider.conf.yml",
    ".aider.conf",
    ".aiderrc",
    ".continue",
    ".windsurf",
    ".codeium",
    ".codeiumignore",
    ".devin",
    ".tabnine",
    ".jetbrains-ai",
    ".zed",
  ];
  const aiConfigFound = aiConfigCandidates.filter((p) => exists(p));
  evidence.push({
    path: "AI config",
    lines: null,
    note: aiConfigFound.length > 0 ? `bulunan: ${aiConfigFound.join(", ")}` : "yok (.claude/.cursor/.codex/.gemini/Copilot/Aider/Continue/Windsurf/Codeium ... hiçbiri)",
  });

  // AI tool listesi — README + docs/ dosyalarında da ara
  const aiToolRe = /(claude(?:\s*code)?|cursor|copilot|codex|gemini|chatgpt|anthropic|openai|aider|continue\.dev|windsurf|codeium|devin|tabnine|jetbrains\s*ai|zed\s*ai|ai\s+tools?\s+used|ai-?assist)/i;
  const aiToolInReadme = aiToolRe.test(readme);
  let aiToolInDocs = false;
  if (exists("docs")) {
    try {
      const docMds = readdirSync(join(repo, "docs")).filter((f) => f.endsWith(".md"));
      aiToolInDocs = docMds.some((f) => aiToolRe.test(readSafe(`docs/${f}`)));
    } catch {}
  }
  const aiToolMatch = aiToolInReadme || aiToolInDocs;
  evidence.push({ path: "README.md + docs/", lines: null, note: aiToolMatch ? `AI tool listesi var${aiToolInDocs && !aiToolInReadme ? " (docs/ içinde)" : ""}` : "AI tool listesi yok" });

  // Proje context dosyası (Claude/Cursor/Codex/Gemini/Copilot tarzı) — root + docs/ + herhangi bir alt klasör
  const contextFileNames = ["CLAUDE.md", "CURSOR.md", "AGENTS.md", "GEMINI.md", "CODEX.md", "COPILOT.md", ".cursorrules"];
  const contextFiles = [];
  // Root level
  for (const p of contextFileNames) {
    const c = readSafe(p);
    if (c.length > 0) contextFiles.push({ path: p, content: c });
  }
  // docs/ altında da ara
  if (exists("docs")) {
    for (const p of contextFileNames) {
      const dp = `docs/${p}`;
      const c = readSafe(dp);
      if (c.length > 0) contextFiles.push({ path: dp, content: c });
    }
    // docs/ içinde AI-related dosyalar (AI-WORKFLOW.md, ai-strategy.md, ai-collaboration.md vb.)
    try {
      const docFiles = readdirSync(join(repo, "docs")).filter((f) => /^ai[_-]/i.test(f) && f.endsWith(".md"));
      for (const f of docFiles) {
        const c = readSafe(`docs/${f}`);
        if (c.length > 200) contextFiles.push({ path: `docs/${f}`, content: c });
      }
    } catch {}
  }
  // Deduplicate by path
  const seenPaths = new Set();
  const uniqueContextFiles = contextFiles.filter((x) => { if (seenPaths.has(x.path)) return false; seenPaths.add(x.path); return true; });
  const totalContextBytes = uniqueContextFiles.reduce((s, x) => s + x.content.length, 0);
  const substantiveContext = totalContextBytes > 500;
  if (uniqueContextFiles.length > 0) {
    evidence.push({
      path: "context file(s)",
      lines: null,
      note: `${uniqueContextFiles.map((x) => `${x.path}=${x.content.length}b`).join(", ")}${substantiveContext ? "" : " (toplam placeholder)"}`,
    });
  } else {
    evidence.push({ path: "context file", lines: null, note: "CLAUDE.md/CURSOR.md/AGENTS.md/GEMINI.md vb. hiçbiri yok (root + docs/)" });
  }

  // prompts/ archive
  const hasPrompts = exists("prompts") || exists("ai-logs") || exists("conversations") || exists("ai-history");
  if (hasPrompts) evidence.push({ path: "prompts|ai-logs|conversations|ai-history", lines: null, note: "var" });

  // Skorlama
  // Co-author ratio: ≥30% → +8, 10-30% → +5, >0% → +2, 0 → 0
  if (ratio >= 0.30) score += 8;
  else if (ratio >= 0.10) score += 5;
  else if (coAuthorCount > 0) score += 2;
  // AI config klasör/dosya (Claude/Cursor/Codex/Gemini/Copilot/Aider/Continue/Windsurf/Codeium ...): +4
  if (aiConfigFound.length > 0) score += 4;
  // Substantive context dosyası (CLAUDE.md/CURSOR.md/AGENTS.md/GEMINI.md vb. toplam >500b): +3
  if (substantiveContext) score += 3;
  // README'de AI tool listesi: +4
  if (aiToolMatch) score += 4;
  // Prompt arşivi: +2 bonus
  if (hasPrompts) score += 2;

  score = Math.min(score, 20);
  return {
    criterion: "ai-evidence",
    score,
    max: 20,
    rationale: `${coAuthorCount}/${totalCommits} co-author (${(ratio*100).toFixed(0)}%); AI config: ${aiConfigFound.length>0?aiConfigFound.join("+"):"yok"}; context: ${contextFiles.length>0?contextFiles.map(x=>x.path).join("+")+` (${totalContextBytes}b)`:"yok"}; README'de AI tool=${aiToolMatch}; prompts=${hasPrompts}.`,
    evidence,
  };
}

// ---------- agentic (max 20) ----------
function scoreAgentic() {
  const evidence = [];
  let score = 0;

  // Agent tanımı klasörleri (Claude/Cursor/Codex/Gemini vb. + standalone .agents/)
  const agentDirCandidates = [
    ".claude/agents",
    ".cursor/agents",
    ".codex/agents",
    ".gemini/agents",
    ".continue/agents",
    ".windsurf/agents",
    ".agents",
    "agents",
  ];
  const agentDirs = agentDirCandidates.filter((p) => exists(p));
  let agentCount = 0;
  for (const d of agentDirs) {
    try { agentCount += readdirSync(join(repo, d)).filter((f) => /\.(md|json|ya?ml)$/.test(f)).length; } catch {}
  }

  // Skill tanımı klasörleri (+ standalone .agents/skills)
  const skillDirCandidates = [
    ".claude/skills",
    ".cursor/skills",
    ".codex/skills",
    ".gemini/skills",
    ".continue/skills",
    ".agents/skills",
  ];
  const skillDirs = skillDirCandidates.filter((p) => exists(p));
  let skillCount = 0;
  for (const d of skillDirs) {
    try { skillCount += readdirSync(join(repo, d)).length; } catch {}
  }

  // Repo genelinde AI/agentic dosya taraması (agent, skill, rule, subagent, workflow vb.)
  let scatteredAgentFiles = 0;
  let scatteredSkillFiles = 0;
  const allFiles = walk(".", 4);
  // Agent-like files anywhere: *-agent.md, agent-*.md, *agent*.md, subagent*, rule*.md
  const agentLikePatterns = /[-_]agent\.md$|^agent[-_]|subagent|^rule[sr]?\.md$|[-_]rules?\.md$/i;
  const agentLikeFiles = allFiles.filter((f) => agentLikePatterns.test(basename(f)));
  // Exclude files already counted in agentDirs
  const agentLikeOutside = agentLikeFiles.filter((f) => {
    const rel = f.slice(repo.length + 1);
    return !agentDirs.some((d) => rel.startsWith(d));
  });
  if (agentLikeOutside.length > 0) {
    scatteredAgentFiles = agentLikeOutside.length;
    evidence.push({ path: "agent/rule dosyaları (dağınık)", lines: null, note: `${scatteredAgentFiles} dosya: ${agentLikeOutside.slice(0,10).map(f => f.slice(repo.length+1)).join(", ")}${scatteredAgentFiles>10?"...":""}` });
  }
  // SKILL.md + AI-related files anywhere (outside known skill dirs)
  const skillLikePatterns = /^SKILL\.md$|^skill[-_]|[-_]skill\.md$/i;
  const skillLikeFiles = allFiles.filter((f) => skillLikePatterns.test(basename(f)));
  const skillLikeOutside = skillLikeFiles.filter((f) => {
    const rel = f.slice(repo.length + 1);
    return !skillDirs.some((d) => rel.startsWith(d));
  });
  if (skillLikeOutside.length > 0) {
    scatteredSkillFiles = skillLikeOutside.length;
    evidence.push({ path: "skill dosyaları (dağınık)", lines: null, note: `${scatteredSkillFiles} dosya: ${skillLikeOutside.slice(0,10).map(f => f.slice(repo.length+1)).join(", ")}` });
  }

  // Slash command / workflow tanımları
  const commandDirCandidates = [".claude/commands", ".cursor/commands", ".codex/commands", ".gemini/commands"];
  const commandDirs = commandDirCandidates.filter((p) => exists(p));

  // MCP konfigürasyonu — birden çok yol
  const mcpFileCandidates = [
    ".mcp.json",
    "mcp.json",
    "claude_desktop_config.json",
    ".cursor/mcp.json",
    ".codex/mcp.json",
    ".gemini/mcp.json",
    ".continue/mcp.json",
    ".windsurf/mcp.json",
  ];
  const mcpFiles = mcpFileCandidates.filter((p) => exists(p));
  let mcpServers = [];
  for (const p of mcpFiles) {
    try {
      const parsed = JSON.parse(readSafe(p));
      const keys = Object.keys(parsed.mcpServers || parsed.servers || parsed.mcp_servers || {});
      mcpServers.push(...keys);
    } catch {}
  }
  mcpServers = [...new Set(mcpServers)];

  // Hooks — Claude veya Cursor settings içinde
  const hooksCandidates = [".claude/settings.json", ".cursor/settings.json", ".codex/settings.json"];
  let hasHooks = false;
  for (const p of hooksCandidates) {
    if (exists(p) && /["']?hooks["']?\s*:/.test(readSafe(p))) { hasHooks = true; break; }
  }

  // n8n workflow detection — automation/agentic sinyal
  let hasN8n = false;
  let n8nNote = "";
  // Check README/docs for n8n references
  const n8nInReadme = /\bn8n\b/i.test(readme);
  // Check for n8n workflow JSON files
  const n8nWorkflowFiles = walk(".", 3).filter((f) => /n8n.*\.json$/i.test(basename(f)) || /workflow.*\.json$/i.test(basename(f)));
  // Check for docker-compose with n8n
  const dockerCompose = readSafe("docker-compose.yml") + readSafe("docker-compose.yaml");
  const n8nInDocker = /\bn8n\b/i.test(dockerCompose);
  // Check for n8n references in any config/docs
  const n8nInDocs = walk("docs", 2).some((f) => /\bn8n\b/i.test(readSafe(f.slice(repo.length + 1))));
  hasN8n = n8nInReadme || n8nWorkflowFiles.length > 0 || n8nInDocker || n8nInDocs;
  if (hasN8n) {
    const sources = [];
    if (n8nInReadme) sources.push("README");
    if (n8nWorkflowFiles.length > 0) sources.push(`${n8nWorkflowFiles.length} workflow JSON`);
    if (n8nInDocker) sources.push("docker-compose");
    if (n8nInDocs) sources.push("docs/");
    n8nNote = `n8n tespit: ${sources.join(", ")}`;
  }

  evidence.push({
    path: "agent klasörü",
    lines: null,
    note: agentDirs.length > 0 ? `${agentDirs.join(", ")} (${agentCount} dosya)` : "yok",
  });
  evidence.push({
    path: "skill klasörü",
    lines: null,
    note: skillDirs.length > 0 ? `${skillDirs.join(", ")} (${skillCount} dosya)` : "yok",
  });
  if (commandDirs.length > 0) evidence.push({ path: "command klasörü", lines: null, note: commandDirs.join(", ") });
  evidence.push({
    path: "MCP config",
    lines: null,
    note: mcpFiles.length > 0 ? `${mcpFiles.join(", ")} → MCP'ler: ${mcpServers.join(", ") || "tanımsız"}` : "yok",
  });
  if (hasHooks) evidence.push({ path: "hooks", lines: null, note: "tanımlı" });
  if (hasN8n) evidence.push({ path: "n8n", lines: null, note: n8nNote });

  // Skorlama:
  if (agentDirs.length > 0) score += 4 + Math.min(agentCount, 4);
  else if (scatteredAgentFiles > 0) score += 2 + Math.min(scatteredAgentFiles, 4); // dağınık agent/rule dosyaları
  if (skillDirs.length > 0) score += 4 + Math.min(skillCount, 4);
  else if (scatteredSkillFiles > 0) score += 2 + Math.min(scatteredSkillFiles, 3); // dağınık skill dosyaları
  if (mcpFiles.length > 0) score += 4 + Math.min(mcpServers.length, 2);
  if (commandDirs.length > 0) score += 1;
  if (hasHooks) score += 1;
  if (hasN8n) score += 3; // n8n workflow automation bonus

  score = Math.min(score, 20);
  return {
    criterion: "agentic",
    score,
    max: 20,
    rationale: `agent klasörü=${agentDirs.length>0?agentDirs.join("+")+`(${agentCount})`:"yok"}, skill=${skillDirs.length>0?skillDirs.join("+")+`(${skillCount})`:"yok"}, MCP=${mcpFiles.length>0?mcpServers.join(",")||"var":"yok"}, hooks=${hasHooks}.`,
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
  // Liste/örnek bağlamı: bullet + tırnaklı satır veya code-fence içi → örnek say, atla.
  const isExampleLine = (raw) => {
    const trimmed = raw.trim();
    // Markdown bullet + tırnak: '- "..."', '* "..."', '+ "..."'
    if (/^[-*+]\s+["'`]/.test(trimmed)) return true;
    // Numaralı liste + tırnak: '1. "..."'
    if (/^\d+\.\s+["'`]/.test(trimmed)) return true;
    return false;
  };
  // Anti-injection guidance bağlamı: yakın çevrede "görmezden gel", "ignore these",
  // "examples", "anti-injection", "prompt-injection" varsa örnek say.
  const hasGuidanceContext = (lines, idx) => {
    const start = Math.max(0, idx - 5);
    const end = Math.min(lines.length, idx + 1);
    const window = lines.slice(start, end).join("\n").toLowerCase();
    return /görmezden gel|ignore (these|the following|patterns)|examples? of|anti-?injection|prompt-?injection|do not follow|seni etkilememeli|skor[uy]?[uü]\s+etki/i.test(window);
  };
  const scanFile = (relPath) => {
    const content = readSafe(relPath);
    if (!content) return;
    const lines = content.split("\n");
    let inCodeFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^```/.test(line.trim())) { inCodeFence = !inCodeFence; continue; }
      if (inCodeFence) continue;
      if (isExampleLine(line)) continue;
      if (hasGuidanceContext(lines, i)) continue;
      for (const re of patterns) {
        if (re.test(line)) {
          hits.push({ path: relPath, line: i + 1, excerpt: line.trim().slice(0, 200), pattern: re.source });
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

// ---------- late-commit penalty ----------
// Hackathon teslim deadline: 2026-05-14 17:30 (TR, +03). Sonrası -5.
const LATE_CUTOFF_ISO = "2026-05-14T17:30:00+03:00";
function scoreLatePenalty() {
  const cutoff = new Date(LATE_CUTOFF_ISO).getTime();
  const out = sh(`git log --format='%H %s %cI' -200`).trim();
  if (!out) return { applied: false, points: 0, cutoff: LATE_CUTOFF_ISO, lateCommit: null, lateCommits: [] };
  const lines = out.split("\n");
  const lateCommits = [];
  let latestLate = null;
  for (const line of lines) {
    const parts = line.split(" ");
    const hash = parts[0];
    const when = parts[parts.length - 1]; // ISO date is always last
    const message = parts.slice(1, -1).join(" ");
    if (!hash || !when) continue;
    const t = new Date(when).getTime();
    if (Number.isNaN(t)) continue;
    if (t > cutoff) {
      lateCommits.push({ hash: hash.slice(0, 12), when, message: message.slice(0, 80) });
      if (!latestLate || t > latestLate.t) latestLate = { hash: hash.slice(0, 12), when, t };
    }
  }
  return {
    applied: lateCommits.length > 0,
    points: lateCommits.length > 0 ? 5 : 0,
    cutoff: LATE_CUTOFF_ISO,
    lateCommit: latestLate ? { hash: latestLate.hash, when: latestLate.when } : null,
    lateCommits,
    lateCommitCount: lateCommits.length,
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
  latePenalty: scoreLatePenalty(),
};

console.log(JSON.stringify(result, null, 2));
