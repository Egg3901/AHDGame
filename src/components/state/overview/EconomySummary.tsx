"use client";

import Link from "next/link";
import type { OverviewViewModel } from "@/lib/states/overview/types";
import { formatGDP } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";

/**
 * Economy summary for the State Overview tab's side column.
 *
 * GDP comes straight from `State.gdp` (stored in millions of the country's
 * currency; `formatGDP` handles the unit and `getCurrencyPrefix` the
 * symbol). Unemployment comes from
 * `stateMetrics.economic.unemploymentRate.current`. Top sectors are
 * the per-turn live revenue leaders from `State.topSectorsCache`,
 * falling back to `sectorSpecializations.{primary, secondary}` when
 * the cache is empty.
 *
 * Each sector tagged with `specializationBonus` shows "+10pp margin"
 * (primary) or "+5pp margin" (secondary): the regional margin bonus the
 * state grants corps of that type.
 *
 * `gdpDeltaPct` is still a placeholder (Phase 2+).
 */
export function EconomySummary({
  vm,
  economyHref,
}: {
  vm: OverviewViewModel;
  economyHref: string;
}) {
  const { economy } = vm;
  const delta = economy.gdpDeltaPct;
  const showDelta = delta !== 0;

  return (
    <section
      aria-labelledby="overview-economy-title"
      className="rounded-xl border border-card-border bg-card p-5 sm:p-6"
    >
      <h2 id="overview-economy-title" className="text-heading-sm font-semibold text-foreground">
        Economy
      </h2>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="text-body-sm text-muted">Gross state product</dt>
          <dd className="flex items-baseline gap-2">
            <span className="text-heading-lg font-semibold tabular-nums text-foreground">
              {economy.gdp > 0 ? formatGDP(economy.gdp, getCurrencyPrefix(vm.countryId)) : "None"}
            </span>
            {showDelta && (
              <span
                className={`text-body-sm tabular-nums ${delta >= 0 ? "text-success" : "text-error"}`}
              >
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}% recent
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-card-border pt-3">
          <dt className="text-body text-muted">Unemployment</dt>
          <dd className="text-body font-medium tabular-nums text-foreground">
            {economy.unemployment > 0 ? `${economy.unemployment.toFixed(1)}%` : "No data"}
          </dd>
        </div>
        <div className="border-t border-card-border pt-3">
          <dt className="text-body text-muted">Top sectors</dt>
          <dd>
            {economy.topSectors.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {economy.topSectors.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="font-medium text-foreground">
                      {CORPORATION_TYPE_LABELS[s.id as CorporationType] ?? s.id}
                    </span>
                    {s.specializationBonus && (
                      <span
                        className="text-body-sm font-medium text-success"
                        title={
                          s.specializationBonus === "primary"
                            ? "State primary specialization: +10pp regional margin bonus"
                            : "State secondary specialization: +5pp regional margin bonus"
                        }
                      >
                        {s.specializationBonus === "primary" ? "+10pp margin" : "+5pp margin"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-body text-muted">No sector data yet.</span>
            )}
          </dd>
        </div>
      </dl>
      <Link
        href={economyHref}
        className="mt-4 inline-block text-body font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
      >
        Sectors, budget and resources
      </Link>
    </section>
  );
}
