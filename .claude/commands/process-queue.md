# /process-queue — Batch Eval Worker (per-agent live status)

Bekleyen `eval_requests`'i kuyruktan al, **batch=4 paralel**, her biri için 5 sub-agent (max 20 paralel). Sub-agent'lar **kendileri** DB'ye PATCH atarak canlı durum bildirir.

## Argümanlar (opsiyonel)
- `base` — varsayılan `http://localhost:3000`
- `batch` — varsayılan 4

## Akış

### 1. Pending'leri al
```bash
BASE=${base:-http://localhost:3000}
BATCH=${batch:-4}
curl -s "$BASE/api/eval-requests?status=pending&limit=$BATCH"
```
Boşsa → "Kuyruk boş" yaz, BIT.

### 2. Atomic claim her biri için
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"processing","expectFromStatus":"pending"}'
```
409 → başkası kapmış, atla.

### 3. agent_states'i 5 'pending' ile initialize
Her claimed request için:
```bash
for agent in analist developer reviewer ai-evidence tester; do
  curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID/agent-state" \
    -H "Content-Type: application/json" \
    -d "{\"agent\":\"$agent\",\"status\":\"pending\"}"
done
```

### 4. Takım + repo bilgileri
`GET /api/teams` → name + repoUrl.

### 5. Repoları klonla (paralel)
```bash
for r in claimed; do
  WORKDIR_$i=$(mktemp -d -t eval-XXXXXX)
  git clone --depth 50 "$REPO_URL" "$WORKDIR_$i/repo" &
done
wait
```

### 6. **TEK MESAJDA N×5 = 5-20 paralel Agent tool call**

Sub-agent prompt template'leri `.claude/skills/evaluate/agents/*.md` altında. **Her sub-agent prompt'unun başına ve sonuna mutlaka şunları ekle:**

#### Başlangıç (her sub-agent prompt'unun ÜSTÜ):
```
Çalışmaya başlamadan önce bu komutu Bash ile çalıştır:
curl -s -X PATCH "{BASE}/api/eval-requests/{REQ_ID}/agent-state" \
  -H "Content-Type: application/json" \
  -d '{"agent":"{AGENT_KEY}","status":"running"}'
```

#### Bitiş (her sub-agent prompt'unun SONUNA, JSON çıktıdan SONRA):
```
JSON çıktıyı verdikten SONRA bu komutu Bash ile çalıştır (SCORE değerini hesapladığın skorla doldur):
curl -s -X PATCH "{BASE}/api/eval-requests/{REQ_ID}/agent-state" \
  -H "Content-Type: application/json" \
  -d '{"agent":"{AGENT_KEY}","status":"done","score":SCORE}'
```

> NOT: analist ve ai-evidence agent'ları 2 kriter üretir; PATCH'te 2 kriterin skorlarının ortalaması veya bir özet değer kullanılabilir. Veya iki ayrı PATCH (agent: 'analist-docs', 'analist-readme'). En sade: agent kendi `{AGENT_KEY}` ile tek PATCH atar, score alanına ilk kriterin puanını yazar.

**KRİTİK:** 5-20 Agent call TEK asistan mesajında — paralel.

### 7. Aggregate + POST evaluation
Her takım için 7 madde'yi topla, ayrı POST:
```bash
curl -s -X POST "$BASE/api/evaluations" -d @payload_$i.json
```

### 8. Request'i done işaretle
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -d "{\"status\":\"done\",\"evaluationId\":\"$EVAL_ID\"}"
```

### 9. Workdir cleanup
```bash
rm -rf "$WORKDIR_"*
```

## /loop ile

```
/loop /process-queue
```
Her dakika fire → boşsa exit, pending varsa batch.

## Notlar
- agent_states sayesinde frontend her sub-agent'ın canlı durumunu görür
- Sub-agent başlangıç/bitiş PATCH'leri ~200ms ek yük (toplam ~%1 yavaşlama)
- Compare-and-swap claim ile aynı request iki kez işlenmez
