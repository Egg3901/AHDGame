import type { ParticipationSummary } from "@/lib/demographics/v2/rules";

function points(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} pts`;
}

const ROWS: ReadonlyArray<{ key: keyof ParticipationSummary; label: string }> = [
  { key: "salience", label: "Issues at stake" },
  { key: "competitiveness", label: "Race closeness" },
  { key: "access", label: "Voting access" },
  { key: "contact", label: "Campaign contact" },
  { key: "saturation", label: "Repeated contact fatigue" },
];

/** Plain-language explanation of the turnout rate the engine used this turn. */
export function ParticipationLedgerCard({ data }: { data?: ParticipationSummary | null }) {
  if (!data) return null;
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted">Why people are voting</h3>
        <span className="text-xs tabular-nums text-muted">{data.calibrationId}</span>
      </div>
      <p className="mb-3 text-xs leading-snug text-muted">
        Turnout starts with this electorate&apos;s usual rate, then responds to the race and
        campaign.
      </p>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-3 border-b border-card-border pb-1.5">
          <span className="font-medium">Usual turnout</span>
          <span className="tabular-nums">{data.baseline.toFixed(1)}%</span>
        </div>
        {ROWS.map((row) => {
          const value = data[row.key] as number;
          const tone =
            value < -0.05 ? "text-red-500" : value > 0.05 ? "text-emerald-500" : "text-muted";
          return (
            <div key={row.key} className="flex justify-between gap-3">
              <span className="text-muted">{row.label}</span>
              <span className={`tabular-nums font-medium ${tone}`}>{points(value)}</span>
            </div>
          );
        })}
        <div className="mt-2 flex justify-between gap-3 border-t border-card-border pt-2">
          <span className="font-semibold">Expected turnout</span>
          <span className="tabular-nums font-bold">{data.resolvedTurnout.toFixed(1)}%</span>
        </div>
      </div>
    </section>
  );
}
