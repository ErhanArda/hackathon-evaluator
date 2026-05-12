# Mimari

## Genel Bakış

İki bağımsız bileşen var:

1. **Orchestrator (lokal Claude Code)** — `/evaluate` skill'i çalıştırılır, repo klonlanır, sub-agent'lar paralel koşar, sonuç merkezi DB'ye POST edilir.
2. **Web (Vercel)** — Next.js 15 + Postgres. Salt okunur jüri dashboard'u + Excel export. POST endpoint Bearer token ile korumalı.

```
┌──────────────── Operator (Claude Code) ──────────────────────┐
│  /evaluate <repo-url> team-id=tx                              │
│       │                                                        │
│       ├─ git clone --depth 50 → /tmp/eval-<sha>               │
│       ├─ Pre-scan: README, docs/, .claude/, package.json      │
│       ├─ Spawn 4 sub-agents IN PARALLEL (Agent tool):         │
│       │    • analist     (Explore)                            │
│       │    • developer   (general-purpose + context7 MCP)     │
│       │    • reviewer    (general-purpose + context7 MCP)     │
│       │    • ai-evidence (Explore)                            │
│       ├─ Aggregate JSONs                                      │
│       └─ POST $VERCEL_URL/api/evaluations  (Bearer)           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTPS
┌─────────────── Vercel: Next.js 15 + Neon Postgres ────────────┐
│  Pages:                                                        │
│    /              live leaderboard (5 sn polling)              │
│    /teams/[id]    detay + AI rationale + evidence              │
│    /admin         takım CRUD (token auth)                      │
│  API:                                                          │
│    POST /api/evaluations  (Bearer)                             │
│    GET  /api/evaluations  (public)                             │
│    /api/teams             (CRUD)                               │
│    /api/export.xlsx       (Excel)                              │
│  DB:                                                           │
│    teams, evaluations, criterion_scores, ai_rationales         │
└────────────────────────────────────────────────────────────────┘
```

## Neden API key'siz?

Vercel serverless function'da bir LLM çağırabilmek için API key gerekir. Kullanıcı API key kullanmayacağını belirtti. Bu yüzden **gerçek değerlendirme Claude Code lokal oturumunda Agent tool ile yapılır**, Vercel sadece sonuçları toplar/gösterir. Bonus: bu yaklaşım hackathon kriterinin kendisini (agentic yapı) gerçekten uygular.

## MCP Entegrasyonu

- **context7** → `developer` ve `reviewer` agent'larında zorunlu. Repo'nun `package.json`'undan ana 3 bağımlılığı çıkarır, context7 ile up-to-date doc'ları çeker, kodu o doc'a göre değerlendirir.
- **Consensus** → `reviewer` opsiyonel; mimari pattern tartışmalarında akademik referans.
- Takımın kendi repo'sundaki MCP kullanımı `ai-evidence` tarafından ayrı kriter olarak puanlanır.

## DB Şeması

```sql
teams (
  id            text primary key,
  name          text not null,
  repo_url      text not null,
  members       text[],
  created_at    timestamptz default now()
)

evaluations (
  id            text primary key,
  team_id       text references teams(id) on delete cascade,
  total_score   int not null,
  max_score     int not null default 30,
  evaluator     text not null,    -- 'claude-code'
  model_note    text,             -- agent listesi + sürüm
  created_at    timestamptz default now()
)

criterion_scores (
  id            text primary key,
  evaluation_id text references evaluations(id) on delete cascade,
  criterion     text not null,    -- 'temiz-kod', 'mimari', vb.
  score         int not null,
  max           int not null
)

ai_rationales (
  id                  text primary key,
  criterion_score_id  text references criterion_scores(id) on delete cascade,
  rationale           text not null,
  evidence            jsonb        -- [{path, lines, note}]
)
```

UI "latest evaluation per team" gösterir; tarihçe team detay sayfasında.

## Auth

- `POST /api/evaluations` → Bearer `INGEST_TOKEN` (env var, 32 char random).
- `/admin` ve takım CRUD → aynı token (basit cookie set).
- Public read: `/`, `/teams/[id]`, `GET /api/evaluations`, `/api/export.xlsx`.
