# Deploy Talimatları

## 1) GitHub'a push

`gh` CLI tokeni geçersiz görünüyor. İki seçenek:

### A) gh ile yeniden auth + push
```bash
gh auth login -h github.com
# Tarayıcı açılır, ErhanArda hesabıyla devam et.

cd /Users/TCERARDA/desktop/hackathon
gh repo create ErhanArda/hackathon-evaluator --public --source=. --push
```

### B) Manuel HTTPS push
GitHub'da boş `hackathon-evaluator` reposu oluştur, sonra:
```bash
cd /Users/TCERARDA/desktop/hackathon
git remote add origin https://github.com/ErhanArda/hackathon-evaluator.git
git push -u origin main
```

## 2) Vercel'e bağla

1. <https://vercel.com/new> aç → "Import Git Repository"
2. ErhanArda/hackathon-evaluator → Import
3. **Root Directory:** `apps/web` (önemli — proje monorepo)
4. Framework: Next.js (otomatik tespit)
5. Build/Output ayarlarını değiştirme (default OK)
6. Deploy butonuna basma — önce env eklemek için Settings'e git

## 3) Postgres bağla (Neon free tier)

Vercel project → **Storage** sekmesi → **Create Database** → **Postgres** (Neon).
Plan: Hobby (free). Region: en yakın (Frankfurt için `iad1` yerine `fra1` öneririm).

Oluşunca otomatik olarak şu env'ler enjekte edilir:
- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_PRISMA_URL`
- vb.

Bizim kod `POSTGRES_URL`'i okuyor, başka bir şey gerekmez.

## 4) `INGEST_TOKEN` env ekle

Project → **Settings → Environment Variables** → Add:
- `INGEST_TOKEN` = `<32 karakter random string>`
- Production + Preview + Development işaretli olsun.

Random üret:
```bash
openssl rand -hex 16
```

## 5) İlk deploy

Settings'ten ana sayfaya dön → **Deployments** → **Redeploy** (veya `git push` ile tetikle).

İlk deploy ~1 dk. Bittiğinde dashboard URL'si: `https://hackathon-evaluator-<hash>.vercel.app`

## 6) DB schema'yı push et

İki yol:

### A) Lokalden (önerilen, hızlı)
Vercel dashboard'dan `POSTGRES_URL`'i kopyala. Lokalde:
```bash
cd apps/web
echo "POSTGRES_URL=postgresql://..." > .env.local
echo "INGEST_TOKEN=<aynı token>" >> .env.local
pnpm db:push
```

`drizzle-kit push` schema'yı doğrudan oluşturur (migration dosyası üretmeden).

### B) Vercel build sırasında
`apps/web/package.json` build scriptini güncelle:
```json
"build": "drizzle-kit push && next build"
```
Bu her deploy'da push çalıştırır (idempotent, yeni tablo varsa ekler). Daha kalıcı.

## 7) Seed (opsiyonel)

12 örnek takım için:
```bash
cd /Users/TCERARDA/desktop/hackathon
EVALUATOR_API_BASE=https://your-app.vercel.app \
INGEST_TOKEN=<token> \
node --import tsx scripts/seed-teams.ts
```

veya `/admin` sayfasından elle ekle.

## 8) Smoke test

```bash
# 1) Takımları gör
curl https://your-app.vercel.app/api/teams

# 2) Bir değerlendirme POST et (manuel)
curl -X POST https://your-app.vercel.app/api/evaluations \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "teamId": "t01",
    "evaluator": "manual",
    "scores": [
      {"criterion":"docs","score":4,"max":5,"rationale":"Docs var ama plan eksik. Phases dosyası iyi.","evidence":[]},
      {"criterion":"readme","score":3,"max":5,"rationale":"README minimal.","evidence":[]},
      {"criterion":"clean-code","score":4,"max":5,"rationale":"Genel olarak temiz, birkaç any.","evidence":[]},
      {"criterion":"architecture","score":4,"max":5,"rationale":"Klasör yapısı net.","evidence":[]},
      {"criterion":"ai-evidence","score":2,"max":5,"rationale":"Az co-author.","evidence":[]},
      {"criterion":"agentic","score":3,"max":5,"rationale":".claude/ var ama MCP yok.","evidence":[]}
    ]
  }'

# 3) Dashboard'da kontrol
open https://your-app.vercel.app/
```

## 9) /evaluate skill'ini hazırla (lokal)

Claude Code'u repo kökünde aç:
```bash
cd /Users/TCERARDA/desktop/hackathon
claude
```

Env değişkenlerini set et:
```bash
export EVALUATOR_API_BASE=https://your-app.vercel.app
export INGEST_TOKEN=<aynı token>
```

Skill çağrısı:
```
/evaluate https://github.com/ErhanArda/sekai team-id=t01
```

Skill `Bash`, `Read`, `Agent` tool'larını kullanır, ~30-60 sn'de tamamlar, dashboard'da satır puanlanır.
