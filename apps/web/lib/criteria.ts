export const CRITERIA = [
  { key: "ai-evidence",     label: "AI ile kodlama kanıtı",     max: 5 },
  { key: "agentic",         label: "Agentic kodlama yapısı",    max: 5 },
  { key: "docs",            label: "Docs (plan + aşamalar)",    max: 5 },
  { key: "readme",          label: "README.md kapsamı",         max: 5 },
  { key: "clean-code",      label: "Temiz Kod",                 max: 5 },
  { key: "architecture",    label: "Mimari",                    max: 5 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const TOTAL_MAX = CRITERIA.reduce((s, c) => s + c.max, 0);

export const labelFor = (key: string) =>
  CRITERIA.find((c) => c.key === key)?.label ?? key;
