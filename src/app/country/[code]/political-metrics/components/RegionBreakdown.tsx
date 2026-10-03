"use client";

import { scoreTone } from "./tones";

export interface RegionValue {
  regionId: string;
  name: string;
  value: number;
}

/**
 * Per-region breakdown for one metric — the storage is per-region, national is
 * the population-weighted mean, and this panel shows the spread honestly.
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
    <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
      <div className="mb-3 font-mono text-body-xs uppercase tracking-widest text-muted">
        Regional breakdown
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left font-mono text-body-xs uppercase tracking-wider text-muted">
            <th className="pb-2 font-medium">Region</th>
            <th className="pb-2 font-medium">Score</th>
            <th className="pb-2 text-right font-medium">vs national</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const tone = scoreTone(r.value);
            const delta = Math.round(r.value - nationalValue);
            const deltaTxt = delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
            const deltaTone =
              delta === 0 ? "text-muted" : delta > 0 ? "text-success" : "text-error";
            return (
              <tr key={r.regionId} className="border-t border-dashed border-card-border">
                <td className="py-1.5 pr-2 text-body-sm text-foreground">{r.name}</td>
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 max-w-full overflow-hidden rounded-full bg-track">
                      <span
                        className={`block h-full rounded-full ${tone.bg}`}
                        style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }}
                      />
                    </span>
                    <span className={`text-body-sm font-bold tabular-nums ${tone.text}`}>
                      {Math.round(r.value)}
                    </span>
                  </span>
                </td>
                <td
                  className={`py-1.5 text-right text-body-sm font-bold tabular-nums ${deltaTone}`}
                >
                  {deltaTxt}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
