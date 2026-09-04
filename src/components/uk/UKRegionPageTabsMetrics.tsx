"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { BudgetSummaryPanel } from "@/components/budget/BudgetSummaryPanel";
import { regionApiSubUrl, approvalUrl } from "@/lib/urls";
import type { StateMetrics } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getStatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import { RegionalMetricsHeader } from "@/components/metrics/RegionalMetricsHeader";
import { RegionalStatBoards } from "@/components/metrics/RegionalStatBoards";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { ApprovalChart } from "@/components/charts/ApprovalChart";
import { SectionLabel } from "@/components/ui";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

interface ApprovalHistoryPoint {
  turn: number;
  approval: number;
  net: number;
}

interface RegionalBudgetSummary {
  councilTaxRevenue: number;
  businessRatesRevenue: number;
  westminsterGrant: number;
  totalBudget: number;
  enactedBillCosts: number;
  surplus: number;
  isOverBudget: boolean;
  turnsOverBudget: number;
}

function UKBudgetPanel({ budget }: { budget: RegionalBudgetSummary }) {
  const { surplus, isOverBudget } = budget;
  const balanceColor = isOverBudget ? "text-error" : surplus >= 0 ? "text-success" : "text-warning";

  return (
    <BudgetSummaryPanel
      title="Regional Budget"
      currencySymbol="£"
      balance={surplus}
      warningBadge={
        isOverBudget
          ? `Over Budget (${budget.turnsOverBudget} turn${budget.turnsOverBudget !== 1 ? "s" : ""})`
          : undefined
      }
      stats={[
        { label: "Council Tax", value: budget.councilTaxRevenue },
        { label: "Business Rates", value: budget.businessRatesRevenue },
        { label: "Westminster Grant", value: budget.westminsterGrant },
        { label: "Total Budget", value: budget.totalBudget },
        { label: "Enacted Spending", value: budget.enactedBillCosts },
        { label: surplus >= 0 ? "Surplus" : "Deficit", value: surplus, colorClass: balanceColor },
      ]}
    />
  );
}

export function UKRegionPageTabsMetrics({ regionId }: { regionId: string }) {
  const [metrics, setMetrics] = useState<StateMetrics | null>(null);
  const [nationalAverages, setNationalAverages] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const [budget, setBudget] = useState<RegionalBudgetSummary | null>(null);
  const [stateName, setStateName] = useState<string>(regionId);
  const [approval, setApproval] = useState<{
    value: number;
    base: number;
    modifiers: ActiveModifier[];
  } | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => {
      setLoading(true);
      setError(null);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchJson<any>(regionApiSubUrl("UK", regionId, "metrics"), {
      feature: "uk-region-metrics",
    })
      .then((data) => {
        setMetrics(data.metrics);
        setNationalAverages(data.nationalAverages ?? {});
        setBudget(data.budget ?? null);
        if (data.stateName) setStateName(data.stateName);
        if (Array.isArray(data.approvalHistory)) setApprovalHistory(data.approvalHistory);
        if (typeof data.governmentApproval === "number") {
          setApproval({
            value: data.governmentApproval,
            base: data.governmentApprovalBase ?? data.governmentApproval,
            modifiers: data.governmentApprovalModifiers ?? [],
          });
        }
      })
      .catch(() => {
        setError("No metrics data");
        setMetrics(null);
      })
      .finally(() => setLoading(false));
  }, [regionId]);

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
        <div className="py-12 text-center text-muted">
          <svg
            className="mx-auto h-12 w-12 mb-4 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <p className="font-medium">Regional metrics coming soon</p>
          <p className="text-sm mt-1">
            Economic, education, healthcare, and other metrics for UK regions will be available when
            the UK metrics dataset is seeded.
          </p>
        </div>
      </div>
    );
  }

  const identity = getStatsIdentity("UK");
  const dossier = `${COUNTRY_CONFIGS.UK.name} · ${COUNTRY_CONFIGS.UK.regionLabel}`;

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
              href={approvalUrl("UK")}
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

      {/* UK Regional Budget Summary */}
      {budget && <UKBudgetPanel budget={budget} />}

      {/* SP6: registry-grammar statistics boards (property/commercial value
          indices are shared metricDefinitions now, so the boards cover the
          former "UK Regional" extras). */}
      <RegionalStatBoards
        countryId="UK"
        stateId={regionId}
        economic={metrics.economic as Record<string, { value: number; trend?: number }>}
        population={metrics.population as Record<string, { value: number; trend?: number }>}
        nationalAverages={nationalAverages}
      />
    </div>
  );
}
