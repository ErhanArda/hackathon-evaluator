---
name: evaluate-repo
description: Hackathon takım reposunu klonla, 4 sub-agent'la paralel değerlendir, sonucu Vercel API'ye POST et. Kullanım. /evaluate <repo-url> team-id=<id>
---

# /evaluate — Hackathon Repo Değerlendirme Orchestrator

Bu skill verilen GitHub reposunu klonlar, **4 sub-agent'ı paralel** çalıştırır (Agent tool, single message multi-call), 6 kriter üzerinden puanlar ve sonucu deploy edilmiş Vercel API'sine POST eder.

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

### 4. **PARALEL** sub-agent çağrısı (TEK MESAJDA 4 Agent tool call)

Çağrı şablonu — her birini ayrı Agent tool call olarak **aynı mesajda** gönder:

#### Agent 1: analist
```
description: "Docs + README değerlendirme"
subagent_type: "Explore"
prompt: <oku ./agents/analist.md ve içine repo-path=$WORKDIR/repo, repo-summary=<özet> doldur>
```

#### Agent 2: developer (context7 MCP'li)
```
description: "Temiz kod analizi"
subagent_type: "general-purpose"
prompt: <oku ./agents/developer.md, repo-path ve top-deps doldur>
```

#### Agent 3: reviewer (context7 MCP'li)
```
description: "Mimari değerlendirme"
subagent_type: "general-purpose"
prompt: <oku ./agents/reviewer.md, repo-path ve top-deps doldur>
```

#### Agent 4: ai-evidence
```
description: "AI/Agentic kullanım izleri"
subagent_type: "Explore"
prompt: <oku ./agents/ai-evidence.md, repo-path ve git-log doldur>
```

> **KRİTİK:** Dört Agent çağrısı tek bir asistan mesajında olmalı (paralel çalışır). Aksi halde sıralı koşar ve yavaşlar.

### 5. Cevap kontratı (her sub-agent'tan beklenen)

Her sub-agent JSON döner. Parse et, schema doğrula:

```json
[
  {
    "criterion": "ai-evidence" | "agentic" | "docs" | "readme" | "clean-code" | "architecture",
    "score": <int 0..max>,
    "max": <int>,
    "rationale": "<en az 2 cümle>",
    "evidence": [{"path": "...", "lines": "...", "note": "..."}]
  }
]
```

`analist` → `docs` ve `readme` (2 madde döner)
`developer` → `clean-code` (1 madde)
`reviewer` → `architecture` (1 madde)
`ai-evidence` → `ai-evidence` ve `agentic` (2 madde)

Toplam 6 madde olmalı. Eksik kriter varsa, eksik olanı 0 puan + "agent yanıtı eksikti" rationale ile doldur.

### 6. Toplam ve POST

Toplam = 6 madde'nin score toplamı (max 30).

```bash
curl -fsS -X POST "$EVALUATOR_API_BASE/api/evaluations" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @<(cat <<JSON
{
  "teamId": "<team-id>",
  "evaluator": "claude-code",
  "modelNote": "4 sub-agent (analist+developer+reviewer+ai-evidence) · context7 MCP",
  "scores": [ ... 6 kriter ... ]
}
JSON
)
```

Pratik: scripts/post-evaluation.sh helper'ı var, Claude doğrudan onu çağırabilir.

### 7. Operator'a özet
- `<takım> · <toplam>/30 · <100'lük>` tek satır
- Dashboard linki: `$EVALUATOR_API_BASE/teams/<team-id>`
- Kriter dökümü: 6 satır `<kriter>: <skor>/<max> — <rationale ilk cümle>`

### 8. Temizlik
```bash
rm -rf "$WORKDIR"
```

## Hata Yolu

- **Repo private / 404** → POST 6 madde × 0 puan, rationale "Repo erişilemedi (private veya yok). Skor için public + master branch çalışan repo gerekir."
- **Sub-agent JSON bozuk** → 1 kez retry, hâlâ bozuksa o kriter için 0 puan + "AI cevabı parse edilemedi" rationale
- **POST 401** → operator'a "INGEST_TOKEN eşleşmiyor — env kontrol et" mesajı, abort
- **POST 4xx team_id eksik** → operator'a "team-id veritabanında yok, /admin'den ekle" mesajı, abort

## Notlar

- Sub-agent'lar **Explore** veya **general-purpose** tipinde — read-only, repo'ya yazmaz.
- context7 MCP zorunlu (developer + reviewer); yoksa o sub-agent'lar uyarı verir ama yine de skor üretir.
- Tek kullanım: değerlendirme süresi ~30-60 sn (paralel sayesinde).
- Aynı takıma birden fazla değerlendirme yapılabilir; UI sonuncusunu gösterir, tarihçe `/teams/<id>` detayında.
