"use client";

export interface RegionValue {
  regionId: string;
  name: string;
  value: number;
}

const MINUS = "−";

/**
 * Per-region breakdown for one metric. Storage is per region and the national
 * figure is the population-weighted mean, so this table shows the spread
 * honestly. The bars share one neutral colour; the figure beside each is the
 * score itself.
 */
export function RegionBreakdown({
  nationalValue,
  regions,
}: {
  nationalValue: number;
  regions: RegionValue[];
}) {
  const sorted = [...regions].sort((a, b) => b.value - a.value);
  return (
    <section aria-labelledby="pm-region-breakdown">
      <h3 id="pm-region-breakdown" className="text-heading-sm font-semibold text-foreground">
        Regional breakdown
      </h3>
      <table
        aria-labelledby="pm-region-breakdown"
        className="mt-3 w-full max-w-2xl border-collapse"
      >
        <thead>
          <tr className="border-b border-card-border text-left text-body-sm text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Region
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Score
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              vs national
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const delta = Math.round(r.value - nationalValue);
            const deltaTxt =
              delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `${MINUS}${Math.abs(delta)}`;
            return (
              <tr key={r.regionId} className="border-b border-card-border/60 last:border-b-0">
                <th
                  scope="row"
                  className="py-2 pr-3 text-left text-body font-normal text-foreground"
                >
                  {r.name}
                </th>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-card-border sm:block"
                    >
                      <span
                        className="block h-full rounded-full bg-foreground/60"
                        style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }}
                      />
                    </span>
                    <span className="font-mono text-body font-semibold tabular-nums text-foreground">
                      {Math.round(r.value)}
                    </span>
                  </span>
                </td>
                <td className="py-2 pl-3 text-right font-mono text-body tabular-nums text-muted">
                  {deltaTxt}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
