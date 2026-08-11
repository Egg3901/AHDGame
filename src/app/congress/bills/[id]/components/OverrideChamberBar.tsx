export function OverrideChamberBar({
  label,
  votesFor,
  total,
}: {
  label: string;
  /** Seat-weighted "for" votes in this chamber. */
  votesFor: number;
  /** Total seats in this chamber (the 2/3 threshold is measured against seats). */
  total: number;
}) {
  const forPct = total > 0 ? (votesFor / total) * 100 : 0;
  const threshold = 66.7; // 2/3 of seats
  const needed = Math.ceil((2 / 3) * total);
  const met = votesFor >= needed;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted font-medium">{label}</span>
        <span className="tabular-nums">
          <span className={met ? "text-success" : "text-amber-400"}>{votesFor}</span>
          <span className="text-muted">
            {" "}
            / {total} seats · need {needed}
          </span>
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-card-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${met ? "bg-success" : "bg-amber-500"}`}
          style={{ width: `${Math.min(100, forPct)}%` }}
        />
        {/* 2/3 threshold marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/60"
          style={{ left: `${threshold}%` }}
          title="2/3 required"
        />
      </div>
    </div>
  );
}
