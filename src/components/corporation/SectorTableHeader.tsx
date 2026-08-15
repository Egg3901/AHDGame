"use client";

import { InfoTooltip } from "@/components/InfoTooltip";
import { MIN_GROWTH_RATE, MAX_GROWTH_RATE } from "@/lib/constants/corporations";
import {
  MONEY_PERIOD_HELP,
  MONEY_PERIOD_LABEL,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";
import { GROWTH_HORIZON_SENTENCE } from "./SectorRowComponents";
import { CAPACITY_UNIT_LABEL } from "./plantsPresentation";

export const SECTOR_TABLE_GRID =
  "grid-cols-[minmax(160px,1.2fr)_minmax(120px,1fr)_minmax(140px,1.5fr)_140px_78px_80px_55px_70px_50px_40px]";

/**
 * Plants-tier grid: nine columns instead of ten.
 *
 * Growth Target and Active Rate are gone (the slider does not build capacity
 * under plants) and Capacity + Fill take their place. Capacity gets the widest
 * of the numeric columns because it carries a second line — the build queue
 * badge — and a wrapped badge is the first thing that makes a dense table look
 * broken.
 */
export const PLANTS_SECTOR_TABLE_GRID =
  "grid-cols-[minmax(160px,1.2fr)_minmax(120px,1fr)_minmax(140px,1.5fr)_112px_72px_86px_86px_56px_40px]";

/** The grid template for the given world. */
export function sectorTableGrid(plantsMode: boolean): string {
  return plantsMode ? PLANTS_SECTOR_TABLE_GRID : SECTOR_TABLE_GRID;
}

export function SectorTableHeader({
  timeScale,
  plantsMode = false,
}: {
  timeScale: MoneyPeriod;
  plantsMode?: boolean;
}) {
  if (plantsMode) return <PlantsSectorTableHeader timeScale={timeScale} />;
  return (
    <div
      className={`hidden lg:grid ${SECTOR_TABLE_GRID} gap-x-3 px-6 py-2 border-b border-card-border text-[10px] font-bold uppercase tracking-widest text-muted`}
    >
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30">Location</span>
        }
        width={200}
      >
        <p className="font-semibold text-foreground mb-1">Location</p>
        <p className="text-muted">State where this sector operates and its industry type.</p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30">Strategy</span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Strategy</p>
        <p className="text-muted">
          Active operating strategy. CEO can switch specializations to change commodity
          inputs/outputs.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={<span className="cursor-help border-b border-dotted border-muted/30">Status</span>}
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Status</p>
        <p className="text-muted">
          Shows active transitions, reversals, or cooldown timers. Strategy changes take 12 turns
          with a 24-turn cooldown.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30">Growth Target</span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Growth Target</p>
        <p className="text-muted">
          {GROWTH_HORIZON_SENTENCE} Allowed range: {MIN_GROWTH_RATE}% to {MAX_GROWTH_RATE}%.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Active Rate
          </span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Active Rate</p>
        <p className="text-muted">
          The growth rate actually applied this turn. It trends toward the target by 0.5pp per turn,
          so revenue and growth cost adjust gradually.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Rev
          </span>
        }
        width={200}
      >
        <p className="font-semibold text-foreground mb-1">
          Revenue ({MONEY_PERIOD_LABEL[timeScale]})
        </p>
        <p className="text-muted">
          Revenue actually earned, after production policy, commodity prices, throughput and
          capacity are applied to your nameplate market share. This is the figure Margin and Profit
          are computed from. Hover a value for the full nameplate → profit chain.
        </p>
        <p className="mt-1 text-muted">{MONEY_PERIOD_HELP}</p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Margin
          </span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Effective Margin</p>
        <p className="text-muted">
          Base margin + state modifiers + commodity effects + home location bonus. Open sector
          detail for full breakdown.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Profit
          </span>
        }
        width={200}
      >
        <p className="font-semibold text-foreground mb-1">Net Profit</p>
        <p className="text-muted">
          Revenue (the realized figure in the Rev column) × effective margin − growth cost. Does not
          include corporate-level overhead (marketing, logistics, CEO salary, taxes).
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto">Jobs</span>
        }
        width={180}
      >
        <p className="font-semibold text-foreground mb-1">Workforce</p>
        <p className="text-muted">Employees in this sector. Provides jobs to the state economy.</p>
      </InfoTooltip>
      <span></span>
    </div>
  );
}

/**
 * Plants-tier header.
 *
 * The vocabulary change is the point: this world's CEO does not set a growth
 * rate, they buy plants. So the table leads with what those plants can make and
 * how much of it is finding a buyer, and revenue becomes the RESULT of those
 * two rather than an input the player tunes.
 */
function PlantsSectorTableHeader({ timeScale }: { timeScale: MoneyPeriod }) {
  return (
    <div
      className={`hidden lg:grid ${PLANTS_SECTOR_TABLE_GRID} gap-x-3 px-6 py-2 border-b border-card-border text-[10px] font-bold uppercase tracking-widest text-muted`}
    >
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30">Location</span>
        }
        width={200}
      >
        <p className="font-semibold text-foreground mb-1">Location</p>
        <p className="text-muted">
          State where a sector&apos;s facilities operate and their industry type.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30">Strategy</span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Strategy</p>
        <p className="text-muted">
          Active operating strategy. Changing it retools the plants, which rescales their capacity
          to the new output mix.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={<span className="cursor-help border-b border-dotted border-muted/30">Status</span>}
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Status</p>
        <p className="text-muted">
          Transitions, cooldowns, and whether the plants are mothballed or still under construction.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Capacity
          </span>
        }
        width={230}
      >
        <p className="font-semibold text-foreground mb-1">Capacity ({CAPACITY_UNIT_LABEL})</p>
        <p className="text-muted">
          What these plants can make in one financial day, in output units. This is what you buy
          when you build. A blue badge under the number is capacity you have already paid for that
          is still under construction, with the turns until it comes online.
        </p>
        <p className="mt-1 text-muted">
          Always shown per day. The per-turn and yearly toggle rescales the money columns only, so
          capacity does not move when you switch it.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Fill
          </span>
        }
        width={240}
      >
        <p className="font-semibold text-foreground mb-1">Fill rate</p>
        <p className="text-muted">
          The share of what these plants produced that actually sold. Low fill means you are making
          units nobody is buying: you are paying to run capacity that earns nothing.
        </p>
        <p className="mt-1 text-muted">
          For corporations you do not run, this shows a broad band instead of the exact figure.
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Revenue
          </span>
        }
        width={230}
      >
        <p className="font-semibold text-foreground mb-1">
          Revenue ({MONEY_PERIOD_LABEL[timeScale]})
        </p>
        <p className="text-muted">
          What the units you sold were worth. Under plants there is only one revenue figure: it is
          derived from capacity, output and sales rather than tracked separately, so there is no
          nameplate figure to reconcile against.
        </p>
        <p className="mt-1 text-muted">{MONEY_PERIOD_HELP}</p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto whitespace-nowrap">
            Profit
          </span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Net Profit</p>
        <p className="text-muted">
          Revenue × effective margin, less upkeep. The margin is shown under the figure so the
          arithmetic is checkable on the row. Does not include corporate overhead (marketing,
          logistics, CEO salary, taxes).
        </p>
      </InfoTooltip>
      <InfoTooltip
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/30 ml-auto">Jobs</span>
        }
        width={180}
      >
        <p className="font-semibold text-foreground mb-1">Workforce</p>
        <p className="text-muted">
          Employees in a sector&apos;s facilities. Provides jobs to the state economy.
        </p>
      </InfoTooltip>
      <span></span>
    </div>
  );
}
