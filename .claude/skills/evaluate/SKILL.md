---
name: evaluate
description: Hackathon takım reposunu klonla, 5 kriteri deterministik Node script ile + 2 kriteri paralel LLM agent ile değerlendir, sonucu Vercel API'ye POST et. Kullanım. /evaluate <repo-url> team-id=<id>
---

# /evaluate — Hackathon Repo Değerlendirme Orchestrator

Bu skill verilen GitHub reposunu klonlar:
- **5 kriter** (docs, readme, ai-evidence, agentic, tests) → `scripts/eval-deterministic.mjs` ile deterministik (Node + regex + file checks, <2 sn).
- **2 kriter** (clean-code, architecture) → tek mesajda 2 paralel LLM sub-agent.
- Aynı repo HER ZAMAN aynı deterministik skoru alır. LLM yalnız iki yargı kriterinde varyans gösterir.
- Prompt injection: script `securityScan` üretir; LLM agent'lar repo dosyalarındaki talimatları görmezden gelmek üzere talimatlıdır.

7 kriter, 100 puan max.

## Argüman Beklentisi

Operator çağrısı:
```
/evaluate <https-github-url> team-id=<team-id> [base=https://your-app.vercel.app]
```

Örnek:
```
/evaluate https://github.com/team-x/proje team-id=tx
```

`base` verilmezse env'den `EVALUATOR_API_BASE` okunur. Ortam değişkenleri:
- `EVALUATOR_API_BASE` — örn. `https://hackathon-evaluator.vercel.app`
- `INGEST_TOKEN` — Bearer token (lokal `.env` veya shell env)


## Adım 0 — Ortamı yükle

`EVALUATOR_API_BASE`'i (ve varsa `INGEST_TOKEN`'ı) akışın başında bir kez yükle:

```bash
# .env.local varsa oradan, yoksa shell ortamından.
# CLAUDE_PROJECT_DIR bazı oturumlarda BOŞ geliyor — fallback şart, yoksa
# .env.local sessizce okunmaz ve EVAL_LATE_CUTOFF'suz koşarsın (geç teslim
# kontrolü atlanır, kimse fark etmez).
PROJ="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
set -a
[ -f "$PROJ/apps/web/.env.local" ] && . "$PROJ/apps/web/.env.local"
set +a
: "${EVALUATOR_API_BASE:=https://hackathon-evaluator-eta.vercel.app}"

# Kurumsal TLS proxy'si altında Node kendi gömülü CA store'unu kullanır, macOS
# keychain'ini değil → finalize-evaluation.mjs SELF_SIGNED_CERT_IN_CHAIN ile
# patlar (curl aynı adrese sorunsuz gider, bu yüzden yanıltıcıdır).
# Desteklemeyen eski Node'da bu satır sessizce atlanır.
node --use-system-ca -e '' 2>/dev/null \
  && export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-system-ca"
```

`INGEST_TOKEN` **opsiyonel**. Sunucuda `EVALUATOR_REQUIRE_AUTH` kapalı olduğu
sürece yazma endpoint'leri token istemez; curl'lerdeki Authorization başlığı boş
gider ve yok sayılır. Korumayı açarsan (`EVALUATOR_REQUIRE_AUTH=1`) yalnız bu
değişkeni tanımlaman yeterli — akış aynı kalır.

Terminalden tetikleme kurulum gerektirmez.

## Adımlar

### 1. Argümanları parse et
- Repo URL geçerli mi (https://github.com/...) doğrula.
- `team-id` zorunlu.
- `base` belirtilmemişse `process.env.EVALUATOR_API_BASE`.

### 1.5. Kuyruk kaydı oluştur — UI'da GÖRÜNMESİ İÇİN ZORUNLU

Bu iki çağrı olmadan değerlendirme **hiçbir ekranda görünmez**: admin
QueuePanel `?status=active` ile boş döner ("✓ Kuyruk boş" yazar), takım detay
sayfasındaki EvaluateButton `?teamId=...&limit=1` ile pending/processing
bulamaz ve script/developer/reviewer rozetleri hiç render edilmez. Skor sonra
yine görünür (leaderboard, kriter dökümü, export) — görünmeyen şey **koşarken
ilerleme**.

Maliyet: 2 HTTP çağrısı, sıfır ek LLM token'ı.

```bash
AUTH=(); [ -n "$INGEST_TOKEN" ] && AUTH=(-H "Authorization: Bearer $INGEST_TOKEN")

REQ_ID=$(curl -s -X POST "$EVALUATOR_API_BASE/api/eval-requests" \
  -H "Content-Type: application/json" "${AUTH[@]}" \
  -d "{\"teamId\":\"<team-id>\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["request"]["id"])')
echo "REQ_ID=$REQ_ID"
```

- Aynı takımda zaten `pending` kayıt varsa 200 + `deduplicated:true` döner ve
  **aynı id** gelir — status koduna güvenme, her iki durumda da `.request.id` al.
- 404 `team not found` → operatöre "team-id veritabanında yok, /admin'den ekle"
  de ve abort et.

Ardından atomik claim (sunucu `startedAt`'ı kendi yazar — elle yazılamaz):

```bash
curl -s -X PATCH "$EVALUATOR_API_BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" "${AUTH[@]}" \
  -d '{"status":"processing","expectFromStatus":"pending"}'
```

409 dönerse kaydı başkası kapmış ya da operatör iptal etmiş → **akışı durdur**,
diriltme.

### 2. Repo'yu klonla
```bash
WORKDIR=$(mktemp -d -t eval-XXXXXX)
export GIT_TERMINAL_PROMPT=0   # private repo'da kimlik sorma, exit 128 ile dön
git clone --depth 50 --single-branch --no-tags <repo-url> "$WORKDIR/repo" 2>&1 || {
  # private/404 → POST 0 puanlı boş değerlendirme
  # Bkz. "Hata yolu" bölümü
}
```

### 3. Ön-tarama (cheap, kullanıcı görsün)
- `ls -la $WORKDIR/repo` → dosya listesi
- `cat $WORKDIR/repo/README.md` (varsa)
- `ls $WORKDIR/repo/docs/ $WORKDIR/repo/.claude/` (varsa)
- `cat $WORKDIR/repo/package.json` → ana 3 bağımlılığı çıkar (mcp, ai entegrasyonları için bilgi)
- `git -C $WORKDIR/repo log --oneline -20` → AI co-author kontrolü için

Bu özet bilgileri sub-agent'lara context olarak verirsin.

### 4a. Deterministik skorlar (script)

```bash
# > YÖNLENDİRMESİ ZORUNLU: Adım 6 --det "$WORKDIR/det.json" okuyor.
# Yönlendirmeyi unutursan finalize ENOENT ile patlar.
node "$CLAUDE_PROJECT_DIR/scripts/eval-deterministic.mjs" "$WORKDIR/repo" > "$WORKDIR/det.json"
```

Script rozetini hemen yeşillendir (opsiyonel ama kullanıcı 2-5 dk boş rozete
bakmasın):

```bash
DET_TOTAL=$(python3 -c "import json;print(sum(x['score'] for x in json.load(open('$WORKDIR/det.json'))['scores']))")
curl -s -X PATCH "$EVALUATOR_API_BASE/api/eval-requests/$REQ_ID/agent-state" \
  -H "Content-Type: application/json" "${AUTH[@]}" \
  -d "{\"agent\":\"script\",\"status\":\"done\",\"score\":$DET_TOTAL}"
```

> Yol **repoya göre** çözülür. Mutlak yol yazma: bu makinede `~/Desktop/hackathon` adında bu projenin eski bir klonu daha var; mutlak yol sessizce onu çalıştırır ve sen düzeltmelerinin neden etkisiz kaldığını anlamazsın. `$CLAUDE_PROJECT_DIR` yoksa `git rev-parse --show-toplevel` kullan.
Çıktı:
```json
{ "scores": [docs, readme, ai-evidence, agentic, tests], "securityScan": {detected, count, hits, note} }
```

Bu 5 skor doğrudan kullanılır. UI yalnızca **`script` / `developer` / `reviewer`** anahtarlarını çiziyor (`EvaluateButton.tsx:15-19`); başka anahtar DB'ye yazılır ama hiçbir rozete karşılık gelmez.

> **NOT:** Eski 5-agent mapping (analist→docs+readme; ai-evidence→ai-evidence+agentic; tester→tests) **tamamen kaldırıldı**. analist/ai-evidence/tester agent'ları artık çağrılmaz.

### 4b. LLM agent'lar (TEK MESAJDA 2 Agent tool call)

#### Agent 1: developer (context7 MCP'li)
```
description: "Temiz kod analizi"
subagent_type: "general-purpose"
prompt: <oku ./agents/developer.md, repo-path ve top-deps doldur>
```

#### Agent 2: reviewer (context7 MCP'li)
```
description: "Mimari değerlendirme"
subagent_type: "general-purpose"
prompt: <oku ./agents/reviewer.md, repo-path ve top-deps doldur>
```

İki Agent çağrısını içeren mesajdan **HEMEN ÖNCE** rozetleri amber'a çevir
(bu PATCH'leri agent prompt'una KOYMA — orchestrator atar):

```bash
for a in developer reviewer; do
  curl -s -X PATCH "$EVALUATOR_API_BASE/api/eval-requests/$REQ_ID/agent-state" \
    -H "Content-Type: application/json" "${AUTH[@]}" \
    -d "{\"agent\":\"$a\",\"status\":\"running\"}"
done
```

`done` PATCH'lerini elle atma — Adım 6'daki `--req` bunu zaten yapıyor.

> **KRİTİK:** İki Agent çağrısı tek bir asistan mesajında olmalı.

### 4c. Prompt injection uyarısı
`securityScan.detected === true` ise:
- modelNote'a `⚠ {count} prompt-injection attempt found (paths: ...)` ekle
- LLM agent prompt'larında zaten anti-injection talimat var → skoru etkilemez

### 5. Cevap kontratı (her sub-agent'tan beklenen)

Her sub-agent JSON döner. Parse et, schema doğrula:

```json
[
  {
    "criterion": "ai-evidence" | "agentic" | "docs" | "readme" | "clean-code" | "architecture" | "tests",
    "score": <int 0..max>,
    "max": <int>,
    "rationale": "<en az 2 cümle>",
    "evidence": [{"path": "...", "lines": "...", "note": "..."}]
  }
]
```

Kriterleri topla:
- Script → `docs`, `readme`, `ai-evidence`, `agentic`, `tests` (5 madde)
- `developer` LLM → `clean-code` (1 madde)
- `reviewer` LLM → `architecture` (1 madde)

Toplam 7 madde olmalı. Eksik kriter varsa, eksik olanı 0 puan + "agent yanıtı eksikti" rationale ile doldur.

### 6. Toplam ve POST — SCRIPT İLE

Payload'ı elle yazma. Agent çıktılarını dosyaya yaz, birleştirmeyi script yapsın:

```bash
printf '%s' "$DEVELOPER_JSON" > "$WORKDIR/clean-code.json"
printf '%s' "$REVIEWER_JSON"  > "$WORKDIR/architecture.json"

node "$CLAUDE_PROJECT_DIR/scripts/finalize-evaluation.mjs" \
  --base "$EVALUATOR_API_BASE" --team "<team-id>" --req "$REQ_ID" \
  --det "$WORKDIR/det.json" \
  --llm "$WORKDIR/clean-code.json" --llm "$WORKDIR/architecture.json" \
  --repo-path "$WORKDIR/repo"
```

> Bu script ağ'a çıkan tek node script'i. `SELF_SIGNED_CERT_IN_CHAIN` alırsan
> Adım 0'daki `NODE_OPTIONS=--use-system-ca` satırını atlamışsındır — hata
> anında hiçbir şey POST edilmez, env'i düzeltip aynı komutu tekrar çalıştır.

Script 7 kriteri birleştirir, skorları `0..max`'a çeker, eksik kriteri 0 ile
doldurur, `securityScan` + `latePenalty`'yi ekler ve POST eder. `--dry-run`
ile önce doğrulama tablosunu görebilirsin.

`--req` verildiği anda script (finalize-evaluation.mjs:170-194) fazladan şunları
yapar: 3 paralel agent-state PATCH'i (script/developer/reviewer = done + skor) ve
`{status:"done", evaluationId, expectFromStatus:"processing"}` compare-and-swap.
Bu son PATCH kuyruk satırını kapatır, UI'da `router.refresh()` tetikler ve skorlar
belirir. **`--req` vermezsen bu 4 çağrı atlanır ve kayıt sonsuza kadar
"processing" kalır.**

### 7. Operator'a özet
- `<takım> · <toplam>/100` tek satır
- Dashboard linki: `$EVALUATOR_API_BASE/teams/<team-id>`
- Kriter dökümü: 7 satır `<kriter>: <skor>/<max> — <rationale ilk cümle>`

### 8. Temizlik
```bash
rm -rf "$WORKDIR"
```

## Hata Yolu

> **Her hata yolunda önce kuyruk kaydını kapat** — yoksa satır sonsuza kadar
> "🔄 İşleniyor" görünür ve QueuePanel hiç boşalmaz:
>
> ```bash
> curl -s -X PATCH "$EVALUATOR_API_BASE/api/eval-requests/$REQ_ID" \
>   -H "Content-Type: application/json" "${AUTH[@]}" \
>   -d "{\"status\":\"failed\",\"errorMsg\":\"<sebep>\"}"
> ```
>
> Takım detay sayfası `errorMsg`'i "Hata: ..." kutusunda gösterir.


- **Repo private / 404** → POST 7 madde × 0 puan, rationale "Repo erişilemedi (private veya yok). Skor için public + master branch çalışan repo gerekir."
- **Sub-agent JSON bozuk** → 1 kez retry, hâlâ bozuksa o kriter için 0 puan + "AI cevabı parse edilemedi" rationale
- **POST 401** → operator'a "INGEST_TOKEN eşleşmiyor — env kontrol et" mesajı, abort
- **POST 4xx team_id eksik** → operator'a "team-id veritabanında yok, /admin'den ekle" mesajı, abort

## Notlar

- Sub-agent'lar **Explore** veya **general-purpose** tipinde — read-only, repo'ya yazmaz.
- context7 MCP zorunlu (developer + reviewer); yoksa o sub-agent'lar uyarı verir ama yine de skor üretir.
- Tek kullanım: değerlendirme süresi ~30-60 sn (paralel sayesinde).
- Aynı takıma birden fazla değerlendirme yapılabilir; UI sonuncusunu gösterir, tarihçe `/teams/<id>` detayında.
