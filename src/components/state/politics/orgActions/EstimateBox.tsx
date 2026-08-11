"use client";

import { Tooltip } from "@/components/ui";
import { FactorBreakdown, type BuildOrgFactors } from "@/components/state/politics/FactorBreakdown";
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
  /** Optional funds cost. Rendered only when present — PS-only today. */
  funds?: { amount: number; currencyCode: string };
  gain: {
    /** Row label, e.g. "Estimated Gain" (Build) or "Estimated Effect" (Contest). */
    label: string;
    value: number;
    sign: "+" | "−";
    unit: string;
    /** Contest only — true when the reduction hit the defense floor. */
    clamped?: boolean;
  };
  factors: BuildOrgFactors;
}

/**
 * Unified estimate box for the PS-spend Org actions (Build Org / Contest).
 * Leads with the two numbers that matter (cost + gain), then a quieter
 * "why this gain" factor breakdown underneath.
 */
export function EstimateBox({ variant, tone, cost, funds, gain, factors }: EstimateBoxProps) {
  const title = variant === "projection" ? "This click" : "Last click";
  const costLabel = variant === "projection" ? "Cost" : "Cost";
  const gainValueColor = tone === "build" ? "text-success" : "text-error";
  const fundsSymbol = funds
    ? (CURRENCY_SYMBOLS[funds.currencyCode as keyof typeof CURRENCY_SYMBOLS] ?? "$")
    : "";

  return (
    <div className="rounded-lg border border-card-border/40 bg-background/50 px-4 py-3 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-card-border/30 bg-card/50 px-3 py-2">
          <div className="flex items-center text-[10px] font-medium uppercase tracking-wide text-muted">
            {costLabel}
            <Tooltip
              label="About Build Org cost"
              content="Base Political Strength (PS) cost plus a per-state pressure ladder that rises after each spend in this state. Higher pressure = more PS per click."
            />
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums leading-none">
            {cost.effectivePS.toFixed(0)}
            <span className="ml-1 text-xs font-medium text-muted">PS</span>
          </div>
          {cost.ladderPS > 0 ? (
            <div className="mt-1 text-[10px] text-muted tabular-nums">
              base {cost.basePS.toFixed(0)} + ladder {cost.ladderPS.toFixed(0)}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-muted">Base cost (no ladder yet)</div>
          )}
        </div>

        <div className="rounded-md border border-card-border/30 bg-card/50 px-3 py-2">
          <div className="flex items-center text-[10px] font-medium uppercase tracking-wide text-muted">
            {gain.label.includes("Effect") ? "Effect" : "Org gain"}
            <Tooltip
              label="About Org gain"
              content="Expected Org% gained this click. Sourced from the unaffiliated pool first, then by poaching rivals. Scales with open pool, growth pace, Political Strength (PS) leverage, and catch-up."
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
            <div className="mt-1 text-[10px] text-muted">Pool + rival poach</div>
          )}
        </div>
      </div>

      {funds ? (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted">
            {variant === "projection" ? "Estimated Funds" : "Funds"}
          </span>
          <span className="font-bold tabular-nums">
            {fundsSymbol}
            {funds.amount.toLocaleString("en-US")}
          </span>
        </div>
      ) : null}

      <FactorBreakdown factors={factors} showLabel />
    </div>
  );
}
