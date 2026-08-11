"use client";

import { useState, useEffect, useCallback } from "react";
import { BudgetDisplay } from "@/components/budget/BudgetDisplay";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import type { CurrencyCode } from "@/lib/constants/currencies";

const COUNTRIES: { id: CountryId; label: string }[] = [
  { id: "US", label: "US" },
  { id: "UK", label: "UK" },
  { id: "JP", label: "JP" },
  { id: "DE", label: "DE" },
];

interface BudgetApiData {
  budget: FederalBudget;
  /** v0.2.6: surfaced by /api/admin/economy/budgets on both live + snapshot responses. */
  currencyCode?: CurrencyCode | null;
  primeRate: number;
  currentTurn: number;
  turnsUntilFY: number;
  isSnapshot?: boolean;
  snapshotFiscalYear?: number;
  availableFiscalYears?: number[];
}

export function BudgetOverviewAdminPanel() {
  const [activeCountry, setActiveCountry] = useState<CountryId>("US");
  const [selectedFY, setSelectedFY] = useState<number | null>(null);
  const [data, setData] = useState<BudgetApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = `countryId=${activeCountry}${selectedFY ? `&fiscalYear=${selectedFY}` : ""}`;
      const res = await fetch(`/api/admin/economy/budgets?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [activeCountry, selectedFY]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableFiscalYears = data?.availableFiscalYears ?? [];

  return (
    <div className="space-y-4">
      {/* Country tab bar + FY dropdown */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 rounded-xl border border-card-border bg-card p-1 w-fit shadow-sm">
          {COUNTRIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveCountry(c.id);
                setSelectedFY(null);
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeCountry === c.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {availableFiscalYears.length > 0 && (
          <select
            value={selectedFY ?? "current"}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedFY(val === "current" ? null : parseInt(val, 10));
            }}
            className="rounded border border-card-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="current">Current (live)</option>
            {availableFiscalYears.map((fy) => (
              <option key={fy} value={fy}>
                FY{fy}
              </option>
            ))}
          </select>
        )}
      </div>

      <BudgetDisplay
        budget={data?.budget ?? null}
        primeRate={data?.primeRate ?? 0}
        turnsUntilFY={data?.turnsUntilFY ?? 0}
        loading={loading}
        error={error}
        scope="national"
        title={`${activeCountry} Federal Budget`}
        isSnapshot={data?.isSnapshot ?? false}
        snapshotFiscalYear={data?.snapshotFiscalYear}
        currencySymbol={getCurrencyPrefix(activeCountry, data?.budget?.currencyCode)}
        // Per-country view — pair the active country's budget with its own code so
        // BudgetDisplay can route through wallet-pref formatting. Falls back to
        // top-level `currencyCode` (Task 56) then to the budget doc's own code.
        currencyCode={
          (data?.currencyCode as CurrencyCode | null | undefined) ??
          (data?.budget?.currencyCode as CurrencyCode | undefined)
        }
      />
    </div>
  );
}
