"use client";

import type { OverviewViewModel } from "@/lib/states/overview/types";
import { formatGDP } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";

/**
 * Economy summary card for the State Overview tab.
 *
 * GDP comes straight from `State.gdp` (stored in millions of the country's
 * currency; `formatGDP` handles the unit and `getCurrencyPrefix` the
 * symbol). Unemployment comes from
 * `stateMetrics.economic.unemploymentRate.current`. Top sectors are
 * the per-turn live revenue leaders from `State.topSectorsCache`,
 * falling back to `sectorSpecializations.{primary, secondary}` when
 * the cache is empty.
 *
 * Each sector tagged with `specializationBonus` shows a small "+10pp"
 * (primary) or "+5pp" (secondary) chip — the regional margin bonus the
 * state grants corps of that type.
 *
 * `gdpDeltaPct` is still a placeholder (Phase 2+).
 */
export function EconomySummary({ vm }: { vm: OverviewViewModel }) {
  const { economy } = vm;
  const delta = economy.gdpDeltaPct;
  const showDelta = delta !== 0;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Economy</div>

      <div className="mt-2 text-2xl font-bold tabular-nums">
        {economy.gdp > 0 ? formatGDP(economy.gdp, getCurrencyPrefix(vm.countryId)) : "—"}
      </div>
      {showDelta && (
        <div
          className={
            "mt-1 text-xs tabular-nums " + (delta >= 0 ? "text-emerald-500" : "text-rose-500")
          }
        >
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}% recent
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Unemployment
          </div>
          <div className="font-semibold tabular-nums">
            {economy.unemployment > 0 ? `${economy.unemployment.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Top sectors
          </div>
          {economy.topSectors.length > 0 ? (
            <ul className="mt-0.5 space-y-0.5 font-semibold">
              {economy.topSectors.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span>{CORPORATION_TYPE_LABELS[s.id as CorporationType] ?? s.id}</span>
                  {s.specializationBonus === "primary" && (
                    <span
                      className="rounded-sm bg-emerald-500/15 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-500"
                      title="State primary specialization: +10pp regional margin bonus"
                    >
                      +10pp
                    </span>
                  )}
                  {s.specializationBonus === "secondary" && (
                    <span
                      className="rounded-sm bg-sky-500/15 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-sky-500"
                      title="State secondary specialization: +5pp regional margin bonus"
                    >
                      +5pp
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="font-semibold">—</div>
          )}
        </div>
      </div>
    </div>
  );
}
