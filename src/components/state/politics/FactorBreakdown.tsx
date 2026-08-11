"use client";

/**
 * Shared 4-factor breakdown display for the unified Build Org action.
 *
 * Each factor is a compact row with a short label, value, and hover-tooltip.
 * Used by the Build Org estimate so the math stays explainable without a
 * dense 2×2 tile grid of cryptic abbreviations.
 */

import { Tooltip } from "@/components/ui";

export interface BuildOrgFactors {
  base: number;
  headroom: number;
  ownDiminishing: number;
  psLeverage: number;
  catchup: number;
}

const FACTOR_TOOLTIPS: Record<keyof Omit<BuildOrgFactors, "base">, string> = {
  headroom:
    "Unaffiliated pool: share of the state's 100% Org pool not held by any party. Build Org draws from this slice first; the rest is poached from rivals (sized by their Org and your Political Strength (PS) edge, the biggest party included).",
  ownDiminishing:
    "Growth pace from your current Org%. No penalty until 50% Org; above that, each click slows. At 75% Org the multiplier is 0.50×.",
  psLeverage:
    "Your Political Strength (PS) reserve vs the average rival PS in this state. Range: 0.5× to 1.5×. A small party with a hoarded reserve hits harder; a depleted party hits softer.",
  catchup:
    "Anti-snowball multiplier. 1.5× when at least one rival party has higher Org% than yours, 1.0× otherwise.",
};

function formatHeadroom(value: number) {
  if (value <= 0) {
    return { main: "0%", hint: "Pool full. This click poaches rivals only" };
  }
  return {
    main: `${(value * 100).toFixed(0)}%`,
    hint: "Unaffiliated share available to claim",
  };
}

function formatOwnDiminishing(value: number) {
  return {
    main: `${value.toFixed(2)}×`,
    hint: value >= 0.995 ? "No slowdown below 50% Org" : "Slower growth above 50% Org",
  };
}

export function FactorBreakdown({
  factors,
  showLabel = true,
}: {
  factors: BuildOrgFactors;
  showLabel?: boolean;
}) {
  const headroom = formatHeadroom(factors.headroom);
  const ownOrg = formatOwnDiminishing(factors.ownDiminishing);

  const rows: Array<{
    key: keyof Omit<BuildOrgFactors, "base">;
    label: string;
    main: string;
    hint: string;
  }> = [
    {
      key: "headroom",
      label: "Open pool",
      main: headroom.main,
      hint: headroom.hint,
    },
    {
      key: "ownDiminishing",
      label: "Growth pace",
      main: ownOrg.main,
      hint: ownOrg.hint,
    },
    {
      key: "psLeverage",
      label: "PS leverage",
      main: `${factors.psLeverage.toFixed(2)}×`,
      hint: "Your reserve vs average rival PS",
    },
    {
      key: "catchup",
      label: "Catch-up",
      main: `${factors.catchup.toFixed(2)}×`,
      hint: factors.catchup > 1 ? "Behind a rival. Bonus active" : "Even or leading. No bonus",
    },
  ];

  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Why this gain
        </div>
      )}
      <div className="divide-y divide-card-border/30 rounded-md border border-card-border/30 bg-card/40">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="flex items-center text-[11px] font-medium text-foreground">
                {row.label}
                <Tooltip label={`About ${row.label}`} content={FACTOR_TOOLTIPS[row.key]} />
              </div>
              <div className="text-[10px] leading-snug text-muted">{row.hint}</div>
            </div>
            <div className="shrink-0 text-xs font-bold tabular-nums">{row.main}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact pre-click explainer listing the four factors, each with a
 * hover-tooltip. Use when the live estimate has not loaded yet.
 */
export function FactorsExplainer() {
  return (
    <div className="text-[11px] leading-snug text-muted">
      <div className="font-semibold mb-0.5">Gain scales with:</div>
      <ul className="space-y-0.5 ml-3 list-disc">
        <li title={FACTOR_TOOLTIPS.headroom} className="cursor-help">
          Open pool (unaffiliated share) + poach from rivals
        </li>
        <li title={FACTOR_TOOLTIPS.ownDiminishing} className="cursor-help">
          Growth pace (no penalty until 50% Org, then slower)
        </li>
        <li title={FACTOR_TOOLTIPS.psLeverage} className="cursor-help">
          Your PS reserve vs rivals (0.5× to 1.5×)
        </li>
        <li title={FACTOR_TOOLTIPS.catchup} className="cursor-help">
          Catch-up bonus when behind in this state (+50%)
        </li>
      </ul>
    </div>
  );
}
