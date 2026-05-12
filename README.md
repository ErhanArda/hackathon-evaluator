# 🏆 Hackathon Repo Evaluator

Sub-agent destekli, **API key gerektirmeyen** hackathon repo değerlendirme sistemi. Verilen GitHub repo'sunu **6 kriter** üzerinden puanlar, her kritere AI gerekçesi üretir, sonucu canlı dashboard ve Excel olarak sunar.

## Mimari

```
Operator (Claude Code lokal)
  └─ /evaluate <repo-url> team-id=<id>
       ├─ git clone
       ├─ 4 sub-agent PARALEL (Agent tool)
       │    • analist     (Explore)         → docs + readme
       │    • developer   (general-purpose) → temiz kod  [+ context7 MCP]
       │    • reviewer    (general-purpose) → mimari     [+ context7 MCP]
       │    • ai-evidence (Explore)         → AI/Agentic izler
       └─ POST → Vercel API
                   │
                   ▼
        Next.js 15 + Neon Postgres
        ├─ /            canlı leaderboard
        ├─ /teams/[id]  detay + AI gerekçesi
        ├─ /admin       takım CRUD
        └─ /api/export.xlsx
```

Detaylı mimari: [`docs/architecture.md`](docs/architecture.md)

## Kullanılan AI Tool'lar

- **Claude Code** (Opus 4.7) — geliştirme + sub-agent orchestrator
- Sub-agent tipleri: `Explore` (read-only), `general-purpose` (MCP'li)

## Kullanılan MCP Server'lar

Tanımlı: [`.mcp.json`](.mcp.json)

| MCP | Kullanım |
|-----|----------|
| **context7** | `developer` ve `reviewer` agent'ları kullanılan paketlerin doc'larını canlı çeker, kodu ona göre değerlendirir |

## Deploy

- **Vercel:** _(deploy edildikten sonra URL eklenecek — örn. `https://hackathon-evaluator.vercel.app`)_
- **DB:** Vercel Postgres (Neon) — ücretsiz tier
- Sekai akışı: `git push origin main` → otomatik deploy

## Kriterler (toplam 30 puan)

Detay: [`docs/criteria.md`](docs/criteria.md)

| # | Kriter | Max | Sub-agent |
|---|--------|-----|-----------|
| 1 | AI ile kodlama kanıtı | 5 | ai-evidence |
| 2 | Agentic kodlama yapısı | 5 | ai-evidence |
| 3 | Docs (plan + aşamalar) | 5 | analist |
| 4 | README.md kapsamı | 5 | analist |
| 5 | Temiz Kod | 5 | developer + context7 |
| 6 | Mimari | 5 | reviewer + context7 |

Her kriter için sub-agent: `score`, `rationale` (≥2 cümle), `evidence` (dosya:satır) döner.

## Hızlı Başlangıç (lokal)

```bash
# 1) Bağımlılıklar
cd apps/web
pnpm install

# 2) Env
cp .env.example .env.local
# .env.local içine POSTGRES_URL ve INGEST_TOKEN doldur

# 3) DB push (schema)
pnpm db:push

# 4) (opsiyonel) Seed 12 takım
pnpm seed

# 5) Dev
pnpm dev    # http://localhost:3000
```

## Değerlendirme Çalıştırma

Claude Code'u repo kökünde aç, sonra:

```
/evaluate https://github.com/ErhanArda/sekai team-id=t01
```

Skill 4 sub-agent'ı **paralel** çalıştırır (~30-60 sn), sonucu otomatik POST eder, dashboard satırı güncellenir.

`team-id` mevcut bir takıma karşılık gelmeli (aksi halde POST 4xx). `/admin`'den ekleyebilirsin.

## Test

UI smoke test:
```bash
cd apps/web
pnpm build       # production build (typecheck dahil)
pnpm dev         # canlı geliştirme
curl localhost:3000/api/teams
```

End-to-end (Vercel'e deploy sonrası):
1. `/admin` → token gir, "Takım 01" ekle (`t01`)
2. Claude Code'da `/evaluate https://github.com/ErhanArda/sekai team-id=t01`
3. `/` sayfasında satır 5 sn içinde puanlanır
4. `/api/export.xlsx` → Excel iner

## Yapı

```
hackathon/
├── apps/web/                      # Next.js 15 (Vercel deploy)
│   ├── app/                       # App Router (pages + API)
│   ├── components/                # Leaderboard, AdminPanel, vb.
│   ├── lib/                       # db, schema, queries, scoring, auth
│   └── drizzle.config.ts
├── docs/                          # plan, criteria, architecture, phases
├── scripts/                       # seed-teams, post-evaluation
├── .claude/
│   └── skills/evaluate-repo/      # SKILL.md + 4 agent prompt
├── .mcp.json                      # context7 MCP config
└── README.md
```

## Lisans

MIT (hackathon dahili kullanım için).

---
🤖 Bu sistem Claude Code + sub-agent + context7 MCP ile inşa edildi.
