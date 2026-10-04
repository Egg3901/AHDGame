"use client";

import { MIN_GROWTH_RATE, MAX_GROWTH_RATE } from "@/lib/constants/corporations";
import {
  MONEY_PERIOD_HELP,
  MONEY_PERIOD_LABEL,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";
import { GROWTH_HORIZON_SENTENCE } from "./SectorRowComponents";
import { CAPACITY_UNIT_LABEL } from "./plantsPresentation";
import type { SectorSortKey, SortDir } from "./sectorSortUtils";

export const SECTOR_TABLE_GRID =
  "grid-cols-[minmax(220px,1.8fr)_minmax(120px,1fr)_minmax(72px,0.6fr)_150px_64px_88px_64px_88px_64px_44px]";

/**
 * Plants-tier grid: capacity, sites and fill replace the growth columns (the
 * slider does not build capacity under plants), and the net margin gets its
 * own column instead of a second line under profit.
 */
export const PLANTS_SECTOR_TABLE_GRID =
  "grid-cols-[minmax(220px,1.8fr)_minmax(120px,1fr)_minmax(72px,0.6fr)_80px_56px_64px_88px_88px_88px_64px_44px]";

/** The grid template for the given world. */
export function sectorTableGrid(plantsMode: boolean): string {
  return plantsMode ? PLANTS_SECTOR_TABLE_GRID : SECTOR_TABLE_GRID;
}

interface Column {
  label: string;
  /** Column explanation, shown on hover. */
  help: string;
  sortKey?: SectorSortKey;
  align?: "left" | "right";
}

function columnsFor(plantsMode: boolean, timeScale: MoneyPeriod): Column[] {
  const period = MONEY_PERIOD_LABEL[timeScale].toLowerCase();
  const head: Column[] = [
    {
      label: "Location",
      help: "State where this sector operates, and its industry type.",
      sortKey: "location",
    },
    {
      label: "Strategy",
      help: plantsMode
        ? "Active operating strategy. Changing it retools the plants, which rescales their capacity to the new output mix."
        : "Active operating strategy. The CEO can switch specializations to change commodity inputs and outputs.",
    },
    {
      label: "Status",
      help: plantsMode
        ? "Transitions, cooldowns, and whether the plants are mothballed or still under construction."
        : "Active transitions, reversals and cooldowns. Strategy changes take 12 turns with a 24-turn cooldown.",
    },
  ];
  const tail: Column[] = [
    {
      label: "Profit",
      help: plantsMode
        ? "Revenue times effective margin, less upkeep. Does not include corporate overhead (marketing, logistics, CEO salary, taxes)."
        : "Revenue (the realized figure in the Revenue column) times effective margin, less growth cost. Does not include corporate overhead (marketing, logistics, CEO salary, taxes).",
      sortKey: "profit",
      align: "right",
    },
    {
      label: "Jobs",
      help: "Employees in this sector. Provides jobs to the state economy.",
      sortKey: "workers",
      align: "right",
    },
  ];
  if (plantsMode) {
    return [
      ...head,
      {
        label: "Capacity",
        help: `What these plants can make in one financial day, in ${CAPACITY_UNIT_LABEL}. This is what you buy when you build. Capacity already paid for and under construction shows under the figure. Always per day: the period toggle rescales money only.`,
        sortKey: "capacity",
        align: "right",
      },
      {
        label: "Sites",
        help: "Number of facilities the capacity is spread across.",
        align: "right",
      },
      {
        label: "Fill",
        help: "Share of what these plants produced that actually sold. Low fill means paying to run capacity that earns nothing. For corporations you do not run, this is a broad band instead of the exact figure.",
        sortKey: "fill",
        align: "right",
      },
      {
        label: "Revenue",
        help: `What the units you sold were worth, ${period}. Under plants revenue is derived from capacity, output and sales. ${MONEY_PERIOD_HELP}`,
        sortKey: "revenue",
        align: "right",
      },
      {
        label: "Net margin",
        help: "Profit over revenue, after paying for everything made, unsold units included. The effective margin counts only units that sold.",
        sortKey: "margin",
        align: "right",
      },
      ...tail,
    ];
  }
  return [
    ...head,
    {
      label: "Growth target",
      help: `${GROWTH_HORIZON_SENTENCE} Allowed range: ${MIN_GROWTH_RATE}% to ${MAX_GROWTH_RATE}%.`,
      sortKey: "growthRate",
      align: "right",
    },
    {
      label: "Active",
      help: "The growth rate actually applied this turn, per day. It trends toward the target by 0.5pp per turn, so revenue and growth cost adjust gradually.",
      align: "right",
    },
    {
      label: "Revenue",
      help: `Revenue actually earned, ${period}, after production policy, commodity prices, throughput and capacity are applied to your nameplate market share. Margin and profit are computed from it. Hover a value for the full chain. ${MONEY_PERIOD_HELP}`,
      sortKey: "revenue",
      align: "right",
    },
    {
      label: "Margin",
      help: "Effective margin: base margin plus state modifiers, commodity effects and the home location bonus. Open a sector for the full breakdown.",
      sortKey: "margin",
      align: "right",
    },
    ...tail,
  ];
}

/**
 * Column headings for the sector table. A heading with a sort key is a button:
 * clicking it sorts by that column, clicking again reverses the order.
 */
export function SectorTableHeader({
  timeScale,
  plantsMode = false,
  sortKey,
  sortDir,
  onSort,
}: {
  timeScale: MoneyPeriod;
  plantsMode?: boolean;
  sortKey?: SectorSortKey;
  sortDir?: SortDir;
  onSort?: (key: SectorSortKey) => void;
}) {
  const columns = columnsFor(plantsMode, timeScale);
  return (
    <div
      role="row"
      className={`hidden lg:grid ${sectorTableGrid(plantsMode)} items-end gap-x-3 border-b border-card-border px-2 py-1.5 text-[11px] font-medium text-muted`}
    >
      {columns.map((col) => {
        const active = col.sortKey != null && col.sortKey === sortKey;
        const right = col.align === "right";
        return (
          <span
            key={col.label}
            role="columnheader"
            aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
            className={`min-w-0 truncate ${right ? "text-right" : ""}`}
            title={col.help}
          >
            {col.sortKey && onSort ? (
              <button
                type="button"
                onClick={() => onSort(col.sortKey!)}
                className={`inline-flex items-center gap-1 hover:text-foreground ${
                  right ? "flex-row-reverse" : ""
                } ${active ? "text-foreground" : ""}`}
              >
                <span>{col.label}</span>
                <span aria-hidden className="w-2 text-[9px]">
                  {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </span>
              </button>
            ) : (
              col.label
            )}
          </span>
        );
      })}
      <span role="columnheader" className="sr-only">
        Actions
      </span>
    </div>
  );
}
