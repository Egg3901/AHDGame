"use client";

import Link from "next/link";
import { economyUrl } from "@/lib/urls";

/**
 * Economic indicators panel (ported from the design prototype `bdebt.jsx`):
 * macro context for the fiscal year — inflation, real GDP growth, wage growth,
 * prime rate, deficit-to-GDP. Driven by `budget.economicFactors` + the prime rate.
 */

function pctSign(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

interface EconomicIndicatorsProps {
  inflationRate: number;
  gdpGrowth: number;
  wageGrowth: number;
  primeRate: number;
  deficitToGdp: number;
  /** When set, the header links to the national Economic Outlook page. */
  countryId?: string;
}

export function EconomicIndicators({
  inflationRate,
  gdpGrowth,
  wageGrowth,
  primeRate,
  deficitToGdp,
  countryId,
}: EconomicIndicatorsProps) {
  const indicators: Array<{ label: string; value: string; note?: string; bad: boolean }> = [
    {
      label: "Inflation",
      value: `${inflationRate.toFixed(1)}%`,
      note: "2% target",
      bad: Math.abs(inflationRate - 2) > 2,
    },
    { label: "Real GDP growth", value: pctSign(gdpGrowth), bad: gdpGrowth < 0 },
    { label: "Wage growth", value: pctSign(wageGrowth), bad: false },
    { label: "Prime rate", value: `${primeRate.toFixed(2)}%`, bad: false },
    { label: "Deficit-to-GDP", value: `${deficitToGdp.toFixed(1)}%`, bad: deficitToGdp < -5 },
  ];

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Economic indicators</div>
        {countryId && (
          <Link
            href={economyUrl(countryId)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Full economic outlook &rarr;
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {indicators.map((ind) => (
          <div key={ind.label}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
              {ind.label}
            </div>
            <div
              className={`mt-0.5 text-[15px] font-bold tabular-nums ${ind.bad ? "text-error" : "text-foreground"}`}
            >
              {ind.value}
            </div>
            {ind.note && <div className="text-[10px] text-muted">{ind.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
