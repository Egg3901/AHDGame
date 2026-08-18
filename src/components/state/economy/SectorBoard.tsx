"use client";

import type { CorporationType } from "@/lib/constants/corporations";
import { avgGrowthTone, formatAvgGrowth } from "@/lib/economy/sectorGrowth";

const TONE_CLASS = {
  success: "text-success",
  error: "text-error",
  neutral: "text-muted",
} as const;

export interface SectorBoardTile {
  type: CorporationType;
  label: string;
  /** Total daily market size (₳-scale; caller supplies the formatter). */
  totalMarket: number;
  /** Corporate-owned share of the market, 0–100. */
  ownedPercent: number;
  /** Regional specialization mark (primary/secondary + margin bonus in pp). */
  star?: { rank: "primary" | "secondary"; bonus: number } | null;
  /** Mean target growth across this sector's corps (%/yr), or null. */
  avgGrowth: number | null;
}

interface SectorBoardProps {
  tiles: SectorBoardTile[];
  selectedType: CorporationType;
  onSelect: (type: CorporationType) => void;
  /** Formats a market size in the sector's home currency. */
  formatMarket: (value: number) => string;
  /**
   * Show every tile at all breakpoints instead of the mobile-collapse behaviour
   * (below sm, only the selected tile shows full-width). Set when the board is
   * used as a full breakdown grid rather than the page's primary selector.
   */
  showAllTiles?: boolean;
}

/**
 * The sector board — every sector visible at once as a selectable tile
 * (market size, owned-share fill, ★ specialization), replacing the old blind
 * `<select>` dropdown. Pure presentation: selection state and data shaping
 * stay in `StateEconomy`.
 */
export function SectorBoard({
  tiles,
  selectedType,
  onSelect,
  formatMarket,
  showAllTiles = false,
}: SectorBoardProps) {
  const sorted = [...tiles].sort((a, b) => b.totalMarket - a.totalMarket);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
      {sorted.map((tile) => {
        const isSelected = tile.type === selectedType;
        return (
          <button
            key={tile.type}
            type="button"
            data-sector={tile.type}
            aria-pressed={isSelected}
            onClick={() => onSelect(tile.type)}
            className={`rounded-lg border p-3 pb-2.5 text-left transition-colors ${
              isSelected
                ? showAllTiles
                  ? "border-primary bg-primary/5"
                  : "border-primary bg-primary/5 col-span-2 sm:col-span-1"
                : showAllTiles
                  ? "border-card-border bg-card hover:border-foreground/30"
                  : "hidden border-card-border bg-card hover:border-foreground/30 sm:block"
            }`}
          >
            <div className="flex min-h-4 items-baseline justify-between gap-1.5">
              <span className="truncate text-xs font-semibold text-foreground">{tile.label}</span>
              {tile.star && (
                <span
                  className="whitespace-nowrap text-[9.5px] font-bold text-gold"
                  title={`${tile.star.rank === "primary" ? "Primary" : "Secondary"} regional specialization — +${tile.star.bonus}pp profit margin for this sector here`}
                >
                  ★ {tile.star.rank === "primary" ? "1st" : "2nd"} +{tile.star.bonus}pp
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-sm font-bold tabular-nums text-foreground">
              {formatMarket(tile.totalMarket)}
            </div>
            <div className="text-[9.5px] text-muted">market /day</div>
            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-track"
              title={`Owned share ${Math.round(tile.ownedPercent)}%`}
            >
              <div
                className="h-full rounded-full bg-secondary"
                style={{ width: `${Math.max(0, Math.min(100, tile.ownedPercent))}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9.5px]">
              <span className="text-muted">Avg. Growth</span>
              <span
                className={`font-mono tabular-nums ${TONE_CLASS[avgGrowthTone(tile.avgGrowth)]}`}
              >
                {formatAvgGrowth(tile.avgGrowth)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
