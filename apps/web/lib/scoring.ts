import { TOTAL_MAX } from "./criteria";

export function normalize100(score: number, max: number = TOTAL_MAX): number {
  if (max <= 0) return 0;
  return Math.round((score * 100) / max);
}

export function rankColor(score: number, max: number = TOTAL_MAX): string {
  const pct = (score / max) * 100;
  if (pct >= 80) return "text-emerald-600 bg-emerald-50";
  if (pct >= 60) return "text-amber-600 bg-amber-50";
  if (pct >= 40) return "text-orange-600 bg-orange-50";
  return "text-rose-600 bg-rose-50";
}
