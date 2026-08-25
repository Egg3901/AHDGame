/**
 * Government confidence gauge readout (epic #856, ticket #858).
 *
 * Presentational: renders the 0..100 confidence value as a labelled meter,
 * coloured by health. The gauge is fed by lost votes / budget defeat / broken
 * promises / cabinet churn; dissolution fires only when it bottoms out (that
 * consequence is separately flag-gated).
 */

export function confidenceBand(value: number): { label: string; color: string } {
  if (value >= 66) return { label: "Secure", color: "#16a34a" };
  if (value >= 33) return { label: "Shaky", color: "#d97706" };
  if (value > 0) return { label: "Crisis", color: "#dc2626" };
  return { label: "Collapsed", color: "#991b1b" };
}

export function ConfidenceGaugeReadout({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const band = confidenceBand(clamped);
  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
      <div className="flex items-baseline justify-between">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          Government Confidence
        </h3>
        <span className="text-body-sm font-medium" style={{ color: band.color }}>
          {band.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground">{Math.round(clamped)}</span>
        <span className="text-body-sm text-muted">/ 100</span>
      </div>
      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-card-muted ring-1 ring-card-border"
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Government confidence"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: band.color }}
        />
      </div>
      <p className="mt-2 text-caption text-muted">
        Falls with lost votes, budget defeats, broken pledges and cabinet resignations; recovers
        while the government stays popular.
      </p>
    </div>
  );
}
