import type { AlignmentPoleId, AlignmentPoleToken } from "@/lib/constants/alignmentEras";
import { formatShare } from "@/lib/alignment/normalize";
import type { LedgerPole } from "@/lib/alignment/queries/worldAlignment";

/**
 * Static token → class maps. Tailwind scans source text, so an interpolated
 * `bg-${token}` would be purged and the bar would render colourless.
 */
export const POLE_BG: Record<AlignmentPoleToken, string> = {
  info: "bg-info",
  error: "bg-error",
  warning: "bg-warning",
  success: "bg-success",
};

export const POLE_TEXT: Record<AlignmentPoleToken, string> = {
  info: "text-info",
  error: "text-error",
  warning: "text-warning",
  success: "text-success",
};

interface ShareBarProps {
  poles: LedgerPole[];
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
  /** What the remainder is called this era — "Non-aligned" once the movement exists. */
  remainderLabel?: string;
  /** Taller bar for the legend and summary tiles. */
  size?: "row" | "lead";
  className?: string;
}

/**
 * The Ledger's signature: one 100%-wide stacked bar showing how a nation's
 * standing divides between the era's poles, with the uncommitted remainder on
 * the track colour. Repeated in the legend, the summary tiles and every row so
 * the page reads as a single grammar.
 */
export function ShareBar({
  poles,
  shares,
  nonAligned,
  remainderLabel = "Non-aligned",
  size = "row",
  className,
}: ShareBarProps) {
  const segments = poles
    .map((pole) => ({ pole, value: shares[pole.id] ?? 0 }))
    .filter((s) => s.value > 0);

  const label = [
    ...segments.map((s) => `${s.pole.label} ${formatShare(s.value)}`),
    `${remainderLabel.toLowerCase()} ${formatShare(nonAligned)}`,
  ].join(", ");

  return (
    <div
      className={`flex overflow-hidden rounded-full bg-track ${
        size === "lead" ? "h-2.5" : "h-1.5"
      } ${className ?? ""}`}
      role="img"
      aria-label={label}
    >
      {segments.map((s) => (
        <span
          key={s.pole.id}
          className={POLE_BG[s.pole.accentToken]}
          style={{ width: `${s.value}%` }}
        />
      ))}
      {/* The remainder is not empty space — it is the share no bloc persuaded,
          which IS non-alignment. Drawing it makes the model legible. */}
      {nonAligned > 0 && <span className={POLE_BG.success} style={{ width: `${nonAligned}%` }} />}
    </div>
  );
}
