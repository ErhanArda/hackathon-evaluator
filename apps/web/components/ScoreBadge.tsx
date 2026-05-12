import { rankColor } from "@/lib/scoring";

export function ScoreBadge({
  score,
  max,
  size = "md",
}: {
  score: number | null;
  max: number;
  size?: "sm" | "md" | "lg";
}) {
  if (score == null) {
    return <span className="text-slate-400">—</span>;
  }
  const cls = rankColor(score, max);
  const sizeCls =
    size === "lg"
      ? "px-3 py-1.5 text-base"
      : size === "sm"
      ? "px-1.5 py-0.5 text-xs"
      : "px-2 py-1 text-sm";
  return (
    <span className={`inline-flex items-center rounded-md font-medium ${cls} ${sizeCls}`}>
      {score}
      <span className="ml-1 text-slate-400">/{max}</span>
    </span>
  );
}
