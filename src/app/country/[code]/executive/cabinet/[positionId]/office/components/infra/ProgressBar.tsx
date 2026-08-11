"use client";

/** A labeled progress bar for construction projects (0-100). */
export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full border border-card-border bg-card-muted">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: "var(--gov)" }}
      />
    </div>
  );
}
