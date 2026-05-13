---
name: process-queue
description: Bekleyen evaluation request'lerini batch al, her biri için deterministik script (5 kriter, <2sn) + 2 paralel LLM agent (developer+reviewer) çalıştır, sonuçları yaz. Kullanım. /process-queue [base=http://localhost:3000]
---

# /process-queue — Batch Eval Worker (deterministik + LLM hibrit)

Bu skill `/api/eval-requests`'ten **pending** request'leri toplu alır, **batch (max 4)** halinde **paralel** işler. Her request için:
- 5 kriter (docs, readme, ai-evidence, agentic, tests) → `scripts/eval-deterministic.mjs` ile anında
- 2 kriter (clean-code, architecture) → tek mesajda paralel LLM sub-agent

Bir batch'te toplam **2N paralel LLM çağrısı** (N=batch). Aynı repo için skor **tutarlıdır** (LLM yalnız 2 yargı kriterinde küçük varyans).

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

Hata olan repo için (private/404): rationale "Repo erişilemedi" ile 7×0 puan POST + mark done. (Script çağırma — repo path yok)

### 5a. Deterministik skorlar (script) — paralel her takım için

Her takım için ayrı Bash background:
```bash
node /Users/tcerarda/Desktop/hackathon/scripts/eval-deterministic.mjs "$WORKDIR/repo" > /tmp/det-$REQ_ID.json
```
Wait, parse. 5 kriter (docs, readme, ai-evidence, agentic, tests) anında hazır. UI rozetlerini PATCH'le (analist/ai-evidence/tester agent-state'leri = done, score = ilgili kriter skoru).

`securityScan.detected === true` ise modelNote'a "⚠ prompt-injection N hit" ekle.

### 5b. **PARALEL LLM SUB-AGENT** — TEK MESAJDA 2N Agent call

N claimed request → tek asistan mesajında N×2 = 2-8 Agent tool call:

Per takım:
- Agent: `developer` (general-purpose) — `agents/developer.md` → `clean-code`
- Agent: `reviewer` (general-purpose) — `agents/reviewer.md` → `architecture`

> **KRİTİK:** Hepsi TEK mesaj. 2N Agent call paralel başlar. developer/reviewer agent-state'leri running→done PATCH'lenir (script orchestrator'dan).

> Eski analist/ai-evidence/tester agent'ları **artık çağrılmaz** — script onların yerini aldı.

### 6. Sonuçları topla ve POST et
Her takım için 7 madde'yi aggregate et (5 script + 2 LLM), total hesapla. Sonra her takım için ayrı POST:
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
✓ ardas    78/100  eval=abc123
✓ hacker   42/100  eval=def456
✓ team5    60/100  eval=ghi789
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
- **Tek terminal + batch=12**: tek mesajda 60 sub-agent — Anthropic rate limit + makine yükü. Önerilmez.
- **3 terminal + batch=4**: 12 takım ~2-5 dk. Hackathon günü için optimal.
- Sub-agent'lar Explore/general-purpose, read-only.
- Private repo'lar `gh` auth ile klonlanır.
