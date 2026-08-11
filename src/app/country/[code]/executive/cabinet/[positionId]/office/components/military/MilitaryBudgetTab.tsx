"use client";

import type { MilitaryUnitView, ForceSummaryView } from "../../useCabinetOffice";
import { getBranches } from "@/lib/constants/military";
import { SectionCard, Meter } from "../dossier";
import { fmtMoneyAbs } from "./militaryUi";

export function MilitaryBudgetTab({
  countryId,
  units,
  forceSummary,
  currencySymbol,
  liveYear = null,
}: {
  countryId: string;
  units: MilitaryUnitView[];
  forceSummary: ForceSummaryView;
  currencySymbol: string;
  /** Live in-game year for era-gated branches (null = modern catalog). */
  liveYear?: number | null;
}) {
  // Real money on both sides: what the line brings in each turn against what the standing
  // force costs to sustain. This card used to compare the abstract upkeep aggregate to a
  // synthetic envelope floored at a country-independent constant, so it showed the same
  // allowance to every nation and told a minister nothing about their own budget.
  const income = forceSummary.appropriationAccrual;
  const upkeep = forceSummary.appropriationUpkeep;
  const use = income > 0 ? upkeep / income : upkeep > 0 ? 1 : 0;
  const over = income > 0 && upkeep > income;
  const remaining = income - upkeep;

  // `effectiveUpkeep` and the category split are shares of the abstract upkeep aggregate;
  // this converts a share of it into the real money the appropriation is charged.
  const toMoney = (share: number) =>
    forceSummary.totalUpkeep > 0 ? (share / forceSummary.totalUpkeep) * upkeep : 0;

  const branches = getBranches(countryId, liveYear);
  const branchCosts = branches
    .map((b) => ({
      abbr: b.abbr,
      cost: units.filter((u) => u.branchId === b.id).reduce((s, u) => s + u.effectiveUpkeep, 0),
    }))
    .filter((b) => b.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const maxCost = Math.max(...branchCosts.map((b) => b.cost), 1);

  const total = forceSummary.totalUpkeep;
  const categories: Array<[string, number, string]> = [
    ["Personnel & pay", total * 0.42, "#3b82f6"],
    ["Operations & maintenance", total * 0.3, "#eab308"],
    ["Procurement", total * 0.18, "#22c55e"],
    ["R&D / modernization", total * 0.1, "#a855f7"],
  ];

  return (
    <div className="space-y-4">
      <SectionCard
        title="Defence account"
        sub="What the enacted line accrues each turn against what the force costs to sustain"
      >
        <div className="flex items-end justify-between">
          <div>
            <div className="dossier-label text-muted">Force upkeep / turn</div>
            <div
              className={`tabular mt-1 text-2xl font-bold ${over ? "text-error" : "text-foreground"}`}
            >
              {fmtMoneyAbs(currencySymbol, upkeep)}
            </div>
          </div>
          <div className="text-right">
            <div className="dossier-label text-muted">
              {over ? "Drawn from reserve" : "Left to spend"}
            </div>
            <div
              className={`tabular mt-1 text-2xl font-bold ${over ? "text-error" : "text-success"}`}
            >
              {fmtMoneyAbs(currencySymbol, Math.abs(remaining))}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Meter
            value={Math.min(100, use * 100)}
            color={over ? "linear-gradient(90deg,#b91c1c,#ef4444)" : "var(--gov)"}
            height={10}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{Math.round(use * 100)}% of each turn&apos;s accrual</span>
          {over ? (
            <span className="font-semibold text-error">Overspend → budget-balance penalty</span>
          ) : (
            <span>Accrues {fmtMoneyAbs(currencySymbol, income)}/turn</span>
          )}
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Cost of force · by branch" sub="Share of each turn's accrual">
          <div className="space-y-2.5">
            {branchCosts.length === 0 && (
              <div className="text-[12px] text-muted">No units in service.</div>
            )}
            {branchCosts.map((b) => (
              <div key={b.abbr} className="flex items-center gap-3">
                <span className="w-16 shrink-0 truncate text-[12px] text-foreground">{b.abbr}</span>
                <div className="flex-1">
                  <Meter value={(b.cost / maxCost) * 100} height={6} />
                </div>
                <span className="mono w-16 shrink-0 text-right text-[12px] font-semibold tabular text-foreground">
                  {fmtMoneyAbs(currencySymbol, toMoney(b.cost))}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Spending by category" sub="Illustrative split of the per-turn charge">
          {categories.map(([label, val, col]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-card-border py-2 last:border-0"
            >
              <span className="flex items-center gap-2 text-[12px] text-muted">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: col }} />
                {label}
              </span>
              <span className="tabular text-[13px] font-semibold text-foreground">
                {fmtMoneyAbs(currencySymbol, toMoney(val))}
              </span>
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}
