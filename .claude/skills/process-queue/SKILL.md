---
name: process-queue
description: Bekleyen evaluation request'lerini batch al (max 4 paralel), her biri için 4 sub-agent paralel başlat (toplam 16 paralel agent), sonuçları yaz. Kullanım. /process-queue [base=http://localhost:3000]
---

# /process-queue — Batch Eval Worker

Bu skill `/api/eval-requests`'ten **pending** request'leri toplu alır, **batch (max 4)** halinde **paralel** işler. Her request için 4 sub-agent → bir batch'te 16 paralel agent çağrısı.

## Argümanlar
- `base` (opsiyonel) — varsayılan `http://localhost:3000`. Prod için Vercel URL'i.
- `batch` (opsiyonel) — varsayılan 4. Max paralel request sayısı.

## Algoritma

### 1. Pending'leri al
```bash
BASE=${base:-http://localhost:3000}
BATCH=${batch:-4}
curl -s "$BASE/api/eval-requests?status=pending&limit=$BATCH"
```

Boşsa: "Kuyruk boş, çıkıyorum." → BIT.

### 2. Her birini atomic claim
Her request için ayrı PATCH (compare-and-swap):
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"processing","expectFromStatus":"pending"}'
```
409 dönenleri (başkası kapmış) listeden çıkar.

### 3. Takım bilgilerini topla
Tek `GET /api/teams` ile tüm takımları çek, claim edilen request'lerin teamId'lerine eşle.

### 4. Repo'ları klonla (paralel, bash background ile)
```bash
for r in claimed; do
  WORKDIR_$i=$(mktemp -d -t eval-XXXXXX)
  git clone --depth 50 "$REPO_URL" "$WORKDIR_$i/repo" &
done
wait
```

Hata olan repo için (private/404): rationale "Repo erişilemedi" ile 6×0 puan POST + mark done.

### 5. **PARALEL SUB-AGENT** — TEK MESAJDA 16 ADET Agent tool call

İçinde N claimed request varsa, **tek bir asistan mesajında N×4 = 4-16 Agent tool call** yap. Sub-agent prompt template'leri: `.claude/skills/evaluate/agents/*.md` — yer tutucuları (REPO_PATH, REPO_SUMMARY, TOP_DEPS, GIT_LOG) her takım için doldur.

Per takım:
- Agent: `analist` (Explore) — `agents/analist.md`
- Agent: `developer` (general-purpose) — `agents/developer.md`
- Agent: `reviewer` (general-purpose) — `agents/reviewer.md`
- Agent: `ai-evidence` (Explore) — `agents/ai-evidence.md`

> **KRİTİK:** Hepsi TEK mesaj. 16 Agent call paralel başlar.

### 6. Sonuçları topla ve POST et
Her takım için 6 madde'yi aggregate et, total hesapla. Sonra her takım için ayrı POST:
```bash
curl -X POST "$BASE/api/evaluations" -d @payload_$i.json
```
Dönen `id`'yi sakla.

### 7. Her request'i mark done
```bash
curl -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -d "{\"status\":\"done\",\"evaluationId\":\"$EVAL_ID\"}"
```

### 8. Workdir'leri temizle
```bash
rm -rf "$WORKDIR_"*
```

### 9. Operator'a tek tablo özeti
```
✓ ardas    24/30  eval=abc123
✓ hacker   12/30  eval=def456
✓ team5    18/30  eval=ghi789
✗ team7    failed: repo private
```

## /loop ile kullanım

```
/loop /process-queue
```
Her dakika fire → boşsa hemen exit (idle), 1+ pending varsa batch işler.

## /loop birden fazla terminal (linear scale)
N tane terminal aç, her birinde `/loop /process-queue`. Atomic claim sayesinde aynı request iki kez işlenmez. 12 takım için 3 terminal ≈ 2-3 dk.

## Notlar
- **Tek terminal + batch=4**: 12 takım ~5-10 dk (cron tetiklenmek için REPL idle olmalı).
- **Tek terminal + batch=12**: tek mesajda 48 sub-agent — Anthropic rate limit + makine yükü. Önerilmez.
- **3 terminal + batch=4**: 12 takım ~2-5 dk. Hackathon günü için optimal.
- Sub-agent'lar Explore/general-purpose, read-only.
- Private repo'lar `gh` auth ile klonlanır.
