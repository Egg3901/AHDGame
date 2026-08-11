"use client";

import { scoreColor } from "./scoreColor";

export interface RankedRegion {
  regionId: string;
  regionName: string;
  value: number;
  rank: number;
}

interface RegionRankingListProps {
  /** Regions pre-sorted best→worst with a `rank` on each. */
  ranked: RankedRegion[];
  /** Value → 0–100 score (for color). */
  scoreOf: (value: number) => number;
  /** Value → display string. */
  fmt: (value: number) => string;
  /** Optional click handler (makes rows interactive). */
  onPick?: (regionId: string) => void;
  /** Currently highlighted region id. */
  picked?: string | null;
}

/**
 * Readable region ranking: `#rank · name · proportional bar · value`. Robust to
 * long currency values (no truncated names, no overflowing numbers) — replaces
 * the cramped Top/Bottom-5 grid.
 */
export function RegionRankingList({
  ranked,
  scoreOf,
  fmt,
  onPick,
  picked,
}: RegionRankingListProps) {
  if (ranked.length === 0) {
    return <p className="text-[11px] text-muted">No regional data.</p>;
  }
  const vals = ranked.map((r) => r.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const clickable = !!onPick;
  return (
    <div className="space-y-1">
      {ranked.map((rv) => {
        const hex = scoreColor(scoreOf(rv.value));
        const active = picked === rv.regionId;
        const w = 12 + ((rv.value - lo) / span) * 88; // 12–100%
        const shortName = rv.regionName.split(" · ")[0];
        return (
          <button
            key={rv.regionId}
            onClick={() => onPick?.(rv.regionId)}
            disabled={!clickable}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-all ${
              active ? "border-primary/70 bg-primary/[0.08]" : "border-card-border bg-card-muted"
            } ${clickable ? "hover:border-primary/40" : "cursor-default"}`}
          >
            <span
              className="w-6 shrink-0 text-center text-[11px] font-bold tabular-nums"
              style={{ color: hex }}
            >
              #{rv.rank}
            </span>
            <span
              className="w-20 shrink-0 truncate text-[12px] font-medium text-foreground sm:w-24"
              title={rv.regionName}
            >
              {shortName}
            </span>
            <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-card sm:block">
              <span
                className="block h-full rounded-full"
                style={{ width: w + "%", background: hex }}
              />
            </span>
            <span
              className="ml-auto shrink-0 text-[12px] font-bold tabular-nums sm:ml-0"
              style={{ color: hex }}
            >
              {fmt(rv.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default RegionRankingList;
