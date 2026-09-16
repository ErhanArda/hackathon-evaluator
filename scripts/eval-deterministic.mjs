#!/usr/bin/env node
// Deterministik kriter skorlayıcı.
// Kullanım: node eval-deterministic.mjs <repo-path>
// Çıktı: JSON { scores:[{criterion,score,max,rationale,evidence}], securityScan, latePenalty }
//
// Skorladığı kriterler (5/7):
//   - docs        (max 14)
//   - readme      (max 14)
//   - ai-evidence (max 20)
//   - agentic     (max 20)
//   - tests       (max 4)
//
// LLM'e bırakılanlar: clean-code (14), architecture (14).
//
// Repo kodu ASLA çalıştırılmaz — yalnız dosya okuma + git log.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, relative as pathRelative } from "node:path";
import { execFileSync } from "node:child_process";

const repo = process.argv[2];
if (!repo || !existsSync(repo)) {
  console.error(`usage: node eval-deterministic.mjs <repo-path>`);
  process.exit(2);
}

const exists = (p) => existsSync(join(repo, p));

// readSafe cache'li: tek çalıştırmada aynı dosya 4 kez okunuyordu (docs byte
// sayımı, AI tool regex'i, n8n taraması, injection scanner). Repo salt-okunur.
const _readCache = new Map();
const readSafe = (p) => {
  if (_readCache.has(p)) return _readCache.get(p);
  let v = "";
  try { v = readFileSync(join(repo, p), "utf8"); } catch { /* yok veya binary */ }
  _readCache.set(p, v);
  return v;
};

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "out", "target",
  ".venv", "venv", "__pycache__", "vendor", "coverage", ".turbo", ".cache",
  ".nuxt", ".svelte-kit", "Pods", ".gradle",
]);

// walk cache'li: aynı (rel,depth) çifti tek çalıştırmada 5 kez tam ağaç
// geziyordu. Dönen dizi yalnızca okunur (filter/some/slice).
const _walkCache = new Map();
const walk = (relPath, depth = 3) => {
  const key = `${relPath}|${depth}`;
  if (_walkCache.has(key)) return _walkCache.get(key);
  const out = [];
  const dir = join(repo, relPath);
  if (!existsSync(dir)) { _walkCache.set(key, out); return out; }
  const rec = (d, lvl) => {
    if (lvl < 0) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        rec(join(d, e.name), lvl - 1);
      } else if (e.isFile()) {
        out.push(join(d, e.name));
      }
    }
  };
  rec(dir, depth);
  _walkCache.set(key, out);
  return out;
};

// abs -> repo-göreli yol. `abs.slice(repo.length + 1)` KULLANILMAZ: repo "."
// olarak verildiğinde join(".", "docs") "docs" döner ve slice(2) yolun ilk iki
// karakterini keser ("docs/plan.md" -> "cs/plan.md"), sonra readSafe boş döner.
const rel = (abs) => pathRelative(repo, abs);

// ---------- git: TEK okuma ----------
// Eskiden 3 ayrı `git log` + 2 shell pipe (grep/wc) vardı; ölçümde script
// süresinin ~%95'i buydu (2,1 sn). Tek execFileSync + JS'te parse.
const gitRaw = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: repo, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 128 * 1024 * 1024,
    }).toString();
  } catch { return ""; }
};

const REC_SEP = String.fromCharCode(30);
const FLD_SEP = String.fromCharCode(31);

const COMMITS = (() => {
  const raw = gitRaw("log", `--format=%x1e%H%x1f%cI%x1f%an%x1f%s%x1f%B`);
  return raw
    .split(REC_SEP)
    .filter((r) => r.trim())
    .map((r) => {
      const p = r.split(FLD_SEP);
      return { hash: p[0] || "", when: p[1] || "", author: p[2] || "", subject: p[3] || "", body: p[4] || "" };
    })
    .filter((c) => c.hash);
})();

// Git'in izlediği dosyalar — build çıktısı / untracked dosya sızmasın.
const TRACKED = (() => gitRaw("ls-files", "-z").split("\0").filter(Boolean))();

const readme = readSafe("README.md") || readSafe("readme.md") || readSafe("Readme.md");

// Hackathon teslim şablonunun jüriye dönük AI beyan dosyası. Takımların
// hepsi bunu dolduruyor ama skorlayıcı hiç okumuyordu: AI araçlarını ve MCP
// kullanımını README yerine burada beyan eden takım "yok" alıyordu.
const aiJuri =
  readSafe("AI_JURI.md") || readSafe("ai_juri.md") || readSafe("AI-JURI.md") ||
  readSafe("AI_JURY.md") || readSafe("docs/AI_JURI.md");

// ---------- şablon/placeholder farkındalığı ----------
// Şablon repolarında başlık dolu, altı boş: `## MCP Sunucu Listesi` +
// `- *[kullanılan MCP sunucuları buraya]*`. Eski sürüm başlığı ve örnek
// metni gerçek beyan sayıp puan veriyordu (bir ölçümde readme 6/14'ün
// 5.6'sı tamamen boş şablondan geliyordu). Ayrıca çıplak `\bmcp\b` testi,
// MCP'nin bir ders konusu listesinde geçtiği repoda da ✓ veriyordu.
const PLACEHOLDER_PATTERNS = [
  /\*+\[[^\]]*\]\*+/g,         // *[buraya yazın]*
  /\{\{[^}]*\}\}/g,            // {{mustache}}
  /<[a-zçğıöşü0-9_\-. ]{2,40}>/gi, // <your-url>, <dosya adı>
  /_{3,}/g,                    // ____
  /\bTODO\b|\bTBD\b|\bFIXME\b|\bXXX\b/g,
];

/** Placeholder metinlerini temizler; markdown link/görselleri korur. */
function stripPlaceholders(text) {
  let out = text || "";
  for (const re of PLACEHOLDER_PATTERNS) out = out.replace(re, " ");
  // Markdown linki OLMAYAN köşeli parantezler: `[foo]` gider, `[foo](bar)` kalır.
  out = out.replace(/\[[^\]\n]{0,160}\](?!\s*[(\[])/g, " ");
  return out;
}

/** Markdown başlık satırlarını çıkarır — başlık beyan değildir. */
function stripHeadings(text) {
  return (text || "").replace(/^[ \t]{0,3}#{1,6}[^\n]*$/gm, " ");
}

/**
 * Kod bloklarını ve inline kod'u çıkarır. README'deki "Proje Yapısı" dosya
 * ağacında `CLAUDE.md` geçmesi, AI aracı BEYANI değildir — bu yüzden beyan
 * testlerinde kod blokları sayılmaz. (Kurulum/env boyutu ham README'ye
 * baktığı için install komutlarından etkilenmez.)
 */
function stripCode(text) {
  return (text || "")
    .replace(/^[ \t]{0,3}(```|~~~)[\s\S]*?^[ \t]{0,3}\1[^\n]*$/gm, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** Başlık + placeholder + kod temizlenmiş gövde: "gerçekten yazılmış" beyan. */
function declaredText(text) {
  return stripCode(stripHeadings(stripPlaceholders(text)));
}

/** Metinde anlamlı içerik kaldı mı (yalnız noktalama/tablo çizgisi değil)? */
function hasRealContent(text, minChars = 12) {
  const t = (text || "")
    .replace(/^\s*\|[\s|:\-]*\|\s*$/gm, " ")  // boş tablo ayıracı
    .replace(/[|\-–—*_>`#:.,;()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= minChars;
}

/**
 * Başlığa uyan bölümün gövdesini döndürür (bir sonraki aynı/üst seviye
 * başlığa kadar). Bölüm yoksa null.
 */
function sectionBody(text, headingRe) {
  const lines = (text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[ \t]{0,3}(#{1,6})\s+(.*)$/);
    if (!m || !headingRe.test(m[2])) continue;
    const level = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].match(/^[ \t]{0,3}(#{1,6})\s+/);
      if (h && h[1].length <= level) break;
      body.push(lines[j]);
    }
    return body.join("\n");
  }
  return null;
}

/**
 * Bir README boyutu için: ilgili başlık varsa gövdesi DOLU olmalı; başlık
 * yoksa gövdede (placeholder/başlık temizlenmiş) desen geçmeli.
 * `corroborate` verilirse, başlıksız yolda ek kanıt da şart koşulur.
 */
function declaresSection(text, headingRe, contentRe, corroborate = true, sectionRe = null) {
  // `sectionRe`: yalnız BAŞLIĞI eşleşen bölümün gövdesinde kullanılan, daha
  // geniş desen. "## Kullanılan AI Araçları" altındaki bir satırda geçen "v0",
  // "GLM" veya "Command R" kesinlikle bir araç beyanıdır; aynı kelimeler
  // README'nin rastgele bir yerinde sürüm dizesi ya da istatistik terimi
  // olabilir. Böylece hassasiyeti kaybetmeden geri çağırma kazanıyoruz.
  const inSection = sectionRe || contentRe;
  const body = sectionBody(text, headingRe);
  if (body !== null) {
    const filled = stripPlaceholders(body);
    if (hasRealContent(filled) && inSection.test(filled)) return true;
    // Başlık var ama gövde boş/placeholder → beyan yok.
    if (!hasRealContent(filled)) return false;
  }
  const declared = declaredText(text);
  return contentRe.test(declared) && corroborate;
}

const SKIP_PATH = /(^|\/)(node_modules|\.next|dist|build|out|vendor|coverage|\.venv|venv|__pycache__|target|\.turbo|\.svelte-kit|\.nuxt|Pods)(\/|$)/i;

// ---------- MCP: istemci config'i VE sunucu implementasyonu ----------
// Bir repo MCP'yi iki yönde kullanabilir: istemci olarak (.mcp.json ile
// dışarıdaki sunucuyu bağlar) ya da SUNUCU olarak (kendi MCP server'ını
// yazar). Eski sürüm yalnız istemci config'ine bakıyordu; motoru
// `mcp_server.py` ile MCP sunucusu olarak dışa açan takım "MCP=yok" alıyor
// ve agentic'te 4-6 puan kaybediyordu.
// Yalnız GERÇEK SDK import'u sayılır — README'de "MCP" yazması veya
// requirements.txt'te yorum satırı yeterli değil.
const MCP_SDK_IMPORT_RE =
  /^[ \t]*(?:from\s+mcp[.\s]|import\s+mcp\b|from\s+["'`]@modelcontextprotocol\/|(?:const|let|var)\s+.*=\s*require\(\s*["'`]@modelcontextprotocol\/)/m;
let _mcpServerFiles = null;
function findMcpServerFiles() {
  if (_mcpServerFiles) return _mcpServerFiles;
  const files = (TRACKED.length ? TRACKED : walk(".", 4).map(rel))
    .filter((f) => /\.(py|ts|tsx|js|mjs|cjs)$/i.test(f) && !SKIP_PATH.test(f));
  _mcpServerFiles = files.filter((f) => MCP_SDK_IMPORT_RE.test(readSafe(f)));
  return _mcpServerFiles;
}

// ---------- manifest toplama (monorepo dahil) ----------
// Eskiden yalnız KÖK package.json okunuyordu; bu yüzden monorepo'lar (bu
// projenin kendisi dahil) ve Node dışı stack'ler tests kriterinden yapısal
// olarak 0/4 alıyordu.
const MANIFEST_NAMES = [
  "package.json", "pyproject.toml", "requirements.txt", "Pipfile", "setup.cfg",
  "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml",
  "composer.json", "Gemfile", "pubspec.yaml", "Package.swift", "mix.exs",
];
let _manifests = null;
function collectManifests() {
  if (_manifests) return _manifests;
  const files = TRACKED.length ? TRACKED : walk(".", 5).map(rel);
  _manifests = files
    .filter((f) => MANIFEST_NAMES.includes(basename(f)) && !SKIP_PATH.test(f))
    .slice(0, 40)
    .map((f) => ({ path: f, content: readSafe(f) }));
  return _manifests;
}
const allDepsText = () => collectManifests().map((m) => m.content).join("\n");

// README'de beyan edilen deploy URL'leri. Eski sürüm sabit bir host beyaz
// listesi kullanıyordu (vercel.app/netlify/...) ve kurumsal/Azure/AWS/custom
// domain'leri reddediyordu — iç hackathon'da sistematik ceza.
function findDeployUrls() {
  const urls = new Set();
  for (const m of readme.matchAll(/https?:\/\/[^\s)<>"'\]]+/gi)) {
    const u = m[0].replace(/[.,;:]+$/, "");
    if (/github\.com|gitlab\.com|bitbucket\.org|npmjs\.com|nodejs\.org|reactjs\.org|nextjs\.org|shields\.io|localhost|127\.0\.0\.1|example\.(com|org)|fonts\.googleapis/i.test(u)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|mp4|zip)$/i.test(u)) continue;
    urls.add(u);
  }
  return [...urls].slice(0, 5);
}

// ---------- docs (max 14) ----------
function scoreDocs() {
  const evidence = [];

  // docs/ dışındaki yaygın adlar da kabul edilir.
  const docDir = ["docs", "doc", "documentation", "Documentation", ".docs", "wiki"].find((d) => exists(d));

  // ALT KLASÖRLER dahil — eski sürüm readdirSync ile tek seviye tarıyordu,
  // bu yüzden docs/planning/plan.md gibi bir yerleşim 5/14 alıyordu.
  const docFiles = docDir ? walk(docDir, 4).filter((f) => /\.mdx?$/i.test(f)).map(rel) : [];

  if (!docDir || docFiles.length === 0) {
    const claudeMd = readSafe("CLAUDE.md");
    const agentsMd = readSafe("AGENTS.md");
    let score = 0;
    evidence.push({ path: "docs/", lines: null, note: docDir ? `${docDir}/ var ama markdown yok` : "yok (docs/doc/documentation hiçbiri)" });
    if (claudeMd.length > 200 || agentsMd.length > 200) {
      score = 3;
      evidence.push({ path: "CLAUDE.md/AGENTS.md", lines: null, note: `${claudeMd.length + agentsMd.length} byte gömülü doküman` });
    } else if (readme.length > 2000) {
      score = 2;
      evidence.push({ path: "README.md", lines: null, note: "tüm doküman README'de gömülü" });
    }
    return {
      criterion: "docs", score, max: 14,
      rationale: `Ayrı doküman klasörü yok. ${score === 0 ? "Doküman bulunamadı." : score === 2 ? "Tüm doküman README'de gömülü." : "CLAUDE.md/AGENTS.md var ama ayrı plan/aşama/mimari dokümanı yok."}`,
      evidence,
    };
  }

  // Bir doküman "sayılması" için içerik taşımalı — 3 adet 2-byte placeholder
  // dosya eskiden 12/14 alıyordu.
  const SUBSTANTIVE = 500;
  // Byte sayımı placeholder'ı saymaz: saf şablon bir doküman değildir.
  const withContent = docFiles.map((f) => ({ f, c: readSafe(f), real: stripPlaceholders(readSafe(f)).trim() }));
  const substantive = withContent.filter((x) => x.real.length >= SUBSTANTIVE);

  evidence.push({
    path: `${docDir}/`,
    lines: null,
    note: `${docFiles.length} markdown (alt klasörler dahil), ${substantive.length} tanesi ≥${SUBSTANTIVE} byte: ${substantive.slice(0, 8).map((x) => `${basename(x.f)}=${x.real.length}b`).join(", ") || "yok"}`,
  });

  const hasIn = (re) => substantive.some((x) => re.test(basename(x.f)));
  const hasPlan = hasIn(/plan|roadmap|backlog/i);
  const hasPhases = hasIn(/phase|faz|stage|asama|aşama|milestone|sprint/i);
  const hasArch = hasIn(/architecture|mimari|design|tasarim|tasarım|adr/i);
  const count = [hasPlan, hasPhases, hasArch].filter(Boolean).length;

  let score = count === 3 ? 11 : count === 2 ? 8 : count === 1 ? 5 : substantive.length > 0 ? 3 : 1;

  // Yapısal kalite bonusu (0-3): ortalama byte yerine gerçek yapı. Eski
  // "ortalama <300 byte → -2" kuralı tek büyük dosya eklenerek bypass
  // ediliyordu.
  const allDocText = substantive.map((x) => x.c).join("\n");  // yapı bonusu ham metinden
  const headings = (allDocText.match(/^#{1,6}\s+\S/gm) || []).length;
  const codeBlocks = Math.floor((allDocText.match(/^```/gm) || []).length / 2);
  const tables = (allDocText.match(/^\|.+\|\s*$/gm) || []).length;
  const diagrams = /```mermaid|!\[.+\]\(|<img\s/i.test(allDocText);
  let bonus = 0;
  if (headings >= 12) bonus++;
  if (codeBlocks >= 3 || tables >= 5) bonus++;
  if (diagrams) bonus++;
  score = Math.min(score + bonus, 14);
  evidence.push({
    path: `${docDir}/* yapı`,
    lines: null,
    note: `${headings} başlık, ${codeBlocks} kod bloğu, ${tables} tablo satırı, diyagram/görsel=${diagrams} → +${bonus}`,
  });

  return {
    criterion: "docs",
    score,
    max: 14,
    rationale: `${docDir}/ altında ${substantive.length} içerikli doküman. Plan=${hasPlan}, aşamalar=${hasPhases}, mimari=${hasArch} (${count}/3). Yapı bonusu +${bonus}.`,
    evidence,
  };
}

// ---------- readme (max 14) ----------
function scoreReadme() {
  const evidence = [];
  if (!readme) {
    return { criterion: "readme", score: 0, max: 14, rationale: "README.md yok veya boş.", evidence: [{ path: "README.md", lines: null, note: "yok" }] };
  }
  const dims = [];

  // Başlık + placeholder farkındalığı: `*[örn. Claude Code]*` bir beyan
  // değildir, `## MCP Sunucu Listesi` başlığı da tek başına yeterli değildir.
  // Batı dışı modeller ve yeni nesil ajan araçları da beyan sayılır. Eski liste
// yalnız Claude/Cursor/Copilot ailesini tanıyordu: GLM-5.3 + ZCode beyan eden
// takım (Achillies) kusursuz doldurulmuş tabloya rağmen "AI tool listesi=✗"
// alıp readme + ai-evidence'tan 6 puan kaybediyordu.
  const AI_TOOL_RE = /(claude(?:\s*code)?|cursor|copilot|codex|gemini|chatgpt|anthropic|openai|aider|windsurf|codeium|deepseek|qwen|glm-?\d|zcode|kimi|moonshot|minimax|doubao|ernie|llama|mistral|mixtral|grok|gemma|trae|cline|roo\s*code|kilo\s*code|replit|bolt\.new|lovable|ollama|lm\s*studio|perplexity|saka[\\s/_-]*(?:gpt|glm|claude|codex|gemini|sonnet|opus)|ai tools? used|ai-?assist)/i;
// Beyan bölümü İÇİNDE geçerli olan ek adlar: tek başına bunlar bir README'nin
// herhangi bir yerinde sürüm dizesi / CLI bayrağı / istatistik terimi olabilir,
// ama "Kullanılan AI Araçları" başlığının altında geçtiklerinde beyandır.
  const AI_TOOL_LOOSE = /\bv0\b|\bglm\b|\bsaka\b|command-?\s?r\b|\bphi-?\d|\byi-?\d|\bnova\b|\btitan\b|\bjamba\b|\bdbrx\b|\breka\b/i;
  const MCP_RE = /\bmcp\b|model context protocol/i;
  const MCP_CONFIG_FILES = [
    ".mcp.json", "mcp.json", "claude_desktop_config.json", ".cursor/mcp.json",
    ".codex/mcp.json", ".gemini/mcp.json", ".continue/mcp.json",
    ".windsurf/mcp.json", ".vscode/mcp.json",
  ];
  const hasMcpConfig = MCP_CONFIG_FILES.some((f) => exists(f));
  const mcpServerFiles = findMcpServerFiles();
  // Kendi MCP sunucusunu yazmak da MCP kullanımının kanıtıdır.
  const hasMcpEvidence = hasMcpConfig || mcpServerFiles.length > 0;

  // Beyan README'de ya da AI_JURI.md'de olabilir — şablon ikisini de jüriye
  // dönük belge sayıyor, takımlar AI/MCP beyanını çoğu zaman AI_JURI.md'ye
  // yazıyor. Hangi dosyadan geldiğini evidence'ta belirtiyoruz.
  const AI_TOOL_HEAD = /ai|yapay zek|tool|ara[çc]|model/i;
  const AI_TOOL_SECTION_RE = new RegExp(`${AI_TOOL_RE.source}|${AI_TOOL_LOOSE.source}`, "i");
  const aiToolInReadme = declaresSection(readme, AI_TOOL_HEAD, AI_TOOL_RE, true, AI_TOOL_SECTION_RE);
  const aiToolInJuri = !!aiJuri && declaresSection(aiJuri, AI_TOOL_HEAD, AI_TOOL_RE, true, AI_TOOL_SECTION_RE);
  dims.push({ name: "AI tool listesi", got: aiToolInReadme || aiToolInJuri });

  // MCP'de başlıksız yol ek kanıt ister: repoda gerçek bir MCP config'i ya da
  // MCP sunucu implementasyonu olmalı. Aksi halde "MCP" kelimesinin bir
  // ders/konu listesinde geçmesi ✓ veriyordu.
  const mcpInReadme = declaresSection(readme, MCP_RE, MCP_RE, hasMcpEvidence);
  const mcpInJuri = !!aiJuri && declaresSection(aiJuri, MCP_RE, MCP_RE, hasMcpEvidence);
  dims.push({ name: "MCP listesi", got: mcpInReadme || mcpInJuri });

  if (aiToolInJuri && !aiToolInReadme) evidence.push({ path: "AI_JURI.md", lines: null, note: "AI tool beyanı README'de değil AI_JURI.md'de" });
  if (mcpInJuri && !mcpInReadme) evidence.push({ path: "AI_JURI.md", lines: null, note: "MCP beyanı README'de değil AI_JURI.md'de" });
  if (mcpServerFiles.length > 0) evidence.push({ path: "MCP sunucusu", lines: null, note: `kendi MCP server implementasyonu: ${mcpServerFiles.slice(0, 3).join(", ")}` });

  const deployUrls = findDeployUrls();
  dims.push({ name: "Deploy URL", got: deployUrls.length > 0 });

  const hasInstall = /(npm|pnpm|yarn|bun)\s+(install|i|ci)\b|pip install|poetry install|go mod download|cargo build|mvn install|gradle build|composer install|bundle install/i.test(readme);
  const hasEnvExample = exists(".env.example") || exists(".env.sample") || exists(".env.template");
  const envInReadme = /\.env(\.example)?|environment variable|env var|ortam değişken/i.test(readme);
  dims.push({ name: "Kurulum/env", got: hasInstall && (hasEnvExample || envInReadme) });

  // Görsel: referans verilen yerel dosya gerçekten var mı? Eskiden salt
  // `![x](y)` regex'i yeterliydi, hedefin varlığına bakılmıyordu.
  const imgRefs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1].trim());
  const htmlImgs = /<img\s+[^>]*src=/i.test(readme);
  const localImgOk = imgRefs.some((r) => (/^https?:\/\//i.test(r) ? true : exists(r.replace(/^\.?\//, ""))));
  dims.push({ name: "Görsel/screenshot", got: localImgOk || htmlImgs });
  if (imgRefs.length > 0 && !localImgOk && !htmlImgs) {
    evidence.push({ path: "README.md", lines: null, note: `${imgRefs.length} görsel referansı var ama hiçbiri çözülemedi (ör. ${imgRefs[0]})` });
  }

  let score = 0;
  const per = 14 / dims.length; // 2.8
  for (const d of dims) {
    if (d.got) score += per;
    evidence.push({ path: "README.md", lines: null, note: `${d.name}: ${d.got ? "var" : "yok"}` });
  }
  if (deployUrls.length > 0) {
    evidence.push({ path: "deploy URL", lines: null, note: deployUrls.slice(0, 2).join(", ") });
  }
  score = Math.min(Math.round(score), 14);

  return {
    criterion: "readme",
    score,
    max: 14,
    rationale: `5 boyut: ${dims.map((d) => `${d.name}=${d.got ? "✓" : "✗"}`).join(", ")}.`,
    evidence,
  };
}

// ---------- ai-evidence (max 20) ----------
function scoreAiEvidence() {
  const evidence = [];
  let score = 0;

  // DÜZELTME: eskiden `git log | grep -ci 'co-authored-by'` EŞLEŞEN SATIRI
  // sayıyordu, commit'i değil — iki trailer'lı bir commit iki kez sayılıyor ve
  // oran %100'ü aşabiliyordu (ölçümde %225 gibi değerler). Artık commit bazında.
  const coAuthorCount = COMMITS.filter((c) => /co-authored-by/i.test(c.body)).length;
  const totalCommits = COMMITS.length;
  const ratio = totalCommits > 0 ? coAuthorCount / totalCommits : 0;
  evidence.push({ path: "git-log", lines: null, note: `${coAuthorCount}/${totalCommits} commit co-author trailer'ı taşıyor (%${(ratio * 100).toFixed(0)})` });

  const aiConfigCandidates = [
    ".claude", ".cursor", ".cursorrules", ".github/copilot-instructions.md",
    ".codex", ".gemini", "GEMINI.md", "AGENTS.md", ".aider.conf.yml", ".aider.conf",
    ".aiderrc", ".continue", ".windsurf", ".codeium", ".codeiumignore", ".devin",
    ".tabnine", ".jetbrains-ai", ".zed", ".kilocode", ".roo", ".cline",
  ];
  const aiConfigFound = aiConfigCandidates.filter((p) => exists(p));
  evidence.push({ path: "AI config", lines: null, note: aiConfigFound.length > 0 ? `bulunan: ${aiConfigFound.join(", ")}` : "yok" });

  const aiToolRe = /(claude(?:\s*code)?|cursor|copilot|codex|gemini|chatgpt|anthropic|openai|aider|continue\.dev|windsurf|codeium|devin|tabnine|jetbrains\s*ai|zed\s*ai|deepseek|qwen|glm-?\d|zcode|kimi|moonshot|minimax|doubao|ernie|llama|mistral|mixtral|grok|gemma|trae|cline|roo\s*code|kilo\s*code|replit|bolt\.new|lovable|ollama|lm\s*studio|perplexity|saka[\\s/_-]*(?:gpt|glm|claude|codex|gemini|sonnet|opus)|ai\s+tools?\s+used|ai-?assist)/i;
  // Placeholder farkındalığı: `*[örn. Claude Code]*` beyan sayılmaz.
  // "Kullanılan AI Araçları" başlığının ALTINDA geçtiğinde, tek başına
  // belirsiz olan adlar da (v0, GLM, SAKA, Command R, Phi-4, Yi-34B…) beyan
  // sayılır; README'nin geri kalanında yalnız kesin adlar aranır.
  const AI_HEAD_RE = /ai|yapay zek|tool|ara[çc]|model/i;
  const AI_LOOSE_RE = /\bv0\b|\bglm\b|\bsaka\b|command-?\s?r\b|\bphi-?\d|\byi-?\d|\bnova\b|\btitan\b|\bjamba\b|\bdbrx\b|\breka\b/i;
  const declaresTool = (txt) => {
    if (!txt) return false;
    const body = sectionBody(txt, AI_HEAD_RE);
    if (body !== null) {
      const filled = stripPlaceholders(body);
      if (hasRealContent(filled) && (aiToolRe.test(filled) || AI_LOOSE_RE.test(filled))) return true;
    }
    return aiToolRe.test(declaredText(txt));
  };
  const aiToolInReadme = declaresTool(readme);
  const docDir = ["docs", "doc", "documentation"].find((d) => exists(d));
  const aiToolInDocs = docDir
    ? walk(docDir, 3).some((f) => /\.mdx?$/i.test(f) && declaresTool(readSafe(rel(f))))
    : false;
  const aiToolInJuri = !!aiJuri && declaresTool(aiJuri);
  const aiToolMatch = aiToolInReadme || aiToolInDocs || aiToolInJuri;
  const aiToolWhere = aiToolInReadme ? "" : aiToolInDocs ? " (docs/ içinde)" : aiToolInJuri ? " (AI_JURI.md içinde)" : "";
  evidence.push({ path: "README.md + docs/ + AI_JURI.md", lines: null, note: aiToolMatch ? `AI tool listesi var${aiToolWhere}` : "AI tool listesi yok" });

  const contextFileNames = ["CLAUDE.md", "CURSOR.md", "AGENTS.md", "GEMINI.md", "CODEX.md", "COPILOT.md", ".cursorrules"];
  const contextFiles = [];
  for (const p of contextFileNames) {
    const c = readSafe(p);
    // Gerçek içerik byte'ı: doldurulmamış şablon bir context dosyası değildir.
    if (c.length > 0) contextFiles.push({ path: p, len: stripPlaceholders(c).trim().length });
  }
  if (docDir) {
    for (const p of contextFileNames) {
      const c = readSafe(`${docDir}/${p}`);
      if (c.length > 0) contextFiles.push({ path: `${docDir}/${p}`, len: c.length });
    }
    for (const abs of walk(docDir, 2)) {
      const b = basename(abs);
      if (/^ai[_-]/i.test(b) && /\.mdx?$/i.test(b)) {
        const c = stripPlaceholders(readSafe(rel(abs))).trim();
        if (c.length > 200) contextFiles.push({ path: rel(abs), len: c.length });
      }
    }
  }
  const seenPaths = new Set();
  const uniqueContext = contextFiles.filter((x) => { if (seenPaths.has(x.path)) return false; seenPaths.add(x.path); return true; });
  const totalContextBytes = uniqueContext.reduce((s, x) => s + x.len, 0);
  const substantiveContext = totalContextBytes > 500;
  evidence.push({
    path: "context file(s)",
    lines: null,
    note: uniqueContext.length > 0
      ? `${uniqueContext.map((x) => `${x.path}=${x.len}b`).join(", ")}${substantiveContext ? "" : " (placeholder seviyesinde)"}`
      : "CLAUDE.md/AGENTS.md/GEMINI.md vb. hiçbiri yok",
  });

  const hasPrompts = ["prompts", "ai-logs", "conversations", "ai-history", "transcripts"].some((d) => exists(d));
  if (hasPrompts) evidence.push({ path: "prompt arşivi", lines: null, note: "var" });

  if (ratio >= 0.30) score += 8;
  else if (ratio >= 0.10) score += 5;
  else if (coAuthorCount > 0) score += 2;
  if (aiConfigFound.length > 0) score += 4;
  if (substantiveContext) score += 3;
  if (aiToolMatch) score += 4;
  if (hasPrompts) score += 2;

  score = Math.min(score, 20);
  return {
    criterion: "ai-evidence",
    score,
    max: 20,
    rationale: `${coAuthorCount}/${totalCommits} co-author (%${(ratio * 100).toFixed(0)}); AI config: ${aiConfigFound.length > 0 ? aiConfigFound.join("+") : "yok"}; context: ${uniqueContext.length > 0 ? `${totalContextBytes}b` : "yok"}; README'de AI tool=${aiToolMatch}; prompt arşivi=${hasPrompts}.`,
    evidence,
  };
}

// ---------- agentic (max 20) ----------
function scoreAgentic() {
  const evidence = [];
  let score = 0;

  const AI_ROOTS = [".claude", ".cursor", ".codex", ".gemini", ".continue", ".windsurf", ".agents"];
  const PLACEHOLDER = 200; // byte — altı placeholder sayılır

  // Agent/skill tanımlarını SABİT yol listesiyle değil, AI config kökleri
  // altında herhangi bir derinlikte arayarak bul. Eski sabit liste
  // `.claude/skills/<x>/agents/` yolunu görmüyordu — bu projenin kendi 5 agent
  // tanımı bu yüzden "agent klasörü: yok" diye sayılıyordu.
  const agentFiles = [];
  const skillFiles = [];
  for (const root of AI_ROOTS) {
    if (!exists(root)) continue;
    for (const abs of walk(root, 5)) {
      if (!/\.(md|mdx|json|ya?ml|toml)$/i.test(abs)) continue;
      const r = rel(abs);
      const size = readSafe(r).length;
      if (/(^|\/)agents?(\/|$)/i.test(r)) agentFiles.push({ path: r, size });
      else if (/(^|\/)skills?(\/|$)/i.test(r)) skillFiles.push({ path: r, size });
    }
  }
  // Kök seviyedeki standalone agents/ klasörü — uygulama kaynak klasörü de
  // olabileceği için yalnız tanım dosyalarını (md/yaml/toml) say.
  for (const d of ["agents", "agent"]) {
    if (!exists(d)) continue;
    for (const abs of walk(d, 3)) {
      if (!/\.(md|mdx|ya?ml|toml)$/i.test(abs)) continue;
      const r = rel(abs);
      agentFiles.push({ path: r, size: readSafe(r).length });
    }
  }

  const realAgents = agentFiles.filter((x) => x.size >= PLACEHOLDER);
  const realSkills = skillFiles.filter((x) => x.size >= PLACEHOLDER);

  evidence.push({
    path: "agent tanımları",
    lines: null,
    note: agentFiles.length === 0
      ? "yok"
      : `${agentFiles.length} dosya, ${realAgents.length} tanesi ≥${PLACEHOLDER}b: ${realAgents.slice(0, 6).map((x) => `${x.path}=${x.size}b`).join(", ") || "hepsi placeholder"}`,
  });
  evidence.push({
    path: "skill tanımları",
    lines: null,
    note: skillFiles.length === 0
      ? "yok"
      : `${skillFiles.length} dosya, ${realSkills.length} tanesi ≥${PLACEHOLDER}b: ${realSkills.slice(0, 6).map((x) => `${x.path}=${x.size}b`).join(", ") || "hepsi placeholder"}`,
  });

  const commandDirs = AI_ROOTS.map((r) => `${r}/commands`).filter((p) => exists(p));
  if (commandDirs.length > 0) evidence.push({ path: "slash command", lines: null, note: commandDirs.join(", ") });

  const mcpFileCandidates = [
    ".mcp.json", "mcp.json", "claude_desktop_config.json", ".cursor/mcp.json",
    ".codex/mcp.json", ".gemini/mcp.json", ".continue/mcp.json", ".windsurf/mcp.json",
    ".vscode/mcp.json",
  ];
  const mcpFiles = mcpFileCandidates.filter((p) => exists(p));
  const mcpServerImpl = findMcpServerFiles();
  let mcpServers = [];
  for (const p of mcpFiles) {
    try {
      const parsed = JSON.parse(readSafe(p));
      mcpServers.push(...Object.keys(parsed.mcpServers || parsed.servers || parsed.mcp_servers || {}));
    } catch { /* bozuk JSON */ }
  }
  mcpServers = [...new Set(mcpServers)];
  const mcpNotes = [];
  if (mcpFiles.length > 0) mcpNotes.push(`istemci config: ${mcpFiles.join(", ")} → ${mcpServers.join(", ") || "server tanımsız"}`);
  if (mcpServerImpl.length > 0) mcpNotes.push(`kendi MCP sunucusu: ${mcpServerImpl.slice(0, 3).join(", ")}`);
  evidence.push({
    path: "MCP config",
    lines: null,
    note: mcpNotes.length > 0 ? mcpNotes.join(" · ") : "yok",
  });

  let hasHooks = false;
  for (const p of AI_ROOTS.map((r) => `${r}/settings.json`)) {
    if (exists(p) && /["']?hooks["']?\s*:/.test(readSafe(p))) { hasHooks = true; break; }
  }
  if (hasHooks) evidence.push({ path: "hooks", lines: null, note: "tanımlı" });

  // n8n: "workflow" içeren herhangi bir .json veya README'de tek kelime artık
  // yetmiyor (eskiden "n8n kullanmadık" yazmak +3 veriyordu). Gerçek bir n8n
  // workflow dosyası veya tanımlı bir n8n servisi gerekir.
  const n8nSources = [];
  const n8nWorkflowFiles = (TRACKED.length ? TRACKED : walk(".", 4).map(rel))
    .filter((f) => /\.json$/i.test(f) && !SKIP_PATH.test(f))
    .filter((f) => {
      const c = readSafe(f);
      return c.length < 4_000_000 && /"nodes"\s*:/.test(c) && /n8n-nodes|"n8nVersion"|"workflowData"/i.test(c);
    });
  if (n8nWorkflowFiles.length > 0) n8nSources.push(`${n8nWorkflowFiles.length} n8n workflow JSON`);
  const dockerCompose = readSafe("docker-compose.yml") + readSafe("docker-compose.yaml") + readSafe("compose.yml");
  if (/\bn8nio\/n8n\b|image:\s*n8n/i.test(dockerCompose)) n8nSources.push("docker-compose servisi");
  const hasN8n = n8nSources.length > 0;
  if (hasN8n) evidence.push({ path: "n8n", lines: null, note: n8nSources.join(", ") });

  if (realAgents.length > 0) score += 4 + Math.min(realAgents.length, 4);
  else if (agentFiles.length > 0) score += 2;
  if (realSkills.length > 0) score += 4 + Math.min(realSkills.length, 4);
  else if (skillFiles.length > 0) score += 2;
  // İstemci config'i de kendi sunucusunu yazmak da MCP kullanımıdır.
  const mcpUnitCount = Math.max(mcpServers.length, mcpServerImpl.length);
  if (mcpFiles.length > 0 || mcpServerImpl.length > 0) score += 4 + Math.min(mcpUnitCount, 2);
  if (commandDirs.length > 0) score += 1;
  if (hasHooks) score += 1;
  if (hasN8n) score += 3;

  score = Math.min(score, 20);
  return {
    criterion: "agentic",
    score,
    max: 20,
    rationale: `${realAgents.length} gerçek agent tanımı, ${realSkills.length} gerçek skill, MCP=${mcpFiles.length > 0 || mcpServerImpl.length > 0 ? mcpServers.join(",") || (mcpServerImpl.length > 0 ? "kendi sunucusu" : "var") : "yok"}, slash command=${commandDirs.length > 0}, hooks=${hasHooks}, n8n=${hasN8n}.`,
    evidence,
  };
}

// ---------- tests (max 4) ----------
// Stack-agnostik: eski sürüm dört alt maddenin de sol tarafını yalnız KÖK
// package.json'dan besliyordu, bu yüzden Python/Go/Java/Rust takımları ve
// monorepo'lar yapısal olarak 0/4 alıyordu.
function scoreTests() {
  const evidence = [];
  let score = 0;

  const deps = allDepsText();
  const files = TRACKED.length ? TRACKED : walk(".", 6).map(rel);
  const testFiles = files.filter((f) => !SKIP_PATH.test(f) && (
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(basename(f)) ||
    /^test_.+\.py$|_test\.py$/i.test(basename(f)) ||
    /_test\.go$/i.test(basename(f)) ||
    /(^|\/)src\/test\/(java|kotlin)\//i.test(f) ||
    /Tests?\.(cs|swift|kt|java)$/i.test(basename(f)) ||
    /(^|\/)tests?\/.+\.(rs|php|rb|exs?)$/i.test(f) ||
    /Test\.php$|_spec\.rb$|_test\.exs$/i.test(basename(f))
  ));

  // 1. Unit test — dosya VEYA bağımlılık (eskiden VE idi; Python/Go repolar
  //    test dosyası olmasına rağmen 0 alıyordu)
  // Tırnaklı biçim yalnız package.json'da var; requirements.txt/go.mod/
  // Cargo.toml tırnaksız yazar. "ava"/"tap" düz kelime olarak çok yanlış
  // eşleşir, onlar tırnaklı kalır.
  const unitDep = /"(ava|tap)"|\b(vitest|jest|mocha|pytest|unittest|junit|testng|xunit|nunit|phpunit|rspec|minitest|testify)\b/i.test(deps);
  const unitFiles = testFiles.filter((f) => !/e2e|cypress|playwright/i.test(f));
  const hasUnit = unitFiles.length > 0 || unitDep;
  if (hasUnit) score += 1;
  evidence.push({ path: "unit test", lines: null, note: `${unitFiles.length} test dosyası, bağımlılık=${unitDep}${unitFiles.length ? ` (ör. ${unitFiles[0]})` : ""}` });

  // 2. Component/UI test
  const compDep = /@testing-library\/(react|dom|vue|angular|svelte)|vue-test-utils|enzyme|@vue\/test-utils|espresso|XCTest|compose-ui-test/i.test(deps);
  const compFiles = testFiles.filter((f) => /\.(test|spec)\.(tsx|jsx|vue|svelte)$/i.test(basename(f)) || /androidTest|UITests?/i.test(f));
  const hasComponent = compFiles.length > 0 || (compDep && unitFiles.length > 0);
  if (hasComponent) score += 1;
  evidence.push({ path: "component test", lines: null, note: `bağımlılık=${compDep}, dosya=${compFiles.length}` });

  // 3. E2E
  const e2eDep = /@playwright\/test|\b(playwright|cypress|puppeteer|selenium|webdriverio|detox|maestro)\b/i.test(deps);
  const e2eConfig = files.some((f) => /^(playwright|cypress)\.config\./i.test(basename(f))) || exists("cypress.json") || exists(".maestro");
  const e2eDir = ["e2e", "tests/e2e", "cypress", "test/e2e", "integration-tests"].some((p) => exists(p));
  const hasE2e = e2eDep && (e2eConfig || e2eDir || testFiles.some((f) => /e2e|cypress/i.test(f)));
  if (hasE2e) score += 1;
  evidence.push({ path: "E2E", lines: null, note: `bağımlılık=${e2eDep}, config=${e2eConfig}, klasör=${e2eDir}` });

  // 4. Çalıştırılabilirlik: test script'i VEYA CI test adımı
  let hasTestScript = false;
  for (const m of collectManifests()) {
    if (m.path.endsWith("package.json")) {
      try {
        const sc = JSON.parse(m.content).scripts || {};
        if (Object.keys(sc).some((k) => /^test(:|$)|^e2e(:|$)|coverage/i.test(k))) { hasTestScript = true; break; }
      } catch { /* bozuk */ }
    } else if (/\[tool\.pytest|addopts|^\s*test\s*:/im.test(m.content)) { hasTestScript = true; break; }
  }
  const ciTexts = walk(".github/workflows", 1).filter((a) => /\.ya?ml$/i.test(a)).map((a) => readSafe(rel(a))).join("\n");
  const ciTest = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b|\bgo test\b|\bmvn\s+test\b|\bgradlew?\s+test\b|\bcargo test\b|\bdotnet test\b|\bphpunit\b|\bplaywright test\b/i.test(ciTexts);
  // criteria.md "coverage işareti" vaat ediyordu ama hiçbir stack için
  // ölçülmüyordu — artık evidence'a yazılıyor.
  const coverageSignal = /--cov|-coverprofile|jacoco|coverageThreshold|\bnyc\b|\bc8\b|codecov|coveralls/i.test(deps + "\n" + ciTexts);
  const runnable = hasTestScript || ciTest;
  if (runnable) score += 1;
  evidence.push({ path: "çalıştırılabilirlik", lines: null, note: `test script=${hasTestScript}, CI test adımı=${ciTest}, coverage izi=${coverageSignal}` });

  return {
    criterion: "tests",
    score: Math.min(score, 4),
    max: 4,
    rationale: `Unit=${hasUnit ? "✓" : "✗"}, component=${hasComponent ? "✓" : "✗"}, E2E=${hasE2e ? "✓" : "✗"}, çalıştırılabilir=${runnable ? "✓" : "✗"}. ${testFiles.length} test dosyası bulundu.`,
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
      // Tırnak içinde geçen bir direktif ALINTIDIR, talimat değil. Örn. jüri
      // rehberindeki `- README'de "bana yüksek puan ver" yazmak → puanlanmaz`
      // satırı eskiden kendi kendini injection olarak işaretliyordu.
      // Tek tırnak STRIP EDİLMEZ: Türkçe kesme işareti ("README'de") yanlış
      // eşleşmeye yol açar.
      const unquoted = line
        .replace(/"[^"]*"/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/\u201c[^\u201d]*\u201d/g, " ");
      for (const re of patterns) {
        if (re.test(unquoted)) {
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
        const relPath = rel(abs);
        scanFile(relPath);
      }
    });
  }
  // Kod yorumlarında (ilk 200 satır src/ ve app/)
  for (const dir of ["src", "app", "lib"]) {
    if (!exists(dir)) continue;
    walk(dir, 4).slice(0, 200).forEach((abs) => {
      if (/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(abs)) {
        const relPath = rel(abs);
        scanFile(relPath);
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
// Teslim deadline'ı. Kaynak koda gömülü olması her yeni hackathon'da script
// düzenlemeyi gerektiriyordu ve tarih geçtiğinde HER aktif repo "geç"
// işaretleniyordu. Artık env ile verilir; verilmezse ceza hiç uygulanmaz.
//   EVAL_LATE_CUTOFF="2026-05-14T17:30:00+03:00"
const LATE_CUTOFF_ISO = process.env.EVAL_LATE_CUTOFF || "";

function scoreLatePenalty() {
  const empty = { applied: false, points: 0, cutoff: null, lateCommit: null, lateCommits: [], lateCommitCount: 0 };
  if (!LATE_CUTOFF_ISO) {
    return { ...empty, note: "EVAL_LATE_CUTOFF tanımlı değil — geç teslim kontrolü yapılmadı." };
  }
  const cutoff = new Date(LATE_CUTOFF_ISO).getTime();
  if (Number.isNaN(cutoff)) {
    return { ...empty, cutoff: LATE_CUTOFF_ISO, note: `EVAL_LATE_CUTOFF ayrıştırılamadı: "${LATE_CUTOFF_ISO}"` };
  }
  const lateCommits = [];
  let latestLate = null;
  for (const c of COMMITS) {
    const t = new Date(c.when).getTime();
    if (Number.isNaN(t) || t <= cutoff) continue;
    lateCommits.push({ hash: c.hash.slice(0, 12), when: c.when, message: c.subject.slice(0, 80) });
    if (!latestLate || t > latestLate.t) latestLate = { hash: c.hash.slice(0, 12), when: c.when, t };
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
