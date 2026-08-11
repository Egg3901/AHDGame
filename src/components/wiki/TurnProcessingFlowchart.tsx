"use client";

const STEPS = [
  "Action refresh",
  "Fund generation",
  "State party elections",
  "National party elections",
  "NPP endorsements and bill voting",
  "NPP dropout check",
  "NPP election entry",
  "Bill lifecycle",
  "Advance election timers",
  "Record primary snapshots",
  "Accumulate general votes",
  "Resolve completed elections",
  "Ensure perpetual elections",
  "Clean up stale candidates",
];

export function TurnProcessingFlowchart() {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-card-border bg-card/40 p-4">
      <h4 className="mb-4 text-sm font-semibold text-foreground">
        Each turn runs these steps in order:
      </h4>
      <div className="flex flex-col gap-2">
        {STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
              {i + 1}
            </span>
            <span className="text-sm text-muted">{step}</span>
            {i < STEPS.length - 1 && (
              <svg
                className="h-4 w-4 shrink-0 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
