import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { State, MetricCategoryId, GameState } from "@/lib/db/types";
import type { StateDemographics } from "@/lib/db/types/demographics";
import {
  calculateStateApproval,
  calculateApprovalFromAverages,
  computeNationalAveragesFromMetrics,
  computeStateApprovalBase,
  computeApprovalBaseFromAverages,
  buildFlatMetrics,
  BASE_APPROVAL,
} from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
import { evaluateModifiers, type ActiveModifier } from "@/lib/utils/approvalModifiers";
import { resolveGameYear } from "@/lib/era/era";
import { NATIONAL_SCOPE_IDS, getNationalDocId } from "@/lib/constants/nationalScope";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { aggregateNationalGdp } from "@/lib/utils/nationalGdp";
import { populationWeightedAverage } from "@/lib/metrics/populationWeightedAverage";
import { isMetricActive } from "@/lib/era/metricCatalog";
import { computeAllNationalMetricTickRates } from "@/lib/api/stateTickRates";
import { IS_HIGHER_BETTER } from "@/lib/utils/metricScoring";
import { marginEffectForModifier } from "@/lib/states/conditions/marginEffects";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

interface MetricSummary {
  average: number;
  populationWeightedAverage: number;
  /** Population-weighted national trend (% change), aggregated from state trends. */
  trend: number;
  min: { value: number; stateId: string; stateName: string };
  max: { value: number; stateId: string; stateName: string };
}

interface CategorySummary {
  [metricId: string]: MetricSummary;
}

interface NationalMetricsResponse {
  categories: {
    [categoryId: string]: CategorySummary;
  };
  stateRankings: {
    [categoryId: string]: {
      [metricId: string]: { stateId: string; stateName: string; value: number; rank: number }[];
    };
  };
  totalPopulation: number;
  /** National GDP in local-currency millions (sum of regional GDP). */
  gdpMillions: number;
  /** National GDP per capita in base local-currency units. */
  gdpPerCapita: number;
  /** ISO 4217 currency code for formatting GDP in local currency. */
  currencyCode: string;
  /** National per-metric per-turn policy tick rates, keyed by category → metric. */
  tickRates: Record<string, Record<string, number>>;
  calculatedAt: string;
  governmentApproval: number;
  governmentApprovalBase: number;
  governmentApprovalModifiers: ActiveModifier[];
  stateApprovals: {
    stateId: string;
    stateName: string;
    approval: number;
    baseApproval: number;
    modifiers: ActiveModifier[];
  }[];
}

/**
 * Compute the aggregated national metrics response for a country. Shared by the
 * GET route and server components (the approval page) so a page can load its
 * initial data with a direct DB call instead of a client self-fetch through the
 * CDN. Returns null when the country has no metrics yet (route maps this to 404).
 */
export async function loadNationalMetrics(
  countryId: CountryId,
  categoryFilter: MetricCategoryId | null = null
): Promise<NationalMetricsResponse | null> {
  const db = await getDb();

  // Fetch states filtered by country, then metrics for those state IDs
  const allStates = await db.collection<State>("states").find({ countryId }).toArray();
  const stateIds = allStates.map((s) => s._id);
  // SP5: merged two-store view.
  const allMetrics = await findMergedRegionMetricsMany(db, { _id: { $in: stateIds } });

  if (allMetrics.length === 0) {
    return null;
  }

  // Create state lookup for names and populations
  const stateMap = new Map(allStates.map((s) => [s._id, s]));
  const totalPopulation = allStates.reduce((sum, s) => sum + s.population, 0);

  // P6d: per-state demographic groups so displayed approval matches the
  // electorate-weighted value the snapshot stores.
  const [demographics, gameStateDoc] = await Promise.all([
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: stateIds }, countryId }, { projection: { _id: 1, groups: 1 } })
      .toArray(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;
  // Live year for era-aware scoring; null while the flag is off (legacy path).
  const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
  const groupsByState = new Map(demographics.map((d) => [d._id, Object.values(d.groups ?? {})]));

  const categories = categoryFilter
    ? [categoryFilter]
    : ([
        "economic",
        "education",
        "healthcare",
        "infrastructure",
        "publicSafety",
        "environment",
        "social",
        "governance",
        "population",
        "mediaInformation",
      ] as MetricCategoryId[]);

  const response: NationalMetricsResponse = {
    categories: {},
    stateRankings: {},
    totalPopulation,
    gdpMillions: 0,
    gdpPerCapita: 0,
    currencyCode: COUNTRY_CONFIGS[countryId].currencyCode,
    tickRates: {},
    calculatedAt: new Date().toISOString(),
    governmentApproval: 0,
    governmentApprovalBase: 0,
    governmentApprovalModifiers: [],
    stateApprovals: [],
  };

  for (const category of categories) {
    response.categories[category] = {};
    response.stateRankings[category] = {};

    // Get all metric keys for this category from the first state that has them
    const sampleState = allMetrics.find((m) => m[category] != null);
    if (!sampleState) continue;
    const sampleMetrics = sampleState[category];
    const metricKeys = Object.keys(sampleMetrics);

    for (const metricKey of metricKeys) {
      // Era existence gate (display): inactive metrics vanish from the national
      // page, rankings, and tick rates in one place. This is the PAGE HELPER —
      // the turn-phase writer (computeNationalMetrics) is deliberately ungated.
      if (!isMetricActive(metricKey, countryId, year)) continue;
      // Gather values for this metric
      const values: {
        stateId: string;
        stateName: string;
        value: number;
        trend: number;
        population: number;
      }[] = [];

      for (const metrics of allMetrics) {
        // SP5: categories are sparse post-split (e.g. merged UK docs carry
        // governance only on devolution regions) — guard the category access.
        const metricData = (
          metrics[category] as Record<string, { value: number; trend?: number }> | undefined
        )?.[metricKey];
        const state = stateMap.get(metrics._id);
        if (metricData && state && typeof metricData.value === "number") {
          values.push({
            stateId: metrics._id,
            stateName: state.name,
            value: metricData.value,
            trend: typeof metricData.trend === "number" ? metricData.trend : 0,
            population: state.population,
          });
        }
      }

      if (values.length === 0) continue;

      // Calculate statistics
      const simpleAverage = values.reduce((sum, v) => sum + v.value, 0) / values.length;
      // Denominator is COVERED population, not `totalPopulation`. A region that
      // carries no value for this metric must not dilute the average toward
      // zero. The Economy page has always weighted it this way; both surfaces
      // now share one helper so they cannot drift apart again.
      const weighted = populationWeightedAverage(values);
      const weightedAverage = weighted.value ?? 0;
      const weightedTrend = weighted.trend ?? 0;

      // Single sort by value: ascending for min/max, then reverse for rank if higher-is-better
      const sortedByValue = [...values].sort((a, b) => a.value - b.value);
      const min = sortedByValue[0];
      const max = sortedByValue[sortedByValue.length - 1];
      const isHigherBetter = IS_HIGHER_BETTER[metricKey] ?? true;
      const sorted = isHigherBetter ? sortedByValue.reverse() : sortedByValue;

      response.categories[category][metricKey] = {
        average: Math.round(simpleAverage * 100) / 100,
        populationWeightedAverage: Math.round(weightedAverage * 100) / 100,
        trend: Math.round(weightedTrend * 100) / 100,
        min: { value: min.value, stateId: min.stateId, stateName: min.stateName },
        max: { value: max.value, stateId: max.stateId, stateName: max.stateName },
      };

      // Add rankings (top 10 and bottom 10)
      response.stateRankings[category][metricKey] = sorted.map((v, i) => ({
        stateId: v.stateId,
        stateName: v.stateName,
        value: v.value,
        rank: i + 1,
      }));
    }
  }

  // Build national averages for approval calculation
  const nationalAverages: Record<string, Record<string, number>> = {};
  for (const [catId, catSummary] of Object.entries(response.categories)) {
    nationalAverages[catId] = {};
    for (const [metricId, summary] of Object.entries(catSummary)) {
      nationalAverages[catId][metricId] = summary.populationWeightedAverage;
    }
  }

  // State approvals: each state vs its own national average (relative comparison)
  const stateApprovalsList: {
    stateId: string;
    stateName: string;
    approval: number;
    baseApproval: number;
    modifiers: ActiveModifier[];
    population: number;
  }[] = [];
  // SP4: playable countries score from the hybrid political model — one
  // provider call, threaded as baseOverride so modifiers stay shared. Missing
  // region/unseeded world → BASE_APPROVAL, never the legacy scorer (spec §3).
  const politicalBases = isPoliticalApprovalCountry(countryId)
    ? await loadPoliticalApprovalBases(db, countryId)
    : null;
  for (const metrics of allMetrics) {
    const state = stateMap.get(metrics._id);
    if (!state) continue;
    const flat = buildFlatMetrics(metrics);
    const groups = groupsByState.get(metrics._id);
    const weighting = groups && groups.length > 0 ? { groups } : undefined;
    const baseOverride = isPoliticalApprovalCountry(countryId)
      ? (politicalBases?.byRegion.get(metrics._id) ?? BASE_APPROVAL)
      : undefined;
    stateApprovalsList.push({
      stateId: metrics._id,
      stateName: state.name,
      baseApproval:
        baseOverride ??
        computeStateApprovalBase(metrics, nationalAverages, weighting, preset ?? undefined, year),
      approval: calculateStateApproval(
        metrics,
        nationalAverages,
        [],
        weighting,
        preset,
        year,
        baseOverride
      ),
      modifiers: evaluateModifiers(flat, { preset, countryId, year }),
      population: state.population,
    });
  }

  // National approval: country's averages vs global averages (all countries combined)
  // This avoids the structural ~50% that results from averaging relative state scores.
  // SP5: merged two-store global read (political + macro halves).
  const allGlobalRaw = await findMergedRegionMetricsMany(db, {});
  // Exclude precomputed national-scope docs (e.g. "federal", "uk_national") — they are derived
  // aggregates, not independent data points, and would double-count state data in the global average.
  // SP4: also exclude LAW_COUNTRY_IDS regions — their political stateMetrics are demolished, so
  // leaving their (macro-only) docs in would skew the per-metric reference composition for every
  // non-playable country. One-time intentional shift; playables never take this path post-cutover.
  const allGlobalMetrics = allGlobalRaw.filter(
    (m) => !NATIONAL_SCOPE_IDS.has(String(m._id)) && !isPoliticalApprovalCountry(m.countryId)
  );
  const globalAverages = computeNationalAveragesFromMetrics(allGlobalMetrics);
  const nationalBaseOverride = isPoliticalApprovalCountry(countryId)
    ? (politicalBases?.national ?? BASE_APPROVAL)
    : undefined;
  response.governmentApproval = calculateApprovalFromAverages(
    nationalAverages,
    globalAverages,
    preset,
    countryId,
    year,
    nationalBaseOverride
  );
  response.governmentApprovalBase =
    nationalBaseOverride ??
    computeApprovalBaseFromAverages(nationalAverages, globalAverages, preset, countryId, year);
  // preset was previously omitted here (same gap as nationalApproval) — the
  // national conditions list skipped era-1991 patches under the 1991 preset.
  response.governmentApprovalModifiers = evaluateModifiers(nationalAverages, {
    countryId,
    preset,
    year,
  }).map((m) => ({
    ...m,
    marginEffect:
      m.marginEffect ?? (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id)),
  }));

  response.stateApprovals = stateApprovalsList.map(
    ({ stateId, stateName, approval, baseApproval, modifiers }) => ({
      stateId,
      stateName,
      approval,
      baseApproval,
      modifiers: modifiers.map((m) => ({
        ...m,
        marginEffect:
          m.marginEffect ?? (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id)),
      })),
    })
  );

  // National GDP + per-capita (local currency) for the masthead stat strip.
  const gdp = aggregateNationalGdp(allStates);
  response.gdpMillions = gdp.gdpMillions;
  response.gdpPerCapita = Math.round(gdp.perCapita * 100) / 100;

  // National per-metric policy tick rates (best-effort; empty if not derivable).
  const nationalDocId = getNationalDocId(countryId);
  if (nationalDocId) {
    response.tickRates = await computeAllNationalMetricTickRates(db, nationalDocId);
  }

  return response;
}
