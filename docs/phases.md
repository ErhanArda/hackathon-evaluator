# Geliştirme Aşamaları

| Faz | Süre | İçerik | Çıktı |
|-----|------|--------|-------|
| 1 | 1.5 sa | Next.js 15 + Tailwind + Drizzle iskeleti, ilk migration, Vercel ilk deploy | Boş leaderboard live |
| 2 | 1 sa | API: `/api/teams`, `/api/evaluations` (POST+GET), Bearer auth | curl ile manuel test |
| 3 | 1.5 sa | Dashboard: leaderboard, team detail, rationale drawer, /admin, polling | Tam UI çalışır |
| 4 | 30 dk | `/api/export.xlsx` — exceljs ile takım × kriter | "Excel indir" butonu |
| 5 | 1.5 sa | `.claude/skills/evaluate-repo/` — SKILL.md + 4 agent + context7 MCP | `/evaluate` çalışır |
| 6 | 30 dk | 12 takım seed + ErhanArda/sekai üzerinde end-to-end smoke | Dashboard'da gerçek puan |
| 7 | 30 dk | README, jüri linki, sıralama animasyonu | Hackathon-ready |

Toplam: ~7 saat (yarım gün hackathon hızında).
