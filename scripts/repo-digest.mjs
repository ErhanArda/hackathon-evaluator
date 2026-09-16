#!/usr/bin/env node
// Repo özeti — LLM agent'ın KEŞİF turlarını eler.
//
// Agent'lar bugün aynı şeyleri her seferinde kendileri buluyor: en çok değişen
// dosyalar, fonksiyon uzunlukları, `any` sayısı, çıplak catch'ler, klasör
// yapısı. Ölçümde bu keşif agent başına 7-12 tool call demekti (~150 sn).
// Bu script aynı bilgiyi <1 sn'de deterministik üretir; agent hazır kanıtla
// başlayıp yalnız YARGI kısmına odaklanır.
//
// RUBRIC DEĞİŞMEZ. Bu bir skorlayıcı değil, kanıt toplayıcıdır — hiçbir puan
// hesaplamaz. Beş boyutun tamamını yine LLM puanlar.
//
// Kullanım:
//   node scripts/repo-digest.mjs <repo-path> [--json]
// Varsayılan çıktı agent prompt'una gömülecek markdown'dur.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { execFileSync } from "node:child_process";

const repo = process.argv[2];
const asJson = process.argv.includes("--json");
if (!repo || !existsSync(repo)) {
  console.error("usage: node repo-digest.mjs <repo-path> [--json]");
  process.exit(2);
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "target", ".venv",
  "venv", "__pycache__", "vendor", "coverage", ".turbo", ".cache", ".nuxt",
  ".svelte-kit", "Pods", ".gradle",
]);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte|dart|scala)$/i;
const GENERATED = /(\.min\.|\.generated\.|\.d\.ts$|-lock\.(json|yaml)$|\.pb\.go$|_pb2\.py$)/i;
const TESTY = /(^|\/)(tests?|__tests__|e2e|spec|cypress)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.go$/i;

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: repo, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
    }).toString();
  } catch { return ""; }
};
const read = (rel) => { try { return readFileSync(join(repo, rel), "utf8"); } catch { return ""; } };

// ---------- dosya envanteri ----------
let files = git("ls-files", "-z").split("\0").filter(Boolean);
if (files.length === 0) {
  const out = [];
  (function rec(dir, d) {
    if (d > 8) return;
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(join(dir, e.name), d + 1); }
      else out.push(relative(repo, join(dir, e.name)));
    }
  })(repo, 0);
  files = out;
}
files = files.filter((f) => !f.split("/").some((seg) => SKIP_DIRS.has(seg)));

const sourceFiles = files.filter((f) => CODE_EXT.test(f) && !GENERATED.test(f) && !TESTY.test(f));
const testFiles = files.filter((f) => CODE_EXT.test(f) && TESTY.test(f));

// ---------- fonksiyon uzunluğu + karmaşıklık ----------
// Girinti tabanlı: bir fonksiyon FN_START satırında başlar, kendisiyle aynı ya
// da daha az girintili ilk dolu satırda biter. Brace sayımı kullanılmıyor —
// string/template/regex içindeki `{` `}` karakterleri sayacı kaydırıyor ve
// ölçümde panel.js'teki 117 satırlık render() bu yüzden kaçmıştı.
const FN_START = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)|(?:private|public|protected|static)?\s*\w+\s*\([^)]*\)\s*\{|def\s+\w+|func\s+\w+)/;
const buckets = { "<20": 0, "20-40": 0, "40-60": 0, "60-100": 0, ">100": 0 };
const longFns = [];
let totalLoc = 0, maxDepth = 0, deepSites = 0;

const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;

for (const f of sourceFiles) {
  const text = read(f);
  if (!text || text.length > 900_000) continue;
  const lines = text.split("\n");
  totalLoc += lines.length;
  let fileMax = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    const ind = indentOf(l);
    fileMax = Math.max(fileMax, ind);
    if (ind >= 16) deepSites++;
  }
  maxDepth = Math.max(maxDepth, Math.floor(fileMax / 2));

  for (let i = 0; i < lines.length; i++) {
    if (!FN_START.test(lines[i])) continue;
    const base = indentOf(lines[i]);
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (indentOf(l) <= base) { end = j; break; }
    }
    const len = end - i + 1;
    if (len < 3) continue; // tek satırlık arrow/imza
    if (len < 20) buckets["<20"]++;
    else if (len < 40) buckets["20-40"]++;
    else if (len < 60) buckets["40-60"]++;
    else if (len < 100) buckets["60-100"]++;
    else buckets[">100"]++;
    if (len >= 60) longFns.push({ path: f, lines: `${i + 1}-${end + 1}`, len });
  }
}
longFns.sort((a, b) => b.len - a.len);

// ---------- type safety / hata yönetimi sinyalleri ----------
// Yorumları çıkar — yoksa `// reason: any other case` gibi düzyazı `any`
// sayılıyor ve type-safety sinyali yanlış çıkıyor (ölçümde 2 false positive).
const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/(^|[^:])\/\/.*$/gm, "$1")
   .replace(/^\s*#.*$/gm, " ");

const grepCount = (re, { code = true } = {}) => {
  let n = 0;
  const hits = [];
  for (const f of sourceFiles) {
    let t = read(f);
    if (!t) continue;
    if (code) t = stripComments(t);
    const m = t.match(re);
    if (m) { n += m.length; if (hits.length < 6) hits.push(`${f} (${m.length})`); }
  }
  return { n, hits };
};
const anyUse = grepCount(/:\s*any\b|as\s+any\b|<any>|\bany\[\]/g);
const nonNull = grepCount(/\w\![.[(]/g);
const bareCatch = grepCount(/catch\s*\{/g);
const catchWithErr = grepCount(/catch\s*\([^)]+\)\s*\{/g);
const todos = grepCount(/\b(TODO|FIXME|HACK|XXX)\b/g, { code: false });
const consoleUse = grepCount(/console\.(log|error|warn|info)/g);
const shortIdents = grepCount(/\b(?:const|let|var)\s+[a-z]{1,2}\b/g);

// tsconfig katılığı
let tsStrict = null;
for (const f of files.filter((x) => /tsconfig(\.\w+)?\.json$/.test(basename(x)))) {
  const t = read(f);
  if (!t) continue;
  const flags = ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "noImplicitOverride", "noImplicitAny"]
    .filter((k) => new RegExp(`"${k}"\\s*:\\s*true`).test(t));
  if (flags.length) { tsStrict = { path: f, flags }; break; }
}

// lint/format konfigürasyonu
const lintCfg = files.filter((f) => /^(\.eslintrc|eslint\.config|\.prettierrc|biome\.json|ruff\.toml|\.flake8)/.test(basename(f)));

// ---------- env / secret ----------
const envExample = files.find((f) => /^\.env\.(example|sample|template)$/.test(basename(f)));
const envCommitted = files.filter((f) => /^\.env(\.local|\.production)?$/.test(basename(f)));
const SECRET_RE = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,})/;
const secretHits = [];
for (const f of sourceFiles.concat(files.filter((x) => /\.(env|ya?ml|json|toml)$/i.test(x)))) {
  const t = read(f);
  const m = t && t.match(SECRET_RE);
  if (m) secretHits.push(`${f}: ${m[0].slice(0, 12)}…`);
  if (secretHits.length >= 5) break;
}

// ---------- klasör yapısı ----------
const dirs = [...new Set(files.map((f) => f.split("/").slice(0, -1).join("/")).filter(Boolean))].sort();
const topDirs = [...new Set(files.map((f) => f.split("/")[0]))].sort();

// ---------- git: churn + commit ----------
const SEP = String.fromCharCode(30), FS = String.fromCharCode(31);
const commits = git("log", "--format=%x1e%H%x1f%cI%x1f%an%x1f%s%x1f%B")
  .split(SEP).filter((r) => r.trim()).map((r) => {
    const p = r.split(FS);
    return { hash: p[0], when: p[1], author: p[2], subject: p[3], body: p[4] || "" };
  }).filter((c) => c.hash);

const churn = {};
for (const l of git("log", "--pretty=format:", "--name-only").split("\n")) {
  const t = l.trim();
  if (t) churn[t] = (churn[t] || 0) + 1;
}
const hotFiles = sourceFiles
  .map((f) => ({ f, c: churn[f] || 0, loc: (read(f).match(/\n/g) || []).length + 1 }))
  .sort((a, b) => b.c - a.c || b.loc - a.loc)
  .slice(0, 12);

// ---------- manifest ----------
const manifests = files
  .filter((f) => /^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|requirements\.txt|composer\.json|Gemfile)$/.test(basename(f)))
  .slice(0, 8)
  .map((f) => ({ path: f, head: read(f).split("\n").slice(0, 40).join("\n") }));

const digest = {
  inventory: {
    trackedFiles: files.length,
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    totalLoc,
    topDirs,
    dirCount: dirs.length,
  },
  complexity: {
    functionLengthBuckets: buckets,
    over60: longFns.length,
    longest: longFns.slice(0, 12),
    maxIndentDepth: maxDepth,
    deeplyIndentedLines: deepSites,
  },
  typeSafety: {
    anyUsages: anyUse.n, anyHits: anyUse.hits,
    nonNullAssertions: nonNull.n,
    bareCatch: bareCatch.n, bareCatchHits: bareCatch.hits,
    catchWithBinding: catchWithErr.n,
    consoleCalls: consoleUse.n,
    todoMarkers: todos.n, todoHits: todos.hits,
    shortIdentifiers: shortIdents.n,
    tsconfigStrictness: tsStrict,
    lintConfig: lintCfg.length ? lintCfg : null,
  },
  config: {
    envExample: envExample ?? null,
    envFilesCommitted: envCommitted,
    hardcodedSecretHits: secretHits,
  },
  git: {
    totalCommits: commits.length,
    coAuthoredCommits: commits.filter((c) => /co-authored-by/i.test(c.body)).length,
    authors: [...new Set(commits.map((c) => c.author))].slice(0, 10),
    firstCommit: commits.at(-1)?.when ?? null,
    lastCommit: commits[0]?.when ?? null,
    hotFiles,
  },
  manifests,
};

if (asJson) {
  console.log(JSON.stringify(digest, null, 2));
  process.exit(0);
}

// ---------- markdown (agent prompt'una gömülecek) ----------
const d = digest;
const L = [];
L.push("### Ön-hesaplanmış repo kanıtı");
L.push("");
L.push("Bu veriler deterministik olarak ölçüldü — tekrar toplaman gerekmiyor.");
L.push("Yargı senin: aşağıdaki sayıların **iyi mi kötü mü** olduğuna sen karar ver.");
L.push("");
L.push(`**Envanter:** ${d.inventory.sourceFiles} kaynak dosya, ${d.inventory.testFiles} test dosyası, ${d.inventory.totalLoc} satır, ${d.inventory.dirCount} klasör`);
L.push(`**Üst klasörler:** ${d.inventory.topDirs.join(", ")}`);
L.push("");
L.push("**Fonksiyon uzunluğu dağılımı:** " + Object.entries(d.complexity.functionLengthBuckets).map(([k, v]) => `${k}:${v}`).join("  "));
L.push(`**60 satırı aşan fonksiyon:** ${d.complexity.over60} · en derin girinti ~${d.complexity.maxIndentDepth} seviye · 16+ boşluk girintili satır: ${d.complexity.deeplyIndentedLines}`);
if (d.complexity.longest.length) {
  L.push("");
  L.push("| Fonksiyon | Satır | Uzunluk |");
  L.push("|---|---|---|");
  for (const f of d.complexity.longest.slice(0, 8)) L.push(`| \`${f.path}\` | ${f.lines} | ${f.len} |`);
}
L.push("");
const ts = d.typeSafety;
L.push(`**Type safety:** \`any\` kullanımı **${ts.anyUsages}**${ts.anyHits.length ? ` (${ts.anyHits.join(", ")})` : ""} · non-null \`!\` assertion ${ts.nonNullAssertions}`);
L.push(`**Hata yönetimi:** çıplak \`catch {}\` **${ts.bareCatch}**${ts.bareCatchHits.length ? ` (${ts.bareCatchHits.join(", ")})` : ""} · hata değişkenli catch ${ts.catchWithBinding} · console çağrısı ${ts.consoleCalls}`);
L.push(`**İşaretler:** TODO/FIXME ${ts.todoMarkers}${ts.todoHits.length ? ` (${ts.todoHits.join(", ")})` : ""} · 1-2 harfli yerel değişken ~${ts.shortIdentifiers}`);
L.push(`**tsconfig katılığı:** ${ts.tsconfigStrictness ? `${ts.tsconfigStrictness.path} → ${ts.tsconfigStrictness.flags.join(", ")}` : "bulunamadı"}`);
L.push(`**Lint/format konfigürasyonu:** ${ts.lintConfig ? ts.lintConfig.join(", ") : "**YOK**"}`);
L.push("");
L.push(`**Env/config:** .env.example ${d.config.envExample ?? "**yok**"} · commit'lenmiş .env: ${d.config.envFilesCommitted.length ? d.config.envFilesCommitted.join(", ") : "yok"} · hardcoded secret: ${d.config.hardcodedSecretHits.length ? d.config.hardcodedSecretHits.join("; ") : "bulunamadı"}`);
L.push("");
L.push(`**Git:** ${d.git.totalCommits} commit, ${d.git.coAuthoredCommits} tanesi co-author'lı · yazarlar: ${d.git.authors.join(", ")}`);
L.push("");
L.push("**En çok değişen kaynak dosyalar (churn × büyüklük):**");
L.push("");
L.push("| Dosya | Değişim | Satır |");
L.push("|---|---|---|");
for (const h of d.git.hotFiles.slice(0, 10)) L.push(`| \`${h.f}\` | ${h.c} | ${h.loc} |`);
L.push("");
for (const m of d.manifests.slice(0, 3)) {
  L.push(`**\`${m.path}\`:**`);
  L.push("```");
  L.push(m.head);
  L.push("```");
}
console.log(L.join("\n"));
