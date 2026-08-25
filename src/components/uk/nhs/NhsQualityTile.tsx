/**
 * NHS quality tile (epic #856, ticket #858).
 *
 * Presentational: the 0..100 NHS service-quality score as a labelled, banded
 * meter, plus the healthcare share of the Budget driving it. Quality rises when
 * the Budget funds healthcare above the demand baseline and falls when it
 * doesn't; a failing NHS drags approval and becomes a bigger election issue.
 */

export function nhsBand(value: number): { label: string; color: string } {
  if (value >= 66) return { label: "Thriving", color: "#16a34a" };
  if (value >= 33) return { label: "Strained", color: "#d97706" };
  return { label: "Failing", color: "#dc2626" };
}

export function NhsQualityTile({
  quality,
  healthcareShare,
}: {
  quality: number;
  healthcareShare?: number | null;
}) {
  const clamped = Math.max(0, Math.min(100, quality));
  const band = nhsBand(clamped);
  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
      <div className="flex items-baseline justify-between">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          National Health Service
        </h3>
        <span className="text-body-sm font-medium" style={{ color: band.color }}>
          {band.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground">{Math.round(clamped)}</span>
        <span className="text-body-sm text-muted">/ 100 quality</span>
      </div>
      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-card-muted ring-1 ring-card-border"
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="NHS quality"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: band.color }}
        />
      </div>
      <p className="mt-2 text-caption text-muted">
        {typeof healthcareShare === "number"
          ? `Healthcare is ${Math.round(healthcareShare)}% of the Budget. `
          : ""}
        Fund it above demand to raise quality; underfund it and care degrades.
      </p>
    </div>
  );
}
