"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { SectionLabel } from "@/components/ui";
import type { MetricCategoryId } from "@/lib/db/types";
import { ApprovalChart } from "@/components/charts/ApprovalChart";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import {
  regionUrl,
  metricsApiUrl,
  approvalApiUrl,
  approvalUrl,
  centralBankApiUrl,
  centralBankUrl,
  economyUrl,
  politicalMetricsUrl,
} from "@/lib/urls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRuntimeCountryConfig } from "@/hooks/useRuntimeCountryConfig";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { getStatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import { StatMasthead, type MastheadTile } from "@/components/metrics/StatMasthead";
import { CategoryHealthOverview } from "@/components/metrics/CategoryHealthOverview";
import { NationalMetricCard } from "@/components/metrics/NationalMetricCard";
import { categoryRollup } from "@/components/metrics/categoryRollup";
import { formatCompactMoney } from "@/components/metrics/formatCompactMoney";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";

/**
 * Internal simulation values (e.g. population.realizedMigrationRate) have no
 * metric definition — they are not published statistics, so keep them off
 * the boards instead of rendering a raw camelCase id.
 */
function definedMetricEntries<T>(
  category: MetricCategoryId,
  summaries: { [metricId: string]: T } | undefined
): [string, T][] {
  return Object.entries(summaries ?? {}).filter(
    ([metricId]) => getMetricDefinition(category, metricId) != null
  );
}

interface ApprovalHistoryPoint {
  turn: number;
  approval: number;
  net: number;
}

interface MetricSummary {
  average: number;
  populationWeightedAverage: number;
  trend?: number;
  min: { value: number; stateId: string; stateName: string };
  max: { value: number; stateId: string; stateName: string };
}

interface CategorySummary {
  [metricId: string]: MetricSummary;
}

interface StateRanking {
  stateId: string;
  stateName: string;
  value: number;
  rank: number;
}

interface NationalMetricsData {
  categories: { [categoryId: string]: CategorySummary };
  stateRankings: { [categoryId: string]: { [metricId: string]: StateRanking[] } };
  totalPopulation: number;
  gdpMillions?: number;
  gdpPerCapita?: number;
  currencyCode?: string;
  tickRates?: { [categoryId: string]: { [metricId: string]: number } };
  calculatedAt: string;
  governmentApproval?: number;
  governmentApprovalBase?: number;
  governmentApprovalModifiers?: ActiveModifier[];
}

/**
 * SP4: playable-pipeline countries (US/UK/RU/DD) carry only the survivor
 * stateMetrics categories — their political board lives on the SP1
 * political-metrics dashboard. Hide the demolished category tabs for them.
 */
const SURVIVOR_CATEGORY_IDS: ReadonlySet<MetricCategoryId> = new Set([
  "economic",
  "population",
] as MetricCategoryId[]);

const CATEGORY_TABS: { id: MetricCategoryId; name: string }[] = [
  { id: "economic", name: "Economic" },
  { id: "education", name: "Education" },
  { id: "healthcare", name: "Healthcare" },
  { id: "infrastructure", name: "Infrastructure" },
  { id: "publicSafety", name: "Public Safety" },
  { id: "environment", name: "Environment" },
  { id: "social", name: "Social" },
  { id: "governance", name: "Governance" },
  { id: "population", name: "Population" },
  { id: "mediaInformation", name: "Media & Info" },
];

function ratingFromGovernance(score: number): string {
  if (score >= 80) return "AAA";
  if (score >= 68) return "AA";
  if (score >= 55) return "A";
  if (score >= 42) return "BBB";
  return "BB";
}

function InterestRateMiniChart({ history }: { history: { turn: number; rate: number }[] }) {
  if (history.length < 2) return null;
  const W = 280;
  const H = 48;
  const minRate = Math.min(...history.map((h) => h.rate));
  const maxRate = Math.max(...history.map((h) => h.rate));
  const range = maxRate - minRate || 1;
  const points = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = H - ((h.rate - minRate) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-8 flex-1" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-primary"
        />
      </svg>
      <div className="shrink-0 text-[10px] tabular-nums text-muted">{history.length} turns</div>
    </div>
  );
}

export default function MetricsPage() {
  const { code } = useParams<{ code: string }>();
  const rawCode = code?.toUpperCase() ?? "US";
  const config =
    rawCode in COUNTRY_CONFIGS ? COUNTRY_CONFIGS[rawCode as CountryId] : COUNTRY_CONFIGS.US;
  const country = config.id;
  const { config: runtime } = useRuntimeCountryConfig(country);
  const runtimeGovType = runtime?.governmentType ?? config.governmentType;
  const { preset, eraSystemEnabled, currentYear } = useWorldFlags();
  // Live year for era-aware score bands; null while the flag is off (legacy path).
  const eraYear = eraSystemEnabled ? currentYear : null;

  const identity = getStatsIdentity(country);
  const currencySymbol = getCurrencyPrefix(country);

  // SP6: playables have ONE metrics product — the political registry. This
  // legacy page redirects there; non-playables keep it until their conversion.
  const router = useRouter();
  const isPoliticalPipelineCountry = (POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(
    country
  );
  useEffect(() => {
    if (isPoliticalPipelineCountry) router.replace(politicalMetricsUrl(country));
  }, [isPoliticalPipelineCountry, router, country]);
  const visibleTabs = isPoliticalPipelineCountry
    ? CATEGORY_TABS.filter((t) => SURVIVOR_CATEGORY_IDS.has(t.id))
    : CATEGORY_TABS;

  const [activeCategory, setActiveCategory] = useState<MetricCategoryId>("economic");
  const [data, setData] = useState<NationalMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryPoint[]>([]);
  // Canonical national approval (calculateNationalApproval) from the approval API —
  // the same value the over-time chart, the Executive page, and the stored
  // governmentApprovals doc use. The metrics route's own governmentApproval is a
  // different "vs global averages" calc, so we don't use it for the headline.
  const [nationalApproval, setNationalApproval] = useState<number | null>(null);
  const [centralBankData, setCentralBankData] = useState<{
    primeRate: number;
    currentInflation: number;
    bankName: string;
    abbreviation: string;
    rateHistory: { turn: number; rate: number }[];
    inflationHistory: { turn: number; rate: number }[];
  } | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApprovalHistory([]);
    setNationalApproval(null);
    setCentralBankData(null);
    try {
      const secondaryFetchOpts = () => ({
        signal: AbortSignal.timeout(15_000),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const approvalPromise = fetchJson<any>(approvalApiUrl(country), {
        ...secondaryFetchOpts(),
        feature: "country-metrics-approval",
      }).catch(() => null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const centralBankPromise = fetchJson<any>(centralBankApiUrl(country), {
        ...secondaryFetchOpts(),
        feature: "country-metrics-central-bank",
      }).catch(() => null);

      const metricsRes = await fetch(metricsApiUrl(country), {
        signal: AbortSignal.timeout(15_000),
      });
      if (!metricsRes.ok) throw new Error("Failed to fetch national metrics");
      const metricsData = await metricsRes.json();
      setData(metricsData);
      setLoading(false);

      const [approvalData, cbData] = await Promise.all([approvalPromise, centralBankPromise]);
      if (approvalData) {
        setApprovalHistory(approvalData.history ?? []);
        setNationalApproval(
          typeof approvalData.governmentApproval === "number"
            ? approvalData.governmentApproval
            : null
        );
      }
      if (cbData) {
        setCentralBankData({
          primeRate: cbData.primeRate,
          currentInflation: cbData.currentInflation ?? 2.5,
          bankName: cbData.bankName,
          abbreviation: cbData.abbreviation,
          rateHistory: cbData.interestRateHistory ?? [],
          inflationHistory: cbData.inflationHistory ?? [],
        });
      }
    } catch (err) {
      console.error("Error fetching national metrics:", err);
      setError("Failed to load national metrics");
      setLoading(false);
    }
  }, [country]);

  useEffect(() => {
    // SP6: playables never fetch — the redirect effect above replaces the route.
    if (isPoliticalPipelineCountry) return;
    fetchMetrics();
  }, [fetchMetrics, isPoliticalPipelineCountry]);

  const categoryData = data?.categories[activeCategory];
  const categoryRankings = data?.stateRankings[activeCategory];
  const categoryTickRates = data?.tickRates?.[activeCategory];
  const nationalDocId = getNationalDocId(country) ?? "federal";

  const subtitle =
    identity.office && identity.officeEn && identity.office !== identity.officeEn
      ? `${identity.office} (${identity.officeEn})`
      : identity.office;

  // Masthead stat tiles (assembled once data is loaded).
  const tiles: MastheadTile[] = [];
  if (data) {
    const approval = nationalApproval;
    if (approval != null) {
      tiles.push({
        label: "Government approval",
        tone: approval >= 50 ? "up" : approval >= 40 ? "warning" : "down",
        sub: "pop-weighted",
        value: (
          <Link href={approvalUrl(country)} className="hover:underline">
            {approval.toFixed(1)}%
          </Link>
        ),
      });
    }
    if (data.gdpMillions != null) {
      tiles.push({
        label: "GDP",
        tone: "accent",
        sub: "nominal",
        value: formatCompactMoney(currencySymbol, data.gdpMillions * 1_000_000),
      });
    }
    if (data.gdpPerCapita != null) {
      tiles.push({
        label: "GDP per capita",
        sub: "national",
        value: formatCompactMoney(currencySymbol, data.gdpPerCapita),
      });
    }
    tiles.push({
      label: "Population",
      sub: config.regionLabelPlural.toLowerCase(),
      value: (data.totalPopulation / 1e6).toFixed(1) + "M",
    });
    if (centralBankData) {
      tiles.push({
        label: `${centralBankData.abbreviation} prime rate`,
        sub: centralBankData.bankName,
        value: centralBankData.primeRate.toFixed(2) + "%",
      });
      tiles.push({
        label: "Inflation",
        tone:
          centralBankData.currentInflation > 4
            ? "down"
            : centralBankData.currentInflation > 3
              ? "warning"
              : undefined,
        sub: "annual",
        value: centralBankData.currentInflation.toFixed(2) + "%",
      });
    }
    // SP4: the governance composite is a legacy political read — demolished
    // for playable countries (their rating lives on the SP1 dashboard).
    if (!isPoliticalPipelineCountry) {
      const govRollup = categoryRollup(data.categories.governance ?? {}, country, preset, eraYear);
      tiles.push({
        label: "Statistics rating",
        tone: "accent",
        sub: "governance composite",
        value: ratingFromGovernance(govRollup.avgScore),
      });
    }
  }

  // SP6: nothing to render for playables — the redirect effect replaces the
  // route with the registry. (After all hooks, so hook order is stable.)
  if (isPoliticalPipelineCountry) return null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-8 sm:px-6">
        {/* Breadcrumb */}
        {runtimeGovType !== "presidential" && (
          <nav className="mb-3 flex items-center gap-2 text-xs text-muted">
            <Link
              href={`/country/${config.code.toLowerCase()}`}
              className="transition-colors hover:text-foreground"
            >
              {config.name}
            </Link>
            <span aria-hidden>/</span>
            <span className="text-foreground">{config.regionLabel} Metrics</span>
          </nav>
        )}

        {loading && (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-4 text-muted">Loading national metrics...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-12 text-center">
            <p className="text-red-400">{error}</p>
            <button
              onClick={fetchMetrics}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            {/* Statistics-office masthead */}
            <StatMasthead
              identity={identity}
              scopeLabel="National rollup"
              title={identity.title}
              subtitle={subtitle}
              tiles={tiles}
            />

            {/* Approval over time */}
            <div className="rounded-xl border border-card-border bg-card p-5 shadow-card">
              <SectionLabel>Government Approval Over Time</SectionLabel>
              <ApprovalChart history={approvalHistory} />
            </div>

            {/* Category health overview */}
            <CategoryHealthOverview
              categories={visibleTabs}
              data={data.categories}
              countryId={country}
              activeCategory={activeCategory}
              onSelect={(id) => setActiveCategory(id as MetricCategoryId)}
              scopeNote="National roll-up"
            />

            {/* Category tabs */}
            <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
              <div className="flex flex-wrap gap-2">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCategory(tab.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                      activeCategory === tab.id
                        ? "bg-primary text-white shadow-glow-sm"
                        : "bg-card-muted text-muted hover:bg-card-elevated hover:text-foreground"
                    }`}
                  >
                    {tab.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Economic tab → national Economic Outlook handoff */}
            {activeCategory === "economic" && (
              <div className="flex justify-end">
                <Link
                  href={economyUrl(country)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Full economic outlook &rarr;
                </Link>
              </div>
            )}

            {/* Interest Rate + Inflation cards — Economic tab */}
            {activeCategory === "economic" && centralBankData && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Link
                  href={centralBankUrl(country)}
                  className="block rounded-xl border border-card-border bg-card p-5 shadow-card transition-all hover:border-primary/40 hover:shadow-panel"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Interest Rate ({centralBankData.abbreviation})
                      </h3>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                        {(centralBankData.primeRate ?? 0).toFixed(2)}%
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {centralBankData.bankName} prime rate
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                      View {centralBankData.abbreviation}
                    </span>
                  </div>
                  {centralBankData.rateHistory.length >= 2 && (
                    <div className="mt-3 border-t border-card-border/60 pt-2.5">
                      <InterestRateMiniChart history={centralBankData.rateHistory} />
                    </div>
                  )}
                </Link>

                <Link
                  href={centralBankUrl(country)}
                  className="block rounded-xl border border-card-border bg-card p-5 shadow-card transition-all hover:border-primary/40 hover:shadow-panel"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Inflation Rate
                      </h3>
                      <div
                        className={`mt-1 text-2xl font-bold tabular-nums ${
                          (centralBankData.currentInflation ?? 0) > 4
                            ? "text-error"
                            : (centralBankData.currentInflation ?? 0) > 3
                              ? "text-warning"
                              : "text-foreground"
                        }`}
                      >
                        {(centralBankData.currentInflation ?? 0).toFixed(2)}%
                      </div>
                      <p className="mt-1 text-xs text-muted">Annual — updated each fiscal year</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                      Trends
                    </span>
                  </div>
                  {centralBankData.inflationHistory.length >= 2 && (
                    <div className="mt-3 border-t border-card-border/60 pt-2.5">
                      <InterestRateMiniChart history={centralBankData.inflationHistory} />
                    </div>
                  )}
                </Link>
              </div>
            )}

            {/* Metric cards (rankings folded into each card's drill-down) */}
            {categoryData && (
              <div className="grid gap-3 lg:grid-cols-2">
                {definedMetricEntries(activeCategory, categoryData).map(([metricId, summary]) => (
                  <NationalMetricCard
                    key={metricId}
                    category={activeCategory}
                    metricId={metricId}
                    summary={summary}
                    rankings={categoryRankings?.[metricId] ?? []}
                    tickRate={categoryTickRates?.[metricId]}
                    countryId={country}
                    regionLabel={config.regionLabel}
                    detailHref={`${regionUrl(country, nationalDocId)}/metrics/${activeCategory}/${metricId}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {config.governmentType !== "presidential" && (
          <div className="mt-8 flex items-center gap-3 border-t border-card-border/40 pt-4">
            <Link
              href={`/country/${config.code.toLowerCase()}`}
              className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              ← {config.name} Overview
            </Link>
            <Link
              href={config.mapPath}
              className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              {config.regionLabel} Map
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
