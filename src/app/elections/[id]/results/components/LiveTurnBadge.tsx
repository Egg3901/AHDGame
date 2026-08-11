"use client";

interface LiveTurnBadgeProps {
  status: string;
  currentTurn: number;
  endTurn: number | null;
  /** 0..1 final-hour drip progress; null outside the window. */
  finalHourProgress: number | null;
}

/**
 * The page's live indicator: pulsing turn counter while active, a countdown
 * chip during the final-hour drip, a quiet "Final" chip once done.
 */
export function LiveTurnBadge({
  status,
  currentTurn,
  endTurn,
  finalHourProgress,
}: LiveTurnBadgeProps) {
  if (status === "upcoming") {
    return (
      <span className="rounded-full border border-card-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted">
        Not started
      </span>
    );
  }
  if (status !== "active") {
    return (
      <span className="rounded-full border border-card-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted">
        Final
      </span>
    );
  }
  if (finalHourProgress != null) {
    const pctLeft = Math.max(0, Math.round((1 - finalHourProgress) * 100));
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-error/40 bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-error" />
        Election night · {pctLeft}% of count remaining
      </span>
    );
  }
  const remaining = endTurn != null ? endTurn - currentTurn : null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      Live · Turn {currentTurn}
      {remaining != null && remaining > 0 ? ` · ${remaining} to go` : ""}
    </span>
  );
}
