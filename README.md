# 🏆 Hackathon Repo Evaluator

Sub-agent destekli, **API key gerektirmeyen** hackathon repo değerlendirme sistemi. Verilen GitHub repo'sunu **7 kriter** üzerinden 100 puan üstünden puanlar, her kritere AI gerekçesi üretir, sonucu canlı dashboard ve Excel olarak sunar.

## Mimari

```
Operator (Claude Code lokal)
  └─ /evaluate <repo-url> team-id=<id>      (tek takım)
  └─ /process-queue                          (kuyruktan batch=4, takım başına 5 agent)
       ├─ git clone
       ├─ 5 sub-agent PARALEL (Agent tool, tek mesajda)
       │    • analist     (Explore)         → docs + readme
       │    • developer   (general-purpose) → temiz kod  [+ context7 MCP]
       │    • reviewer    (general-purpose) → mimari     [+ context7 MCP]
       │    • ai-evidence (Explore)         → AI/Agentic izler
       │    • tester      (Explore)         → unit + RTL + E2E
       └─ POST → Vercel API
                   │
                   ▼
        Next.js 15 + Neon Postgres
        ├─ /            canlı leaderboard
        ├─ /teams/[id]  detay + AI gerekçesi + per-agent canlı durum
        ├─ /admin       takım CRUD + kuyruk paneli
        └─ /api/export.xlsx
```

Her sub-agent çalışırken kendi durumunu `/api/eval-requests/:id/agent-state` üzerinden DB'ye PATCH'ler — UI her agent için canlı `pending → running → done` rozeti gösterir.

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
- Sekai akışı: `git push origin main` → otomatik deploy + `pnpm db:push` (build script'i tetikler)

## Kriterler (toplam 100 puan)

Detay: [`docs/criteria.md`](docs/criteria.md)

| # | Kriter | Max | Sub-agent |
|---|--------|-----|-----------|
| 1 | AI ile kodlama kanıtı | 20 | ai-evidence |
| 2 | Agentic kodlama yapısı | 20 | ai-evidence |
| 3 | Docs (plan + aşamalar) | 14 | analist |
| 4 | README.md kapsamı | 14 | analist |
| 5 | Temiz Kod | 14 | developer + context7 |
| 6 | Mimari | 14 | reviewer + context7 |
| 7 | Testler (unit + RTL + E2E) | 4 | tester |

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

Claude Code'u repo kökünde aç, sonra iki kullanım var:

**Tek takım (interaktif):**
```
/evaluate https://github.com/ErhanArda/sekai team-id=t01
```

**Kuyruktan batch (production akış):**
```
/process-queue
```
Pending eval-request'leri batch=4 paralel alır, her biri için 5 sub-agent → bir mesajda toplam 20 paralel Agent call. `/loop /process-queue` ile dakikada bir tetiklenip kuyruğu boşaltır.

Skill 5 sub-agent'ı **paralel** çalıştırır (~30-60 sn/takım), sonucu otomatik POST eder, dashboard satırı + per-agent rozet canlı güncellenir.

`team-id` mevcut bir takıma karşılık gelmeli (aksi halde POST 4xx). `/admin`'den ekleyebilirsin.

## Test

UI smoke test:
```bash
cd apps/web
pnpm build       # production build (typecheck + db:push dahil)
pnpm dev         # canlı geliştirme
curl localhost:3000/api/teams
```

End-to-end (Vercel'e deploy sonrası):
1. `/admin` → token gir, "Takım 01" ekle (`t01`)
2. Claude Code'da `/evaluate https://github.com/ErhanArda/sekai team-id=t01`
3. `/` sayfasında satır 5 sn içinde puanlanır (örn. `78/100`)
4. `/teams/t01` detayında 5 agent için canlı durum + her kriterin AI gerekçesi
5. `/api/export.xlsx` → Excel iner

## Yapı

```
hackathon/
├── apps/web/                              # Next.js 15 (Vercel deploy)
│   ├── app/                               # App Router (pages + API)
│   ├── components/                        # Leaderboard, AdminPanel, EvaluateButton
│   ├── lib/                               # db, schema, queries, scoring, auth, criteria
│   └── drizzle.config.ts
├── docs/                                  # plan, criteria, architecture, phases
├── scripts/                               # seed-teams, post-evaluation, maybe-db-push
├── .claude/
│   ├── commands/process-queue.md          # /process-queue slash command
│   └── skills/
│       ├── evaluate/                      # /evaluate skill (tek takım)
│       │   ├── SKILL.md
│       │   └── agents/                    # 5 sub-agent prompt
│       │       ├── analist.md
│       │       ├── developer.md
│       │       ├── reviewer.md
│       │       ├── ai-evidence.md
│       │       └── tester.md
│       └── process-queue/                 # /process-queue skill (batch)
├── .mcp.json                              # context7 MCP config
└── README.md
```

## Lisans

MIT (hackathon dahili kullanım için).

---
🤖 Bu sistem Claude Code + 5 paralel sub-agent + context7 MCP ile inşa edildi.
