"use client";

interface ResultsProgressBarProps {
  unitsReporting: number;
  totalUnits: number;
  unitsCalled: number;
  unitLabel: string;
  isLive: boolean;
}

/** "38 of 51 states reporting" with an animated fill and called/too-close split. */
export function ResultsProgressBar({
  unitsReporting,
  totalUnits,
  unitsCalled,
  unitLabel,
  isLive,
}: ResultsProgressBarProps) {
  const reportingPct = totalUnits > 0 ? (unitsReporting / totalUnits) * 100 : 0;
  const calledPct = totalUnits > 0 ? (unitsCalled / totalUnits) * 100 : 0;
  const tooClose = unitsReporting - unitsCalled;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {unitsReporting} of {totalUnits} {unitLabel} reporting
        </span>
        <span className="text-xs text-muted tabular-nums">
          {unitsCalled} called{tooClose > 0 ? ` · ${tooClose} too close` : ""}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-card-border">
        {/* Reporting fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/40 transition-[width] duration-1000 ease-out"
          style={{ width: `${reportingPct}%` }}
        />
        {/* Called fill on top */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-1000 ease-out ${
            isLive ? "animate-pulse" : ""
          }`}
          style={{ width: `${calledPct}%` }}
        />
      </div>
    </div>
  );
}
