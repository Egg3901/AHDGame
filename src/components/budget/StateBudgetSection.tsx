"use client";

import { useEffect, useState } from "react";
import { BudgetSummaryCard } from "./BudgetSummaryCard";
import type { StateBudget } from "@/lib/db/types/budget";
import { regionApiSubUrl } from "@/lib/urls";

interface BudgetData {
  budget: StateBudget;
  grantBreakdown: { program: string; amount: number }[];
}

interface StateBudgetSectionProps {
  stateId: string;
  countryId: string;
  regionCode: string;
}

import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";

const TAX_BASE_LABELS: Record<string, string> = {
  incomeTax: "Taxable Income",
  salesTax: "Taxable Sales",
  domesticCorporateTax: "Domestic Corporate Profits",
  foreignCorporateTax: "Foreign Corporate Profits",
  propertyTax: "Property Value",
};

// Map revenue keys to tax base field names
const REVENUE_TO_TAX_BASE: Record<string, string> = {
  incomeTax: "taxableIncome",
  salesTax: "taxableSales",
  domesticCorporateTax: "domesticCorporateProfits",
  foreignCorporateTax: "foreignCorporateProfits",
  propertyTax: "propertyValue",
};

function humanizeKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getNumericField(record: unknown, key: string): number | undefined {
  if (!record || typeof record !== "object") return undefined;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

export function StateBudgetSection({ stateId, countryId, regionCode }: StateBudgetSectionProps) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(regionApiSubUrl(countryId, regionCode, "budget"))
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [stateId, countryId, regionCode]);

  const prefix = getCurrencyPrefix(countryId);
  const formatMoney = (n: number) => {
    if (n >= 1e12) return `${prefix}${(n / 1e12).toFixed(1)}T`;
    if (n >= 1e9) return `${prefix}${(n / 1e9).toFixed(1)}B`;
    return `${prefix}${(n / 1e6).toFixed(1)}M`;
  };

  if (loading) {
    return <p className="text-muted">Loading budget...</p>;
  }

  if (!data?.budget) {
    return <p className="text-muted">Budget data not available.</p>;
  }

  const { budget, grantBreakdown } = data;
  const netBalance = budget.surplus !== 0 ? budget.surplus : budget.balance;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">State Budget - FY{budget.fiscalYear}</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BudgetSummaryCard label="Revenue" value={budget.revenue.total} countryId={countryId} />
        <BudgetSummaryCard label="Spending" value={budget.spending.total} countryId={countryId} />
        <BudgetSummaryCard
          label="Balance"
          value={netBalance}
          variant={netBalance >= 0 ? "surplus" : "deficit"}
          countryId={countryId}
        />
      </div>

      {/* Revenue & Spending */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="font-medium mb-3">Revenue Sources</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(budget.revenue)
              .filter(([key]) => key !== "total")
              .map(([key, value]) => {
                const taxRate = getNumericField(budget.taxRates, key);
                // Use stored tax base if available, otherwise derive from revenue/rate
                const taxBaseField = REVENUE_TO_TAX_BASE[key];
                const storedTaxBase =
                  taxBaseField && budget.taxBases
                    ? (budget.taxBases as unknown as Record<string, number | undefined>)[
                        taxBaseField
                      ]
                    : undefined;
                const taxBase =
                  storedTaxBase ?? (taxRate && taxRate > 0 ? value / (taxRate / 100) : 0);
                const baseLabel = TAX_BASE_LABELS[key] || "Tax Base";
                return (
                  <div key={key} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="capitalize">
                        {key === "federalGrants"
                          ? getCountryConfig(countryId as CountryId).centralGovernmentLabel
                          : key.replace(/([A-Z])/g, " $1")}
                      </span>
                      {taxRate !== undefined && (
                        <span
                          className="text-xs text-muted bg-card-muted px-1.5 py-0.5 rounded cursor-help relative group"
                          title={`${baseLabel}: ${formatMoney(taxBase)} × ${taxRate.toFixed(1)}% = ${formatMoney(value)}`}
                        >
                          {taxRate.toFixed(1)}%
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-background border border-card-border rounded-lg shadow-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            <span className="block font-medium text-foreground mb-1">
                              Revenue Calculation
                            </span>
                            <span className="block text-muted">
                              {baseLabel}: {formatMoney(taxBase)}
                            </span>
                            <span className="block text-muted">
                              Tax Rate: {taxRate.toFixed(1)}%
                            </span>
                            <span className="block text-foreground font-medium mt-1">
                              = {formatMoney(value)}
                            </span>
                          </span>
                        </span>
                      )}
                    </div>
                    <span className="font-mono">{formatMoney(value)}</span>
                  </div>
                );
              })}
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="font-medium mb-3">Spending by Category</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(budget.spending.byCategory).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span>{humanizeKey(key)}</span>
                <span className="font-mono">{formatMoney(value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Grants Breakdown */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="font-medium mb-3">
          {getCountryConfig(countryId as CountryId).centralGovernmentLabel} Received
        </h3>
        <div className="space-y-2 text-sm">
          {grantBreakdown.map((grant) => (
            <div key={grant.program} className="flex justify-between">
              <span>{grant.program}</span>
              <span className="font-mono">{formatMoney(grant.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
