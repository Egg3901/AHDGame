"use client";

interface ShortageBadgeProps {
  ratio: number;
}

export default function ShortageBadge({ ratio }: ShortageBadgeProps) {
  // Severity tiers based on raw demand/supply ratio.
  let label: string;
  let colorClass: string;
  if (ratio >= 3) {
    label = "Critical";
    colorClass = "bg-red-500/20 text-red-400 border-red-500/40";
  } else if (ratio >= 2) {
    label = "Severe";
    colorClass = "bg-orange-500/20 text-orange-400 border-orange-500/40";
  } else if (ratio >= 1.5) {
    label = "Moderate";
    colorClass = "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  } else {
    label = "Mild";
    colorClass = "bg-amber-500/20 text-amber-400 border-amber-500/40";
  }

  return (
    <span
      className={`ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide ${colorClass}`}
      title={`Global shortage: worldwide demand is ${ratio.toFixed(1)}x worldwide supply. This is the WORLD market, not this state — your state can be well supplied while this still reads Severe. Margin effects soften above 3x.`}
    >
      {label}
    </span>
  );
}
