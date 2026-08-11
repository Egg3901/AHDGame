"use client";

import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import type { CountrySectorMixEntry } from "@/lib/economy/sectorMix";
import { avgGrowthTone, formatAvgGrowth } from "@/lib/economy/sectorGrowth";
import { regionUrl } from "@/lib/urls";

const TONE_CLASS = {
  success: "text-success",
  error: "text-error",
  neutral: "text-muted",
} as const;

interface NationalSectorBoardProps {
  countryId: CountryId | string;
  sectorMix: CountrySectorMixEntry[];
  /** Formats a ₳ market size in the country's home currency. */
  formatMarket: (value: number) => string;
}

/**
 * The state sector board aggregated one level up: every sector as a tile with
 * the national market size, owned-share fill, and a drill-down into the
 * largest state's Economy tab via the existing `?sector=` deep link — no new
 * plumbing. Sectors without any market render as plain tiles.
 */
export function NationalSectorBoard({
  countryId,
  sectorMix,
  formatMarket,
}: NationalSectorBoardProps) {
  const sorted = [...sectorMix].sort((a, b) => b.totalMarketAnchor - a.totalMarketAnchor);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {sorted.map((entry) => {
        const body = (
          <>
            <div className="truncate text-xs font-semibold text-foreground">{entry.label}</div>
            <div className="mt-1 font-mono text-[13px] font-bold tabular-nums text-foreground">
              {entry.totalMarketAnchor > 0 ? formatMarket(entry.totalMarketAnchor) : "—"}
            </div>
            <div
              className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-track"
              title={`Owned share ${Math.round(entry.ownedPercent)}%`}
            >
              <div
                className="h-full rounded-full bg-secondary"
                style={{ width: `${Math.max(0, Math.min(100, entry.ownedPercent))}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between gap-1 text-[9.5px]">
              <span className="truncate text-muted">
                {entry.largestState ? `↳ ${entry.largestState.stateName}` : "no market"}
              </span>
              <span
                className={`font-mono tabular-nums ${TONE_CLASS[avgGrowthTone(entry.avgGrowth)]}`}
                title="Average growth across this sector's corporations"
              >
                {formatAvgGrowth(entry.avgGrowth)}
              </span>
            </div>
          </>
        );

        if (!entry.largestState) {
          return (
            <div
              key={entry.type}
              className="rounded-lg border border-card-border bg-card-muted/40 p-2.5 opacity-70"
            >
              {body}
            </div>
          );
        }
        return (
          <Link
            key={entry.type}
            href={`${regionUrl(countryId, entry.largestState.stateId)}?tab=economy&sector=${entry.type}`}
            title={`Open ${entry.largestState.stateName} — the largest ${entry.label} market — Economy tab, pre-filtered to ${entry.label}`}
            className="block rounded-lg border border-card-border bg-card p-2.5 transition-colors hover:border-foreground/30"
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}

export default NationalSectorBoard;
