---
name: process-queue
description: Bekleyen evaluation request'leri kuyruktan al, tek tek 4 sub-agent ile paralel değerlendir, sonucu dashboard'a yaz. Kullanım. /process-queue [base=http://localhost:3000]
---

# /process-queue — Eval Request Worker

Bu skill `/api/eval-requests`'ten **status=pending** request'leri alır, atomic olarak claim eder, 4 sub-agent paralel çalıştırır, sonucu POST eder. **/loop ile birlikte kullan** — sürekli polling için.

## Argümanlar
- `base` (opsiyonel) — varsayılan `http://localhost:3000`. Prod için `https://your-app.vercel.app`.

## Algoritma

### 1. Pending request'i bul
```bash
BASE=${base:-http://localhost:3000}
curl -s "$BASE/api/eval-requests?status=pending&limit=1"
```

Cevap boşsa: "Kuyruk boş, çıkıyorum." yazıp **HEMEN BIT** (loop bir sonraki tick'e çağırır).

### 2. Atomic claim
Compare-and-swap: status'u 'pending' → 'processing'. Başkası kapmışsa 409 dönecek, atla.

```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"processing","expectFromStatus":"pending"}'
```

409 dönerse: başka worker aldı, başa dön (veya bit).

### 3. Takım bilgisini al
Request'te `teamId` var. Team'i fetch et:
```bash
curl -s "$BASE/api/teams" | python3 -c "import sys,json,os; teams=json.load(sys.stdin)['teams']; tid=os.environ['TEAM_ID']; t=next((x for x in teams if x['id']==tid), None); print(json.dumps(t) if t else 'NULL')"
```

`repoUrl` ve `name` lazım.

### 4. Repo'yu klonla
```bash
WORKDIR=$(mktemp -d -t eval-XXXXXX)
git clone --depth 50 "$REPO_URL" "$WORKDIR/repo" 2>&1
```

Hata olursa (private/404): `mark_failed` (bkz. adım 8) ile rationale "Repo erişilemedi" → 6 madde × 0 puan POST → done.

### 5. Pre-scan
- `ls -la $WORKDIR/repo`
- README.md, AGENTS.md, CLAUDE.md, package.json (varsa) cat ile özet çıkar
- `git log --oneline -20` → AI co-author kontrolü
- `find . -maxdepth 3 -name 'mcp*.json'` → MCP config var mı

Bu özet bilgiyi sub-agent prompt'larına context olarak inject et.

### 6. 4 sub-agent PARALEL (single message, multi Agent tool call)

Her birini AYRI Agent tool call olarak **aynı asistan mesajında** gönder. Sub-agent prompt template'leri: `.claude/skills/evaluate/agents/*.md` — onları oku, `{REPO_PATH}`, `{REPO_SUMMARY}`, `{TOP_DEPS}`, `{GIT_LOG}` placeholder'larını doldur.

- Agent 1: `analist` (Explore) — `agents/analist.md`
- Agent 2: `developer` (general-purpose, context7'li) — `agents/developer.md`
- Agent 3: `reviewer` (general-purpose, context7'li) — `agents/reviewer.md`
- Agent 4: `ai-evidence` (Explore) — `agents/ai-evidence.md`

Her sub-agent JSON döner. Parse et, schema doğrula:
```json
[{"criterion":"...","score":<int>,"max":5,"rationale":"...","evidence":[...]}]
```

Toplam 6 madde olmalı (analist 2, developer 1, reviewer 1, ai-evidence 2). Eksik kriter varsa 0 puanla doldur.

### 7. Evaluation'ı POST et
```bash
curl -s -X POST "$BASE/api/evaluations" \
  -H "Content-Type: application/json" \
  -d @<(cat <<JSON
{
  "teamId": "$TEAM_ID",
  "evaluator": "claude-code",
  "modelNote": "process-queue · 4 sub-agent paralel · context7 MCP",
  "scores": [ ...6 madde... ]
}
JSON
)
```

201 dönmeli, `{id, totalScore, maxScore}`. `id`'yi sakla → `EVAL_ID`.

### 8. Request'i mark done
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"done\",\"evaluationId\":\"$EVAL_ID\"}"
```

Hata yolunda (clone fail / sub-agent JSON bozuk / POST fail):
```bash
curl -s -X PATCH "$BASE/api/eval-requests/$REQ_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"failed\",\"errorMsg\":\"$ERROR_DESC\"}"
```

### 9. Cleanup
```bash
rm -rf "$WORKDIR"
```

### 10. Operator'a tek-satır özet
`✓ <takım> · <total>/30 · req=<req_id> eval=<eval_id>` veya
`✗ <takım> · failed: <error>`

## /loop ile kullanım

Sürekli polling:
```
/loop 30s /process-queue
```

veya prod için:
```
/loop 30s /process-queue base=https://your-app.vercel.app
```

Her 30 sn'de bir tick: 1 request işlenir. Boşsa hemen biter, kaynak yakmaz.

## Notlar

- **Tek seferde 1 request.** Paralel worker istemiyoruz; aynı eval_request'in compare-and-swap ile tek sefer alındığından emin oluyoruz ama bu skill kendi içinde tek thread.
- Sub-agent'lar Explore/general-purpose tipinde, read-only.
- Repo private ise gh auth token'ı kullanılır (`gh auth status` ile kontrol).
- context7 MCP yoksa developer/reviewer rationale'da bunu not düşer, çalışmaya devam eder.
