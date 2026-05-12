# Değerlendirme Kriterleri

Toplam **30 puan**. Her kriter için AI gerekçesi (rationale) zorunludur.

| # | Kriter | Max Puan | Sub-agent | Bakılan İşaretler |
|---|--------|----------|-----------|-------------------|
| 1 | AI ile kodlama kanıtı | 5 | `ai-evidence` | Commit'lerde co-author (`Co-Authored-By: Claude`), README'de AI tool listesi, `.claude/` klasörü, prompt arşivi/log'lar |
| 2 | Agentic kodlama yapısı | 5 | `ai-evidence` | `.claude/agents/`, `.claude/skills/`, multi-step workflow, **MCP server kullanımı** (`mcp.json` / `.mcp.json` / `claude_desktop_config*`) — kullanılan MCP'ler rationale'a listelenir |
| 3 | Docs (proje planı + aşamalar) | 5 | `analist` | `docs/` klasörü var mı; `plan.md`, `phases.md`, `architecture.md` benzeri dosyalar; içerik kalitesi |
| 4 | README.md kapsamı | 5 | `analist` | Kullanılan MCP listesi, AI tool listesi, deploy URL, kurulum, test bölümü, görseller |
| 5 | Temiz Kod | 5 | `developer` | İsimlendirme, dead code, fonksiyon uzunluğu, type safety, lint geçer mi, magic number, code smell |
| 6 | Mimari | 5 | `reviewer` | Klasör ayrımı, separation of concerns, env yönetimi, hata yönetimi, framework best-practice uyumu |

## Çıktı Sözleşmesi (her kriter için)

```json
{
  "score": 4,
  "max": 5,
  "rationale": "İki cümleden uzun, somut gerekçe...",
  "evidence": [
    { "path": "README.md", "lines": "12-30", "note": "MCP listesi var ama deploy URL eksik" }
  ]
}
```

## Toplam Skor
- Ham toplam: 6 kriter × 5 = **30 puan**.
- Dashboard'da hem ham puan hem 100 üzerinden normalize gösterilir (`total * 100 / 30`).
