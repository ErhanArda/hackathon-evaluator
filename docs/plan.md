# Proje Planı (özet)

Detaylı plan: `~/.claude/plans/hackathon-folder-in-alt-na-stateless-metcalfe.md`

## Tek Cümle
Hackathon takımlarının GitHub repo'larını **Claude Code sub-agent'ları** ile (API key olmadan) puanlayan, sonuçları **Vercel + Neon Postgres** üzerinde canlı dashboard ve Excel olarak sunan değerlendirme sistemi.

## Bileşenler
- `apps/web/` — Next.js 15 dashboard + API (Vercel'e deploy)
- `.claude/skills/evaluate-repo/` — orchestrator skill + 4 sub-agent
- `docs/` — kriter, mimari, faz dokümantasyonu (kendi rubric'imizi karşılar)
- `scripts/` — seed, deploy yardımcı betikleri

## Kriterler
Bkz. `docs/criteria.md` — 6 kriter × 5 puan = 30 ham puan.

## Mimari
Bkz. `docs/architecture.md`.

## Deploy
Sekai akışı: `git push origin main` → Vercel auto-deploy. Postgres Vercel Storage'dan tek tıkla bağlanır.
