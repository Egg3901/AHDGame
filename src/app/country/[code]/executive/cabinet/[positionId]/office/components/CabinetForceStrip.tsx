"use client";

import type { ForceSummaryView } from "../useCabinetOffice";
import { Tile } from "./dossier";
import { fmtMoneyAbs, fmtMoneySigned } from "./military/militaryUi";

const TIER_LABEL: Record<string, string> = {
  reduced: "Reduced",
  standard: "Standard",
  elevated: "Elevated",
};

/** Compact headcount: 1_250_000 → "1.3M", 40_000 → "40K". */
function fmtMen(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("en-US");
}

/** Masthead stat strip for the defense seat — replaces the metric strip with force aggregates. */
export function CabinetForceStrip({
  forceSummary,
  currencySymbol = "$",
  manpowerPool,
}: {
  forceSummary: ForceSummaryView;
  currencySymbol?: string;
  /** Replacement-manpower pool; undefined when the office has no manpower view. */
  manpowerPool?: number;
}) {
  const readyTone =
    forceSummary.avgReadiness >= 70 ? "up" : forceSummary.avgReadiness >= 50 ? "warning" : "down";
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-4 lg:grid-cols-8 lg:divide-y-0">
      <Tile
        label="Combat power"
        value={forceSummary.totalPower.toLocaleString("en-US")}
        tone="gov"
        sub={`${forceSummary.unitCount} units`}
      />
      <Tile
        label="Active personnel"
        value={`${Math.round(forceSummary.totalPersonnel / 1000)}K`}
        sub="force-wide"
      />
      <Tile
        label="Available manpower"
        value={manpowerPool == null ? "—" : fmtMen(manpowerPool)}
        sub="recruitable"
      />
      <Tile
        label="Avg readiness"
        value={`${forceSummary.avgReadiness}%`}
        tone={readyTone}
        sub="force-wide"
      />
      {/*
        The real defence account, and now the only budget on this strip. It used to sit beside
        a synthetic "Defense budget" envelope — a metric threshold, not money, floored at a
        country-independent constant that 26 of 27 live nations landed on exactly. Two
        budget-shaped numbers meant a minister could read either as their spending power; the
        envelope is retired and this is the one that money actually moves through.
      */}
      <Tile
        label="Appropriation"
        value={fmtMoneyAbs(currencySymbol, forceSummary.appropriation)}
        tone={
          forceSummary.arrearsRatio > 0
            ? "down"
            : forceSummary.appropriation < 0
              ? "warning"
              : "gov"
        }
        sub={
          forceSummary.arrearsRatio > 0
            ? `in arrears ${Math.round(forceSummary.arrearsRatio * 100)}%`
            : `${fmtMoneySigned(
                currencySymbol,
                forceSummary.appropriationAccrual - forceSummary.appropriationUpkeep
              )}/turn`
        }
      />
      {/*
        The force's REAL per-turn charge against the appropriation, not the abstract
        `upkeepBase` aggregate this tile used to render through a millions formatter. That
        made a 4,400-point index read as "$4.4B" beside a $52.8B pot, implying the force ate
        8% of the account per turn when it actually ate about 1.1%. Every money-shaped number
        on this strip is now money.
      */}
      <Tile
        label="Force upkeep"
        value={`${fmtMoneyAbs(currencySymbol, forceSummary.appropriationUpkeep)}/turn`}
        tone={
          forceSummary.appropriationUpkeep > forceSummary.appropriationAccrual
            ? "warning"
            : undefined
        }
        sub={
          forceSummary.appropriationAccrual > 0
            ? `${Math.round(
                (forceSummary.appropriationUpkeep / forceSummary.appropriationAccrual) * 100
              )}% of income`
            : "no defence line"
        }
      />
      <Tile
        label="Readiness tier"
        value={TIER_LABEL[forceSummary.tier] ?? "Standard"}
        tone="gov"
        sub="national setting"
      />
    </div>
  );
}
