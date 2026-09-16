// Rubric — 7 kriter, toplam 100 puan.
// `short` alanı leaderboard sütun başlığıdır (eskiden bileşen içinde bir
// ternary zinciriydi; kriter eklenince orayı da güncellemek gerekiyordu).
export const CRITERIA = [
  { key: "ai-evidence",  label: "AI ile kodlama kanıtı",  short: "AI",   max: 20 },
  { key: "agentic",      label: "Agentic kodlama yapısı", short: "Agnt", max: 20 },
  { key: "docs",         label: "Docs (plan + aşamalar)", short: "Docs", max: 14 },
  { key: "readme",       label: "README.md kapsamı",      short: "Rdm",  max: 14 },
  { key: "clean-code",   label: "Temiz Kod",              short: "Kod",  max: 14 },
  { key: "architecture", label: "Mimari",                 short: "Mim",  max: 14 },
  { key: "tests",        label: "Testler",                short: "Test", max: 4  },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const TOTAL_MAX = CRITERIA.reduce((s, c) => s + c.max, 0);

export const labelFor = (key: string) =>
  CRITERIA.find((c) => c.key === key)?.label ?? key;
