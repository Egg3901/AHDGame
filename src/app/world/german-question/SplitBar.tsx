/**
 * The two-sided contest bar: NATO grows from the left, the Pact from the right.
 *
 * Used at three scales — the masthead's full-width threshold bar, each
 * institution card, and the delegation bench rows — so the gradient direction
 * and the token pair are defined once.
 */
interface SplitBarProps {
  /** 0-100 toward the Pact. */
  eastPct: number;
  height: "sm" | "md" | "lg";
  /** Draw the 15% / 85% resolution marks. Masthead only. */
  thresholds?: boolean;
}

const HEIGHTS = { sm: "h-1.5", md: "h-4", lg: "h-3.5" } as const;

export function SplitBar({ eastPct, height, thresholds = false }: SplitBarProps) {
  const west = Math.max(0, Math.min(100, 100 - eastPct));
  const east = Math.max(0, Math.min(100, eastPct));
  return (
    <div
      className={`relative w-full overflow-hidden rounded-sm border border-card-border bg-background/80 ${HEIGHTS[height]}`}
      role="img"
      aria-label={`${west.toFixed(1)}% NATO, ${east.toFixed(1)}% Warsaw Pact`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-secondary to-info"
        style={{ width: `${west}%` }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-gradient-to-l from-primary-dark to-error-muted"
        style={{ width: `${east}%` }}
      />
      {thresholds && (
        <>
          <div className="absolute inset-y-0 left-[15%] w-px bg-foreground/30" />
          <div className="absolute inset-y-0 left-[85%] w-px bg-foreground/30" />
        </>
      )}
    </div>
  );
}
