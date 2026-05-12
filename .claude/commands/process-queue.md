# /process-queue — Batch Eval Worker

Bekleyen `eval_requests`'i kuyruktan al, **batch=4 paralel**, her biri için 4 sub-agent = max 16 paralel agent ile değerlendir.

## Argümanlar (opsiyonel)
- `base` — varsayılan `http://localhost:3000`. Prod için Vercel URL.
- `batch` — varsayılan 4.

## Akış

### 1. Pending'leri al
```bash
BASE=${base:-http://localhost:3000}
BATCH=${batch:-4}
curl -s "$BASE/api/eval-requests?status=pending&limit=$BATCH"
```
Boşsa → "Kuyruk boş" yaz, BIT.

### 2. Her birini atomic claim et
Her request için ayrı PATCH (`expectFromStatus=pending`):
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"processing","expectFromStatus":"pending"}'
```
409 → başkası kapmış, listeden çıkar.

### 3. Takım bilgilerini al
`GET /api/teams` → tek seferde tüm takımlar, claimed request'lerin teamId'lerine eşle (name + repoUrl).

### 4. Repoları klonla (bash paralel)
```bash
for r in claimed; do
  WORKDIR_$i=$(mktemp -d -t eval-XXXXXX)
  git clone --depth 50 "$REPO_URL" "$WORKDIR_$i/repo" &
done
wait
```
Hata olanlar için 6×0 puan rationale "Repo erişilemedi" ile POST + done.

### 5. **TEK MESAJDA N×4 = 4-16 paralel Agent tool call**

Sub-agent prompt template'leri `.claude/skills/evaluate/agents/*.md` altında. Her takım için 4 agent (analist, developer, reviewer, ai-evidence). Yer tutucuları (REPO_PATH, REPO_SUMMARY, TOP_DEPS, GIT_LOG) per takım doldur.

> **KRİTİK:** Hepsi TEK asistan mesajında — paralel başlar.

### 6. Aggregate + POST
Her takım için 6 madde'yi topla, total hesapla, ayrı POST:
```bash
curl -s -X POST "$BASE/api/evaluations" -d @payload_$i.json
```

### 7. Her request'i done işaretle
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -d "{\"status\":\"done\",\"evaluationId\":\"$EVAL_ID\"}"
```

### 8. Workdir cleanup
```bash
rm -rf "$WORKDIR_"*
```

### 9. Operator özeti
```
✓ takım1   24/30  eval=abc
✓ takım2   12/30  eval=def
✗ takım3   failed: repo private
```

## /loop ile

```
/loop /process-queue
```
Her dakika fire. Boşsa hemen exit. 1+ pending varsa batch.

## Notlar
- Tek terminal + batch=4: 12 takım ~5-10 dk (cron için REPL idle olmalı)
- 3 terminal: ~2-5 dk
- Sub-agent'lar Explore/general-purpose, read-only
- Private repo'lar gh auth ile
