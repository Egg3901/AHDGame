"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricsCategoryDisplay } from "./MetricsCategoryDisplay";
import { BudgetSummaryPanel } from "@/components/budget/BudgetSummaryPanel";
import { regionApiSubUrl, metricsApiUrl, approvalUrl } from "@/lib/urls";
import type { MetricCategoryId, StateMetrics } from "@/lib/db/types";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getStatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import { RegionalMetricsHeader } from "@/components/metrics/RegionalMetricsHeader";
import { GdpDecompositionCard } from "@/components/metrics/GdpDecompositionCard";
import { CategoryHealthOverview } from "@/components/metrics/CategoryHealthOverview";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { ApprovalChart } from "@/components/charts/ApprovalChart";
import { SectionLabel } from "@/components/ui";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { toRollupShape } from "@/components/metrics/toRollupShape";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import { RegionalStatBoards } from "@/components/metrics/RegionalStatBoards";
import { RegionalRegistryBoard } from "@/app/country/[code]/political-metrics/components/RegionalRegistryBoard";

interface ApprovalHistoryPoint {
  turn: number;
  approval: number;
  net: number;
}

interface StateRanking {
  stateId: string;
  stateName: string;
  value: number;
  rank: number;
}

interface CategoryTab {
  id: MetricCategoryId;
  name: string;
  icon: React.ReactNode;
}

const CATEGORY_TABS: CategoryTab[] = [
  {
    id: "economic",
    name: "Economic",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    id: "education",
    name: "Education",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path d="M12 14l9-5-9-5-9 5 9 5z" />
        <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"
        />
      </svg>
    ),
  },
  {
    id: "healthcare",
    name: "Healthcare",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    ),
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    ),
  },
  {
    id: "publicSafety",
    name: "Public Safety",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    ),
  },
  {
    id: "environment",
    name: "Environment",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    id: "social",
    name: "Social",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
  {
    id: "governance",
    name: "Governance",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"
        />
      </svg>
    ),
  },
  {
    id: "population",
    name: "Population",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    ),
  },
  {
    id: "mediaInformation",
    name: "Media & Info",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
        />
      </svg>
    ),
  },
];

interface StateBudgetSummary {
  revenue: {
    total: number;
    incomeTax?: number;
    salesTax?: number;
    domesticCorporateTax?: number;
    foreignCorporateTax?: number;
    propertyTax?: number;
    federalGrants?: number;
    other?: number;
  };
  spending: { total: number; byCategory: Record<string, number> };
  balance: number;
  surplus: number;
  taxRates?: Record<string, number>;
}

function USBudgetPanel({ budget, countryId }: { budget: StateBudgetSummary; countryId: string }) {
  const netBalance = budget.surplus !== 0 ? budget.surplus : budget.balance;
  const balanceColor = netBalance < 0 ? "text-error" : "text-success";
  const currencySymbol = getCurrencyPrefix(countryId);

  const taxLabel = (name: string, key: string) =>
    `${name}${budget.taxRates?.[key] != null ? ` (${budget.taxRates[key].toFixed(1)}%)` : ""}`;

  const stats = [
    budget.revenue.incomeTax && budget.revenue.incomeTax > 0
      ? { label: taxLabel("Income Tax", "incomeTax"), value: budget.revenue.incomeTax }
      : null,
    budget.revenue.salesTax && budget.revenue.salesTax > 0
      ? { label: taxLabel("Sales Tax", "salesTax"), value: budget.revenue.salesTax }
      : null,
    budget.revenue.domesticCorporateTax && budget.revenue.domesticCorporateTax > 0
      ? {
          label: taxLabel("Corporate Tax — Domestic", "domesticCorporateTax"),
          value: budget.revenue.domesticCorporateTax,
        }
      : null,
    budget.revenue.foreignCorporateTax && budget.revenue.foreignCorporateTax > 0
      ? {
          label: taxLabel("Corporate Tax — Foreign", "foreignCorporateTax"),
          value: budget.revenue.foreignCorporateTax,
        }
      : null,
    budget.revenue.propertyTax && budget.revenue.propertyTax > 0
      ? { label: taxLabel("Property Tax", "propertyTax"), value: budget.revenue.propertyTax }
      : null,
    budget.revenue.federalGrants && budget.revenue.federalGrants > 0
      ? { label: "Federal Grants", value: budget.revenue.federalGrants }
      : null,
    { label: "Total Revenue", value: budget.revenue.total },
    { label: "Total Spending", value: budget.spending.total },
    { label: netBalance >= 0 ? "Surplus" : "Deficit", value: netBalance, colorClass: balanceColor },
  ].filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <BudgetSummaryPanel
      title="State Budget"
      currencySymbol={currencySymbol}
      balance={netBalance}
      stats={stats}
    />
  );
}

interface StateMetricsTabProps {
  stateId: string;
  countryId: string;
}

export function StateMetricsTab({ stateId, countryId }: StateMetricsTabProps) {
  const [activeCategory, setActiveCategory] = useState<MetricCategoryId>("economic");
  const [metrics, setMetrics] = useState<StateMetrics | null>(null);
  const [nationalAverages, setNationalAverages] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const [tickRates, setTickRates] = useState<Record<string, Record<string, number>>>({});
  const [budgetData, setBudgetData] = useState<StateBudgetSummary | null>(null);
  const [economyStock, setEconomyStock] = useState<{
    gdp: number | null;
    outputGap: number | null;
    capitalStock: number | null;
    population: number | null;
  } | null>(null);
  const [stateName, setStateName] = useState<string>(stateId);
  const [approval, setApproval] = useState<{
    value: number;
    base: number;
    modifiers: ActiveModifier[];
  } | null>(null);
  const [nationalRankings, setNationalRankings] = useState<
    Record<string, Record<string, StateRanking[]>>
  >({});
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(regionApiSubUrl(countryId, stateId, "metrics"));
      if (!res.ok) {
        throw new Error("Failed to fetch metrics");
      }

      const data = await res.json();
      setMetrics(data.metrics);
      if (data.economyStock !== undefined) setEconomyStock(data.economyStock);
      setNationalAverages(data.nationalAverages);
      if (data.tickRates) setTickRates(data.tickRates);
      if (data.stateName) setStateName(data.stateName);
      if (Array.isArray(data.approvalHistory)) setApprovalHistory(data.approvalHistory);
      if (typeof data.governmentApproval === "number") {
        setApproval({
          value: data.governmentApproval,
          base: data.governmentApprovalBase ?? data.governmentApproval,
          modifiers: data.governmentApprovalModifiers ?? [],
        });
      }
      // National per-region rankings power the "vs other regions" drill-down.
      try {
        const natRes = await fetch(metricsApiUrl(countryId));
        if (natRes.ok) {
          const natData = await natRes.json();
          if (natData.stateRankings) setNationalRankings(natData.stateRankings);
        }
      } catch {
        // Rankings are optional — the cards degrade to comparison-only.
      }

      // Budget comes from the dedicated endpoint (the StateBudgetSummary shape the
      // US/general panel expects — the metrics route's `budget` is parliamentary-shaped).
      try {
        const budgetRes = await fetch(regionApiSubUrl(countryId, stateId, "budget"));
        if (budgetRes.ok) {
          const budgetJson = await budgetRes.json();
          if (budgetJson.budget) setBudgetData(budgetJson.budget);
        }
      } catch {
        // Budget is optional — don't block metrics display
      }
    } catch (err) {
      console.error("Error fetching metrics:", err);
      setError("Failed to load metrics data");
    } finally {
      setLoading(false);
    }
  }, [stateId, countryId]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-4 text-muted">Loading metrics...</p>
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="py-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="mt-4 text-red-400">{error || "No metrics available"}</p>
          <button
            onClick={fetchMetrics}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // SP4: playable-pipeline countries carry only the survivor stateMetrics
  // categories (economic/population) — the political board lives on the SP1
  // political-metrics dashboard. SP6: their regional statistics render in the
  // registry grammar (RegionalStatBoards) instead of the legacy card grid.
  const isPlayablePipeline = (POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(
    countryId
  );
  const visibleTabs = isPlayablePipeline
    ? CATEGORY_TABS.filter((t) => t.id === "economic" || t.id === "population")
    : CATEGORY_TABS;
  const activeTab = visibleTabs.find((t) => t.id === activeCategory) ?? visibleTabs[0];
  const categoryMetrics = metrics[activeTab.id] as Record<
    string,
    { value: number; trend?: number }
  >;
  const categoryNationalAverages = nationalAverages?.[activeTab.id];
  const categoryTickRates = tickRates[activeTab.id];
  const identity = getStatsIdentity(countryId);
  const config = countryId in COUNTRY_CONFIGS ? COUNTRY_CONFIGS[countryId as CountryId] : undefined;
  const dossier = config ? `${config.name} · ${config.regionLabel}` : identity.officeEn;
  const rollupData = toRollupShape(metrics, visibleTabs);

  return (
    <div className="space-y-6">
      {/* Regional stats-office header */}
      <RegionalMetricsHeader
        identity={identity}
        regionName={stateName}
        dossier={dossier}
        stat={
          approval ? (
            <ApprovalTooltip
              approval={approval.value}
              baseApproval={approval.base}
              modifiers={approval.modifiers}
              href={approvalUrl(countryId)}
            />
          ) : undefined
        }
        statLabel={approval ? "approval" : undefined}
      />

      {/* Government approval over time (regional) */}
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-card">
        <SectionLabel>{stateName} Approval Over Time</SectionLabel>
        {approvalHistory.length > 0 ? (
          <ApprovalChart history={approvalHistory} />
        ) : (
          <p className="py-6 text-center text-sm text-muted">
            Approval history accumulates each turn — check back after the next turn.
          </p>
        )}
      </div>

      {/* SP6: the region's own political registry — the nine category scores
          from this region's politicalMetrics doc, in the national card grammar. */}
      {isPlayablePipeline && (
        <RegionalRegistryBoard countryId={countryId} regionId={stateId} regionName={stateName} />
      )}

      {/* Budget Summary */}
      {budgetData && <USBudgetPanel budget={budgetData} countryId={countryId} />}

      {isPlayablePipeline ? (
        // SP6: registry-grammar statistics boards; GDP decomposition folds
        // into the Economic board. potentialGrowth/laborForce are surfaced
        // engine intermediates the decomposition card reads explicitly.
        <RegionalStatBoards
          countryId={countryId}
          stateId={stateId}
          economic={metrics.economic as Record<string, { value: number; trend?: number }>}
          population={metrics.population as Record<string, { value: number; trend?: number }>}
          nationalAverages={nationalAverages}
          economicExtras={
            economyStock ? (
              <GdpDecompositionCard
                gdp={economyStock.gdp}
                gdpGrowth={
                  (metrics.economic as Record<string, { value?: number } | undefined>)?.gdpGrowth
                    ?.value ?? 0
                }
                potentialGrowth={
                  (metrics.economic as Record<string, { value?: number } | undefined>)
                    ?.potentialGrowth?.value ?? 0
                }
                outputGap={economyStock.outputGap}
                laborForce={
                  (metrics.economic as Record<string, { value?: number } | undefined>)?.laborForce
                    ?.value ?? null
                }
                countryId={countryId}
              />
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Category health overview (this region's standing) */}
          <CategoryHealthOverview
            categories={visibleTabs}
            data={rollupData}
            countryId={countryId}
            activeCategory={activeTab.id}
            onSelect={(id) => setActiveCategory(id as MetricCategoryId)}
            scopeNote={`${stateName}'s standing`}
          />

          {/* Category Sub-tabs */}
          <div className="rounded-xl border border-card-border bg-card p-4 overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveCategory(tab.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab.id === tab.id
                      ? "bg-primary text-white"
                      : "bg-background text-muted hover:bg-background/80 hover:text-foreground"
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Category Content */}
          <div className="space-y-6 rounded-xl border border-card-border bg-card p-6">
            {/* P1d-3: GDP level + potential-vs-cyclical split. potentialGrowth/laborForce
                are surfaced engine intermediates (not in metricDefinitions), so they
                don't render as metric cards — this card reads them explicitly. */}
            {activeTab.id === "economic" && economyStock && (
              <GdpDecompositionCard
                gdp={economyStock.gdp}
                gdpGrowth={categoryMetrics?.gdpGrowth?.value ?? 0}
                potentialGrowth={
                  (metrics.economic as Record<string, { value?: number } | undefined>)
                    ?.potentialGrowth?.value ?? 0
                }
                outputGap={economyStock.outputGap}
                laborForce={
                  (metrics.economic as Record<string, { value?: number } | undefined>)?.laborForce
                    ?.value ?? null
                }
                countryId={countryId}
              />
            )}
            <MetricsCategoryDisplay
              categoryId={activeTab.id}
              categoryName={activeTab.name}
              metrics={categoryMetrics}
              nationalAverages={categoryNationalAverages}
              tickRates={categoryTickRates}
              nationalRankings={nationalRankings[activeTab.id]}
              stateId={stateId}
              countryId={countryId}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default StateMetricsTab;
