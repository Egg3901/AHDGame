"use client";

import { Tooltip } from "@/components/ui";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

export interface EstimateBoxProps {
  /** "projection" = pre/next-click estimate; "last" = the result of the last spend. */
  variant: "projection" | "last";
  /** Color accent: green for Build, red for Contest. */
  tone: "build" | "contest";
  cost: {
    /** Effective PS cost (base + pressure ladder). */
    effectivePS: number;
    /** Base PS cost before the ladder. */
    basePS: number;
    /** Ladder escalation on top of base (0 when no pressure). */
    ladderPS: number;
  };
  /**
   * Optional funds cost. Build Org charges treasury alongside PS from
   * 2026-09-02; `fundedFraction` below 1 means the treasury can only part-fund
   * the click. A successful Build Org click still deposits one fixed unit.
   */
  funds?: {
    amount: number;
    currencyCode: string;
    fundedFraction?: number;
    /**
     * Per-state size multiplier folded into `amount`. Shown so a player in a
     * large state can see why the same action costs more here than next door.
     */
    sizeMultiplier?: number;
  };
  gain: {
    /** Row label, e.g. "Estimated Gain" (Build) or "Estimated Effect" (Contest). */
    label: string;
    value: number;
    sign: "+" | "−";
    unit: string;
    /** Contest only — true when the reduction hit the defense floor. */
    clamped?: boolean;
  };
}

/**
 * Unified estimate box for the PS-spend Org actions (Build Org / Contest).
 * Leads with the two numbers that matter (cost + gain), then a quieter
 * "why this gain" factor breakdown underneath.
 */
export function EstimateBox({ variant, tone, cost, funds, gain }: EstimateBoxProps) {
  const title = variant === "projection" ? "This click" : "Last click";
  const costLabel = variant === "projection" ? "Cost" : "Cost";
  const gainValueColor = tone === "build" ? "text-success" : "text-error";
  const fundsSymbol = funds
    ? (CURRENCY_SYMBOLS[funds.currencyCode as keyof typeof CURRENCY_SYMBOLS] ?? "$")
    : "";

  return (
    <div className="rounded-lg border border-card-border/40 bg-background/50 px-4 py-3 space-y-3">
      <div className="text-body-sm font-medium text-muted">{title}</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-card-border/30 bg-card/50 px-3 py-2">
          <div className="flex items-center text-body-sm font-medium text-muted">
            {costLabel}
            <Tooltip
              label="About the build cost"
              content="Political Strength (PS) cost. It starts at the base cost and goes up by 1 for each recent build in this state, fading by 3 per turn once you stop. The money price rises with it and comes out of the treasury of whichever party (state or national) pays the PS."
            />
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums leading-none">
            {cost.effectivePS.toFixed(0)}
            <span className="ml-1 text-xs font-medium text-muted">PS</span>
          </div>
          {cost.ladderPS > 0 ? (
            <div className="mt-1 text-[10px] text-muted tabular-nums">
              base {cost.basePS.toFixed(0)} + {cost.ladderPS.toFixed(0)} for recent builds
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-muted">Base cost (no recent builds here)</div>
          )}
        </div>

        <div className="rounded-md border border-card-border/30 bg-card/50 px-3 py-2">
          <div className="flex items-center text-body-sm font-medium text-muted">
            {gain.label.includes("Effect") ? "Effect" : "Organization share"}
            <Tooltip
              label="About Organization share"
              content="Expected change to your party's share of this state's organization after one build. Parties that have built here for longer keep the advantage of everything they have built."
            />
          </div>
          <div className={`mt-1 text-lg font-bold tabular-nums leading-none ${gainValueColor}`}>
            {gain.sign}
            {gain.value.toFixed(2)}
            <span className="ml-1 text-xs font-medium text-muted">{gain.unit}</span>
          </div>
          {gain.clamped ? (
            <div className="mt-1 text-[10px] text-muted">Floor-clamped</div>
          ) : (
            <div className="mt-1 text-[10px] text-muted">Derived from bucket share</div>
          )}
        </div>
      </div>

      {funds ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">
              {variant === "projection" ? "Estimated funds" : "Funds"}
            </span>
            <span className="font-bold tabular-nums">
              {fundsSymbol}
              {Math.round(funds.amount).toLocaleString("en-US")}
            </span>
          </div>
          {funds.sizeMultiplier !== undefined && Math.abs(funds.sizeMultiplier - 1) >= 0.05 ? (
            <div className="text-[10px] text-muted">
              {funds.sizeMultiplier > 1 ? "Larger" : "Smaller"} state:{" "}
              {funds.sizeMultiplier.toFixed(2)}× the national average price, because a point of Org
              here is worth {funds.sizeMultiplier > 1 ? "more" : "less"}.
            </div>
          ) : null}
          {funds.fundedFraction !== undefined && funds.fundedFraction < 1 ? (
            <div className="text-[10px] text-warning">
              Partly funded: the treasury covers {Math.round(funds.fundedFraction * 100)}% of this
              click.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
