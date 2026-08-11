"use client";

import { AllocationBar, CostMixList, MarginGauge } from "./FinancialsVisuals";
import { buildAllocation, netMarginPct } from "./financialsModel";
import type { MoneyPeriod } from "@/lib/constants/moneyTimescale";
import type { Financials, BondInfo } from "../CorporationPageTypes";

const CREDIT_TONE = (score: number) =>
  score >= 70 ? "text-success" : score >= 40 ? "text-warning" : "text-error";

export function GlanceRail({
  financials,
  bondInfo,
  periodView,
  fmt,
  creditRatingLabel,
  creditScore,
}: {
  financials: Financials;
  bondInfo: BondInfo | null;
  periodView: MoneyPeriod;
  fmt: (v: number) => string;
  /**
   * Announced (persisted-snapshot) credit rating + score, matching the hero and
   * the credit-rating-change notification. Falls back to the live bondInfo
   * recompute when absent (legacy corps). (#925)
   */
  creditRatingLabel?: string;
  creditScore?: number;
}) {
  const alloc = buildAllocation(financials, periodView);
  const margin = netMarginPct(financials);
  const marginTone = margin >= 15 ? "up" : margin >= 0 ? "warning" : "down";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Where revenue goes
        </div>
        <AllocationBar
          revenue={alloc.revenue}
          segments={alloc.segments}
          netPct={alloc.netPct}
          netIsLoss={financials.income < 0}
        />
      </div>

      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Cost breakdown
        </div>
        <CostMixList segments={alloc.segments} format={fmt} />
      </div>

      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Health</div>
        <MarginGauge label="Net margin" pct={margin} tone={marginTone} />
        {bondInfo && bondInfo.totalDebt > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Credit rating</span>
            <span
              className={`font-semibold ${CREDIT_TONE(creditScore ?? bondInfo.creditRating.compositeScore)}`}
            >
              {creditRatingLabel ?? bondInfo.creditRating.rating}
              <span className="ml-1.5 text-[10px] text-muted">
                {creditScore ?? bondInfo.creditRating.compositeScore}/100
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
