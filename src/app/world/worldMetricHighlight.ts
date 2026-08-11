import { COUNTRY_CONFIGS, type CountryId, type CountryStatus } from "@/lib/constants/countries";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import type { MetricCategoryId } from "@/lib/db/types";
import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";
import {
  getMetricCategory,
  getMetricDefinition,
  formatMetricValue,
} from "@/lib/constants/metricDefinitions";
import type { MetricFilter } from "./components/GlobeMetricPanel";
import type { WorldMetricsData } from "./WorldMetricFilterContext";

type CountryAccessMap = Partial<
  Record<
    CountryId,
    {
      enabledForPlayers: boolean;
      status: CountryStatus;
      economyPreview: boolean;
      registered?: boolean;
      econOnly?: boolean;
    }
  >
>;

export const ISO_TO_COUNTRY_ID = WORLD_COUNTRY_ISO_TO_ID;

export type MapTooltipAccessTone = "active" | "beta" | "planned";

function staticMappedStatusTone(status: "active" | "beta" | "planned"): {
  label: string;
  tone: MapTooltipAccessTone;
} {
  if (status === "active") return { label: "Active", tone: "active" };
  if (status === "beta") return { label: "Beta Access", tone: "beta" };
  return { label: "Planned", tone: "planned" };
}

/**
 * Status line for the world map tooltip: DB-driven for configured countries,
 * otherwise static fallback for non-configured roadmap countries.
 */
export function getMapTooltipAccessDisplay(
  isoId: string,
  mappedStatus: "active" | "beta" | "planned" | undefined,
  countryAccess: CountryAccessMap | undefined
): { label: string; tone: MapTooltipAccessTone; econOnly?: boolean } {
  const countryId = ISO_TO_COUNTRY_ID[isoId];
  const resolvedAccess = countryId ? countryAccess?.[countryId] : undefined;
  if (countryId && resolvedAccess) {
    const availability = resolveCountryAvailability(countryId, resolvedAccess);
    return {
      label: availability.label,
      tone: availability.tone,
      econOnly: availability.displayState === "econ-only" ? true : undefined,
    };
  }

  if (mappedStatus) return staticMappedStatusTone(mappedStatus);

  if (countryId) {
    const fallback = resolveCountryAvailability(countryId, {
      enabledForPlayers: COUNTRY_CONFIGS[countryId].status === "active",
      status: COUNTRY_CONFIGS[countryId].status,
      economyPreview: false,
    });
    return { label: fallback.label, tone: fallback.tone };
  }

  return { label: "Planned", tone: "planned" };
}

const METRIC_SHORT: Record<string, string> = {
  unemploymentRate: "Unemployment",
  medianIncome: "Median income",
  gdpGrowth: "GDP growth",
  povertyRate: "Poverty",
  costOfLiving: "Cost of living",
};

/**
 * One-line summary for the active globe metric filter on nation cards / tooltips.
 * Returns null when filter is "none" or data is missing.
 */
export function getMetricFilterHighlight(
  filter: MetricFilter,
  countryId: CountryId,
  isoCode: string | undefined,
  worldMetrics: WorldMetricsData | null,
  partyData: Record<string, { partyName: string; partyColor: string; count: number }>,
  corpsData: { countries: Record<string, { count: number }> } | null
): { label: string; value: string } | null {
  if (filter.type === "none" || !isoCode) return null;

  if (filter.type === "party") {
    const p = partyData[isoCode];
    if (!p?.partyName) return null;
    return { label: "Largest party", value: p.partyName };
  }

  if (filter.type === "corps") {
    const n = corpsData?.countries[isoCode]?.count;
    if (n === undefined || n <= 0) return null;
    return {
      label: "Corporations",
      value: `${n} registered`,
    };
  }

  const country = worldMetrics?.countries[isoCode];
  if (!country?.hasData) return null;

  if (filter.type === "overall") {
    if (country.overallScore === null) return null;
    return { label: "Overall score", value: String(country.overallScore) };
  }

  if (filter.type === "category") {
    const s = country.categoryScores[filter.categoryId];
    if (s === null || s === undefined) return null;
    const name = getMetricCategory(filter.categoryId)?.name ?? filter.categoryId;
    return { label: `${name} score`, value: String(s) };
  }

  if (filter.type === "metric") {
    const entry = country.categories[filter.categoryId]?.[filter.metricId];
    if (!entry) return null;
    const def = getMetricDefinition(filter.categoryId, filter.metricId);
    const valueStr = def
      ? formatMetricValue(entry.value, def)
      : String(
          Math.abs(entry.value) >= 100 ? Math.round(entry.value) : Number(entry.value.toFixed(1))
        );
    const metricLabel =
      def?.name ??
      METRIC_SHORT[filter.metricId] ??
      filter.metricId.replace(/([A-Z])/g, " $1").trim();
    return { label: metricLabel, value: valueStr };
  }

  return null;
}

/** Category average label for map tooltip when a whole category is selected */
export function getCategoryAverageLabel(categoryId: MetricCategoryId): string {
  const cat = getMetricCategory(categoryId);
  return cat ? `${cat.name} (avg.)` : `${categoryId} (avg.)`;
}
