"use client";

import { MetricCard } from "./MetricCard";
import { RegionalMetricCard } from "@/components/metrics/RegionalMetricCard";
import type { MetricCategoryId, StateMetricValue } from "@/lib/db/types";
import { regionMetricUrl } from "@/lib/urls";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  METRIC_DEFS_BY_CATEGORY,
  getMetricDisplayName,
  type MetricDefinition,
} from "@/lib/constants/metricDefinitions";

interface StateRanking {
  stateId: string;
  stateName: string;
  value: number;
  rank: number;
}

interface MetricsCategoryDisplayProps {
  categoryId: MetricCategoryId;
  categoryName: string;
  metrics: Record<string, StateMetricValue>;
  nationalAverages?: Record<string, number | null>;
  /** Per-turn tick rates keyed by metricId, from active policy effects */
  tickRates?: Record<string, number>;
  /** National per-region rankings keyed by metricId (powers the drill-down). */
  nationalRankings?: Record<string, StateRanking[]>;
  /** If provided, metric cards link to /state/[stateId]/metrics/[categoryId]/[metricId] */
  stateId?: string;
  /** Country context for links and currency formatting */
  countryId?: string;
}

export function MetricsCategoryDisplay({
  categoryId,
  categoryName,
  metrics,
  nationalAverages,
  tickRates,
  nationalRankings,
  stateId,
  countryId,
}: MetricsCategoryDisplayProps) {
  const allDefinitions = METRIC_DEFS_BY_CATEGORY[categoryId];

  if (!allDefinitions) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="text-muted">No metrics available for this category.</p>
      </div>
    );
  }

  const renderList = (Object.entries(allDefinitions) as Array<[string, MetricDefinition]>)
    .filter(([key]) => Boolean(metrics[key]))
    .map(([key, def]) => ({ key, def, value: metrics[key] }));

  if (renderList.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="text-muted">No metrics available for this category.</p>
      </div>
    );
  }

  const useRedesign = Boolean(stateId && countryId);
  const regionLabelPlural =
    countryId && countryId in COUNTRY_CONFIGS
      ? COUNTRY_CONFIGS[countryId as CountryId].regionLabelPlural.toLowerCase()
      : "regions";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{categoryName}</h3>
        <span className="text-sm text-muted">{renderList.length} metrics</span>
      </div>

      {useRedesign ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {renderList.map(({ key, value: metricValue }) => (
            <RegionalMetricCard
              key={key}
              category={categoryId}
              metricId={key}
              value={metricValue.value}
              trend={metricValue.trend}
              nationalAverage={nationalAverages?.[key] ?? undefined}
              tickRate={tickRates?.[key]}
              countryId={countryId as string}
              regionId={stateId as string}
              regionLabelPlural={regionLabelPlural}
              rankings={nationalRankings?.[key]}
              detailHref={regionMetricUrl(countryId as string, stateId as string, categoryId, key)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {renderList.map(({ key, def, value: metricValue }) => {
            const natAvg = nationalAverages?.[key];
            const prefix =
              def.formatPrefix === "$" && countryId
                ? getCurrencyPrefix(countryId)
                : def.formatPrefix;
            return (
              <MetricCard
                key={key}
                name={getMetricDisplayName(def, stateId)}
                value={metricValue.value}
                nationalAverage={natAvg}
                formatPrefix={prefix}
                formatSuffix={def.formatSuffix}
                decimals={def.decimals}
                isHigherBetter={def.isHigherBetter}
                trend={metricValue.trend}
                description={def.description}
                tickRate={tickRates?.[key]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MetricsCategoryDisplay;
