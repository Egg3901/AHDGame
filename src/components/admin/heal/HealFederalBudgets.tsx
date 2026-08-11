"use client";

import { useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

interface NationalDiagnostic {
  budgetId: string;
  countryId: string;
  scope: "national";
  gdp: number;
  population: number;
  currentRevenue: number;
  recalcRevenue: number;
  currentSpending: number;
  recalcSpending: number;
  currentSurplus: number;
  recalcSurplus: number;
  revenueNeedsFix: boolean;
  spendingNeedsFix: boolean;
  needsFix: boolean;
  enactedLawCount: number;
}

interface RegionalSummary {
  total: number;
  needsFix: number;
  totalRevenueDrift: number;
  totalSpendingDrift: number;
}

interface DiagnosticResult {
  national: {
    total: number;
    needsFix: number;
    budgets: NationalDiagnostic[];
  };
  regional: {
    total: number;
    needsFix: number;
    byCountry: Record<string, RegionalSummary>;
  };
}

interface HealResult {
  ok: boolean;
  message: string;
  nationalHealed?: number;
  regionalHealed?: number;
  lawsUpdated?: number;
}

function currSym(countryId: string): string {
  return CURRENCY_SYMBOLS[COUNTRY_CURRENCY_MAP[countryId as CountryId]] ?? "$";
}

const fmt = (n: number, sym = "$") => {
  if (Math.abs(n) >= 1e12) return `${sym}${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${sym}${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${sym}${(n / 1e6).toFixed(1)}M`;
  return `${sym}${Math.round(n).toLocaleString("en-US")}`;
};

export function HealBudgets() {
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<HealResult | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/federal-budgets");
      const data = await res.json();
      if (res.ok) {
        setDiagnostics(data);
      } else {
        setResult({ ok: false, message: data.error ?? "Diagnostic failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const runHeal = async () => {
    if (
      !confirm(
        "This will recalculate revenue and spending for ALL national and regional budgets based on current enacted laws and tax rates.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostics(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/federal-budgets", { method: "POST" });
      const data = await res.json();
      setResult({
        ok: res.ok,
        message: data.message ?? data.error ?? "Unknown response",
        nationalHealed: data.nationalHealed,
        regionalHealed: data.regionalHealed,
        lawsUpdated: data.lawsUpdated,
      });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const totalNeedsFix =
    (diagnostics?.national.needsFix ?? 0) + (diagnostics?.regional.needsFix ?? 0);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Budgets</h3>
        <p className="mt-1 text-xs text-muted">
          Recalculates national and regional budget revenue from tax bases and rates, then
          recalculates spending from currently enacted laws. Fixes drift from stale values without
          resetting to seed defaults.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Running…" : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Healing…" : "Heal All Budgets"}
        </button>
      </div>

      {diagnostics && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-4 text-xs">
          <p className={totalNeedsFix > 0 ? "text-error" : "text-success"}>
            {totalNeedsFix > 0
              ? `${totalNeedsFix} budget(s) need fixing`
              : "All budgets are in sync"}
          </p>

          {/* National budgets */}
          <div className="space-y-2">
            <p className="font-semibold text-muted uppercase tracking-wider text-[10px]">
              National Budgets ({diagnostics.national.total})
            </p>
            {diagnostics.national.budgets.map((d) => (
              <div key={d.budgetId} className="space-y-1">
                <p className="font-medium">
                  {d.budgetId} ({d.countryId})
                  {d.needsFix && <span className="text-error ml-2">Needs fix</span>}
                  {!d.needsFix && <span className="text-success ml-2">OK</span>}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-muted">
                  <p>GDP: {fmt(d.gdp, currSym(d.countryId))}</p>
                  <p>Laws: {d.enactedLawCount}</p>
                  <p>
                    Revenue: {fmt(d.currentRevenue, currSym(d.countryId))}
                    {d.revenueNeedsFix && (
                      <span className="text-error">
                        {" "}
                        → {fmt(d.recalcRevenue, currSym(d.countryId))}
                      </span>
                    )}
                  </p>
                  <p>
                    Spending: {fmt(d.currentSpending, currSym(d.countryId))}
                    {d.spendingNeedsFix && (
                      <span className="text-error">
                        {" "}
                        → {fmt(d.recalcSpending, currSym(d.countryId))}
                      </span>
                    )}
                  </p>
                  <p>
                    Surplus: {fmt(d.currentSurplus, currSym(d.countryId))}
                    {d.needsFix && (
                      <span className="text-error">
                        {" "}
                        → {fmt(d.recalcSurplus, currSym(d.countryId))}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Regional budgets summary */}
          <div className="space-y-2">
            <p className="font-semibold text-muted uppercase tracking-wider text-[10px]">
              Regional Budgets ({diagnostics.regional.total})
            </p>
            {Object.entries(diagnostics.regional.byCountry).map(([countryId, summary]) => (
              <div key={countryId} className="flex items-center gap-3 text-muted">
                <span className="font-medium text-foreground">{countryId}</span>
                <span>{summary.total} regions</span>
                {summary.needsFix > 0 ? (
                  <span className="text-error">{summary.needsFix} need fix</span>
                ) : (
                  <span className="text-success">All OK</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <p className={`text-xs font-medium ${result.ok ? "text-success" : "text-error"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
