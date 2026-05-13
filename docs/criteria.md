# Değerlendirme Kriterleri

Toplam **100 puan**. Her kriter için AI gerekçesi (rationale) zorunludur.

| # | Kriter | Max Puan | Sub-agent | Bakılan İşaretler |
|---|--------|----------|-----------|-------------------|
| 1 | AI ile kodlama kanıtı | 20 | `ai-evidence` | Commit'lerde co-author (`Co-Authored-By: Claude`), README'de AI tool listesi, `.claude/` klasörü, prompt arşivi/log'lar |
| 2 | Agentic kodlama yapısı | 20 | `ai-evidence` | `.claude/agents/`, `.claude/skills/`, multi-step workflow, **MCP server kullanımı** (`mcp.json` / `.mcp.json` / `claude_desktop_config*`) — kullanılan MCP'ler rationale'a listelenir |
| 3 | Docs (proje planı + aşamalar) | 14 | `analist` | `docs/` klasörü var mı; `plan.md`, `phases.md`, `architecture.md` benzeri dosyalar; içerik kalitesi |
| 4 | README.md kapsamı | 14 | `analist` | Kullanılan MCP listesi, AI tool listesi, deploy URL, kurulum, test bölümü, görseller |
| 5 | Temiz Kod | 14 | `developer` | İsimlendirme, dead code, fonksiyon uzunluğu, type safety, lint geçer mi, magic number, code smell |
| 6 | Mimari | 14 | `reviewer` | Klasör ayrımı, separation of concerns, env yönetimi, hata yönetimi, framework best-practice uyumu |
| 7 | Testler | 4 | `tester` | Backend unit test (Vitest/Jest/PyTest), frontend component test (RTL), E2E (Playwright/Cypress); varlık + çalışıyor mu + coverage işareti |

## Çıktı Sözleşmesi (her kriter için)

```json
{
  "score": 12,
  "max": 14,
  "rationale": "İki cümleden uzun, somut gerekçe...",
  "evidence": [
    { "path": "README.md", "lines": "12-30", "note": "MCP listesi var ama deploy URL eksik" }
  ]
}
```

## Toplam Skor
- Ham toplam: 7 kriter, **100 puan** üzerinden.
- Dashboard ve Excel dışa aktarımında doğrudan `total/100` gösterilir; ayrıca normalizasyon hesabına gerek yoktur.
