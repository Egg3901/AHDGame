/**
 * Per-state demographic carve-up panel.
 *
 * Shows a conic-gradient pie chart of candidate slices in the currently
 * selected state, plus a breakdown row per candidate (avatar pill, name,
 * archetype tag, percent, bar). The slices come from the view-model
 * (Task 4.4) which runs `calcAppeal` against the per-state demographics.
 *
 * Renders an honest empty state when no candidate has run in this state
 * yet — no fake numbers, no "0%" pie.
 *
 * Pure presentational; the parent decides which state is selected.
 *
 * See plan §"Phase 4 — Tasks" 4.3.
 */

export interface CarveUpSlice {
  candidateId: string;
  candidateName: string;
  /** Hex color of the candidate's party. */
  color: string;
  /** Optional archetype tag (e.g. "Populist", "Moderate"). */
  archetype?: string;
  /** Slice percent in 0..100. Sum across slices should equal 100. */
  pct: number;
}

export function CarveUpPanel({
  stateName,
  stateId,
  slices,
  topDemographics,
  /** Optional registration base label, e.g. "4.8M" — display only. */
  registrationBase,
  /** Optional deep-link to the per-state primary detail page. */
  detailHref,
}: {
  stateName: string;
  stateId: string;
  slices: CarveUpSlice[];
  topDemographics?: string[];
  registrationBase?: string;
  detailHref?: string;
}) {
  const hasSlices = slices.length > 0 && slices.some((s) => s.pct > 0);
  // Sort largest slice first for the breakdown rows; conic-gradient walks the
  // slices in this order so the pie matches the row ordering.
  const sortedSlices = [...slices].sort((a, b) => b.pct - a.pct);

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {stateName} · Carve-up
        </h3>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted">{stateId}</span>
          {detailHref ? (
            <a href={detailHref} className="font-medium underline opacity-80 hover:opacity-100">
              View state details →
            </a>
          ) : null}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted leading-snug">
        Each candidate&rsquo;s slice = registered voters &times; archetype &times; demographic
        affinity. Position alignment + influence drive appeal; favorability scales votes at
        resolution.
      </p>

      {!hasSlices ? (
        <p className="text-xs italic text-muted">
          No projected slices for {stateName} yet — the carve-up populates once candidates have
          filed for this primary.
        </p>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            className="relative shrink-0 self-center rounded-full"
            style={{
              width: 160,
              height: 160,
              boxShadow: "0 2px 12px rgba(0,0,0,0.08), inset 0 0 0 4px var(--card)",
              background: `conic-gradient(${buildConicGradient(sortedSlices)})`,
            }}
          >
            <div
              className="absolute inset-[28px] flex flex-col items-center justify-center rounded-full bg-card"
              style={{ boxShadow: "inset 0 0 0 1px var(--card-border)" }}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Reg base
              </span>
              <span className="text-lg font-bold tabular-nums">{registrationBase ?? "—"}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {topDemographics && topDemographics.length > 0 ? (
              <div className="mb-2">
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  Top demographics:{" "}
                </span>
                <span className="text-[11px]">{topDemographics.slice(0, 4).join(" · ")}</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              {sortedSlices.map((s) => (
                <div key={s.candidateId} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold truncate">{s.candidateName}</span>
                      <span className="tabular-nums font-bold" style={{ color: s.color }}>
                        {s.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {s.archetype ? (
                        <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                          {s.archetype}
                        </span>
                      ) : null}
                      <div className="relative h-1 flex-1 rounded-full bg-background overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, s.pct)}%`, backgroundColor: s.color }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Build the conic-gradient stops string. Each slice gets a "color start% end%"
 * triple where end = start + pct. Slices with pct=0 are skipped (browsers
 * accept them but they create gradient noise).
 */
export function buildConicGradient(slices: CarveUpSlice[]): string {
  let cursor = 0;
  const stops: string[] = [];
  for (const s of slices) {
    if (s.pct <= 0) continue;
    stops.push(`${s.color} ${cursor}% ${cursor + s.pct}%`);
    cursor += s.pct;
  }
  return stops.length > 0 ? stops.join(", ") : "var(--card-border) 0% 100%";
}
