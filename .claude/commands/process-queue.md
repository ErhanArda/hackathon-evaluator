# /process-queue — Batch Eval Worker (deterministik + LLM hibrit, per-agent live status)

Bekleyen `eval_requests`'i kuyruktan al, **batch=4 paralel**, her biri için 5 kriter deterministik script (<2 sn) + 2 LLM sub-agent (developer+reviewer, max 8 paralel). Script orchestrator, deterministik kriterler için agent-state'leri anında "done" PATCH'ler; LLM agent'lar kendi durumlarını PATCH eder.

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
Her claimed request için (UI rozetleri için 5 satır — analist/ai-evidence/tester deterministik script tarafından, developer/reviewer LLM tarafından):
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

Tüm workdir'ler **tek kök** altında, request id ile isimlendirilmiş. İndeksli değişken yok.

```bash
set -u
ROOT=$(mktemp -d -t evalbatch-XXXXXX)
export GIT_TERMINAL_PROMPT=0            # private repo'da kimlik sorma, 128 ile çık

for REQ_ID in $CLAIMED_IDS; do
  mkdir -p "$ROOT/$REQ_ID"
  git clone --depth 50 --single-branch --no-tags "$REPO_URL_FOR_REQ" "$ROOT/$REQ_ID/repo" &
done
wait
```

> **ASLA** `WORKDIR_$i=$(mktemp -d)` yazma — geçerli bir kabuk ataması değil (exit 127) ve Bash aracında shell state çağrılar arası korunmadığı için indeksli değişken zaten taşınmaz.

### 6a. Deterministik script (her takım için paralel Bash background)
```bash
node "$CLAUDE_PROJECT_DIR/scripts/eval-deterministic.mjs" "$ROOT/$REQ_ID/repo" > "$ROOT/$REQ_ID/det.json" &
```

> Yol **repoya göre**. Mutlak yol yazma: makinede `~/Desktop/hackathon` adında bu projenin eski bir klonu var ve mutlak yol sessizce onu çalıştırır.
Bekle, parse et. 5 kriter (docs, readme, ai-evidence, agentic, tests) anında elde. analist/ai-evidence/tester agent-state'lerini "done" + ilgili skor ile PATCH et (UI canlı yeşillenir).

`securityScan.detected` ise modelNote'a uyarı ekle.

### 6b. **TEK MESAJDA N×2 = 2-8 paralel LLM Agent tool call**

Yalnızca **developer + reviewer**. Prompt template'leri `.claude/skills/evaluate/agents/{developer,reviewer}.md`. **Her sub-agent prompt'unun başına ve sonuna mutlaka şunları ekle:**

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

**KRİTİK:** 2-8 LLM Agent call TEK asistan mesajında — paralel.

### 7. Aggregate + POST evaluation
Her takım için 7 madde'yi topla (5 script + 2 LLM), ayrı POST:
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
# Tek kök, glob yok. Guard: beklenmeyen yolda silme.
case "$ROOT" in
  /var/folders/*|/tmp/*) [ -n "$ROOT" ] && rm -rf "$ROOT" ;;
  *) echo "temizlik atlandi — beklenmeyen ROOT: '$ROOT'" >&2 ;;
esac
```

> **Glob kullanma.** `rm -rf "$WORKDIR_"*` değişken tanımsızken `rm -rf *`'a genişler ve komutun çalıştığı dizini — proje kökünü — siler.

## /loop ile

```
/loop /process-queue
```
Her dakika fire → boşsa exit, pending varsa batch.

## Notlar
- agent_states sayesinde frontend her sub-agent'ın canlı durumunu görür
- Sub-agent başlangıç/bitiş PATCH'leri ~200ms ek yük (toplam ~%1 yavaşlama)
- Compare-and-swap claim ile aynı request iki kez işlenmez
