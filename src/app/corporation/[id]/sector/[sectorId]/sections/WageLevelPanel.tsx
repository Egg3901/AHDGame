"use client";

import Link from "next/link";
import { Slider } from "@/components/ui";
import { WAGE_LEVEL_MIN, WAGE_LEVEL_MAX } from "@/lib/labour/laborCost";
import type { SectorData } from "../types";

interface WageLevelPanelProps {
  sector: SectorData;
  isCeo: boolean;
  wageDraft: number;
  wageSaving: boolean;
  wageMessage: string;
  /** True when the last save attempt failed — drives the message colour without parsing copy. */
  wageError?: boolean;
  onWageChange: (value: number) => void;
  onSave: () => void;
}

/** Round a wage level to a clean slider step and avoid float dust (e.g. 1.0500000001). */
function roundWage(value: number): number {
  return Math.round(value * 20) / 20; // 0.05 steps
}

function pctVsBaseline(level: number): string {
  const pct = Math.round((level - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export default function WageLevelPanel({
  sector,
  isCeo,
  wageDraft,
  wageSaving,
  wageMessage,
  wageError,
  onWageChange,
  onSave,
}: WageLevelPanelProps) {
  const activeLevel = sector.wageLevel ?? 1;
  const draft = roundWage(wageDraft);
  const aboveBaseline = draft > 1;
  const floorBinds = sector.minWageUplift != null && sector.minWageUplift > 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="mb-1 text-lg font-bold text-foreground">Wage Level</h2>
      <p className="text-xs text-muted mb-4">
        What this sector pays its workers, as a multiple of the market baseline for this industry.
        {floorBinds
          ? " A national minimum-wage floor is in force here, so your effective pay is lifted above 1.00× no matter what you set (see the floor tag below)."
          : " 1.00× is cost-neutral."}{" "}
        Paying more cuts profit now but eases labour pressure and slows unionization; paying less
        lifts profit now at the cost of worker goodwill.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
        <span
          className="text-xs text-muted"
          title="Your chosen wage lever for this sector, versus the industry baseline. This is the number you control with the slider."
        >
          Your setting:{" "}
          <span className="text-foreground font-medium">
            {activeLevel.toFixed(2)}× baseline ({pctVsBaseline(activeLevel)})
          </span>
        </span>
        {sector.payVsMedian != null && (
          <span
            className="text-xs text-muted"
            title="What this sector actually pays compared with the median wage across the region. Reflects the floor and other effects, so it can differ from your setting."
          >
            Actual pay:{" "}
            <span className="text-foreground font-medium">
              {sector.payVsMedian.toFixed(2)}× regional median
            </span>
          </span>
        )}
        {floorBinds && (
          <span
            className="rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
            title="A national minimum-wage law forces labour costs up by this much here, regardless of your wage setting."
          >
            Minimum-wage floor: +{Math.round(sector.minWageUplift! * 100)}% labour cost
          </span>
        )}
      </div>
      {sector.unionWageDemand != null && (
        <div className="mb-4 rounded-lg border border-dashed border-purple-500/35 bg-purple-500/5 p-3 text-xs">
          <span className="font-medium text-purple-300">
            {sector.unionId ? (
              <Link href={`/unions/${sector.unionId}`} className="hover:underline">
                A union is demanding a {sector.unionWageDemand.toFixed(2)}× wage level
              </Link>
            ) : (
              <>A union is demanding a {sector.unionWageDemand.toFixed(2)}× wage level</>
            )}
          </span>{" "}
          <span className="text-muted">
            for this industry
            {activeLevel < sector.unionWageDemand
              ? ". Your current wage does not meet it, which keeps strike pressure elevated."
              : "."}
          </span>
        </div>
      )}
      {isCeo && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Slider
              min={WAGE_LEVEL_MIN}
              max={WAGE_LEVEL_MAX}
              step={0.05}
              value={draft}
              onChange={(e) => onWageChange(roundWage(Number(e.target.value)))}
              variant={aboveBaseline ? "error" : "success"}
              className="flex-1"
            />
            <input
              type="number"
              min={WAGE_LEVEL_MIN}
              max={WAGE_LEVEL_MAX}
              step={0.05}
              value={draft}
              onChange={(e) =>
                onWageChange(
                  roundWage(
                    Math.max(WAGE_LEVEL_MIN, Math.min(WAGE_LEVEL_MAX, Number(e.target.value)))
                  )
                )
              }
              className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
            <span className="text-sm text-muted">×</span>
            <button
              onClick={onSave}
              disabled={wageSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {wageSaving ? "Saving..." : "Set Wage"}
            </button>
          </div>
          {wageMessage && (
            <p className={`text-xs font-medium ${wageError ? "text-error" : "text-success"}`}>
              {wageMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
