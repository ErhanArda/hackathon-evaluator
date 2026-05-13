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

## Adımlar

### 1. Argümanları parse et
- Repo URL geçerli mi (https://github.com/...) doğrula.
- `team-id` zorunlu.
- `base` belirtilmemişse `process.env.EVALUATOR_API_BASE`.

### 2. Repo'yu klonla
```bash
WORKDIR=$(mktemp -d -t eval-XXXXXX)
git clone --depth 50 <repo-url> "$WORKDIR/repo" 2>&1 || {
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
node /Users/tcerarda/Desktop/hackathon/scripts/eval-deterministic.mjs "$WORKDIR/repo"
```
Çıktı:
```json
{ "scores": [docs, readme, ai-evidence, agentic, tests], "securityScan": {detected, count, hits, note} }
```

Bu 5 skor doğrudan kullanılır. Process-queue içindeysen 5 agent-state'i (analist/developer/reviewer/ai-evidence/tester ≠ kriterlerle eşleşmez ama) bu noktada "done" işaretle, score field'larına deterministik puanı yaz. UI rozetleri anında yeşillenir.

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

> **KRİTİK:** İki Agent çağrısı tek bir asistan mesajında olmalı. developer/reviewer agent-state'leri sırasıyla running→done PATCH'lenir.

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

### 6. Toplam ve POST

Toplam = 7 madde'nin score toplamı (max 100).

```bash
curl -fsS -X POST "$EVALUATOR_API_BASE/api/evaluations" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @<(cat <<JSON
{
  "teamId": "<team-id>",
  "evaluator": "claude-code",
  "modelNote": "deterministik script (5 kriter) + 2 LLM agent (developer+reviewer) · context7 MCP[· ⚠ prompt-injection uyarısı varsa]",
  "scores": [ ... 7 kriter ... ]
}
JSON
)
```

Pratik: scripts/post-evaluation.sh helper'ı var, Claude doğrudan onu çağırabilir.

### 7. Operator'a özet
- `<takım> · <toplam>/100` tek satır
- Dashboard linki: `$EVALUATOR_API_BASE/teams/<team-id>`
- Kriter dökümü: 7 satır `<kriter>: <skor>/<max> — <rationale ilk cümle>`

### 8. Temizlik
```bash
rm -rf "$WORKDIR"
```

## Hata Yolu

- **Repo private / 404** → POST 7 madde × 0 puan, rationale "Repo erişilemedi (private veya yok). Skor için public + master branch çalışan repo gerekir."
- **Sub-agent JSON bozuk** → 1 kez retry, hâlâ bozuksa o kriter için 0 puan + "AI cevabı parse edilemedi" rationale
- **POST 401** → operator'a "INGEST_TOKEN eşleşmiyor — env kontrol et" mesajı, abort
- **POST 4xx team_id eksik** → operator'a "team-id veritabanında yok, /admin'den ekle" mesajı, abort

## Notlar

- Sub-agent'lar **Explore** veya **general-purpose** tipinde — read-only, repo'ya yazmaz.
- context7 MCP zorunlu (developer + reviewer); yoksa o sub-agent'lar uyarı verir ama yine de skor üretir.
- Tek kullanım: değerlendirme süresi ~30-60 sn (paralel sayesinde).
- Aynı takıma birden fazla değerlendirme yapılabilir; UI sonuncusunu gösterir, tarihçe `/teams/<id>` detayında.
