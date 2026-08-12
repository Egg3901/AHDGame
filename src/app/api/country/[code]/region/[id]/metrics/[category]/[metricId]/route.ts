import { NextResponse } from "next/server";
import {
  findMergedRegionMetricsForDisplay,
  findMergedRegionMetricsManyForDisplay,
} from "@/lib/macroMetrics/displayMerge";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics, LegislationType } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import type { MetricCategoryId } from "@/lib/db/types/stateMetrics";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { getMetricHistory } from "@/lib/metricHistory";
import { computeNationalMetricTickRate, computeStateTickRates } from "@/lib/api/stateTickRates";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isUKDevolutionRegion } from "@/lib/constants/devolution";
import {
  NATIONAL_SCOPE,
  NATIONAL_SCOPE_IDS,
  getNationalDocId,
} from "@/lib/constants/nationalScope";
import { FEDERAL_MULTIPLIER } from "@shared/constants/formulas";
import { getNeutralFederalSalesTaxRate, getNeutralStateSalesTaxRate } from "@/lib/turn/gdpGrowth";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { pushesValueUp } from "@/lib/utils/policyDirection";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";

type AffectingPolicy = {
  name: string;
  policyOptionName?: string;
  pushesMetricUp: boolean;
  weight: number;
  scope: "state" | "national";
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstNonZeroSign(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (value !== undefined && value !== 0) return Math.sign(value);
  }
  return 0;
}

function getMatchedPolicyOption(legType: LegislationType, policy: StatePolicy) {
  return (
    legType.policyOptions?.find((o) => o.id === policy.policyOptionId) ??
    legType.policyOptions?.find((o) => o.effectDirection === policy.effectDirection)
  );
}

function getFallbackPolicyDirection(
  policy: StatePolicy,
  matchedOption: ReturnType<typeof getMatchedPolicyOption>,
  category: string
): number {
  const economicValues = [finiteNumber(policy.economic), finiteNumber(matchedOption?.economic)];
  const socialValues = [finiteNumber(policy.social), finiteNumber(matchedOption?.social)];
  const categoryValues = category === "social" ? socialValues : economicValues;
  const fallbackValues = category === "social" ? economicValues : socialValues;

  return firstNonZeroSign(
    finiteNumber(policy.effectDirection),
    finiteNumber(matchedOption?.effectDirection),
    ...categoryValues,
    ...fallbackValues
  );
}

function getConsumptionTaxGdpPolicy(args: {
  legType: LegislationType;
  matchedOption: ReturnType<typeof getMatchedPolicyOption>;
  countryId: string;
  category: string;
  metricId: string;
  scope: "state" | "national";
}): AffectingPolicy | null {
  const { legType, matchedOption, countryId, category, metricId, scope } = args;
  if (category !== "economic" || metricId !== "gdpGrowth") return null;
  if (legType.taxRateChange?.taxType !== "salesTax") return null;

  const rate = finiteNumber(matchedOption?.rate);
  if (rate === undefined) return null;

  const neutralRate =
    scope === "national"
      ? getNeutralFederalSalesTaxRate(countryId)
      : getNeutralStateSalesTaxRate(countryId);
  const rateGap = rate - neutralRate;
  if (Math.abs(rateGap) < 0.0001) return null;

  return {
    name: legType.name,
    policyOptionName: matchedOption?.name,
    pushesMetricUp: rateGap < 0,
    weight: Math.abs(rateGap),
    scope,
  };
}

// GET /api/country/[code]/region/[id]/metrics/[category]/[metricId] — Return current value, national average, tick rate, and history for a single metric
// Auth: public
// Errors: 404
/**
 * GET /api/country/[code]/region/[id]/metrics/[category]/[metricId]
 * Returns current value, national average, tick rate, and historical data for a single metric.
 * Also handles national-scope IDs (federal, uk_national, jp_national, …) via the precomputed national docs.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string; id: string; category: string; metricId: string }> }
) {
  try {
    const { code, id, category, metricId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    // National scope IDs (federal, uk_national, jp_national, …) are lowercase by convention
    const idLower = id.toLowerCase();
    const stateId = NATIONAL_SCOPE[idLower] ? idLower : id;
    // Direction of "improvement" depends on the metric: for lower-is-better
    // metrics an improving policy moves the value DOWN. Used to keep the
    // affecting-policy "Pushing up/down" badge consistent with the tick rate.
    const isHigherBetter =
      getMetricDefinition(category as MetricCategoryId, metricId)?.isHigherBetter ?? true;

    const db = await getDb();

    // ── National scope (federal / uk_national / jp_national / …) ──────────────
    const nationalCountryId = NATIONAL_SCOPE[stateId];
    if (nationalCountryId) {
      const [nationalMetrics, allMetrics, nationalPoliciesArr, history, tickRate] =
        await Promise.all([
          findMergedRegionMetricsForDisplay(db, { _id: stateId }),
          findMergedRegionMetricsManyForDisplay(db, {}),
          db.collection<StatePolicy>("statePolicies").find({ stateId }).toArray(),
          getMetricHistory(db, stateId, category as MetricCategoryId, metricId),
          computeNationalMetricTickRate(db, stateId, category as MetricCategoryId, metricId),
        ]);

      if (!nationalMetrics) {
        return NextResponse.json({ error: "No metrics data for country" }, { status: 404 });
      }

      const catData = nationalMetrics[category as MetricCategoryId] as
        Record<string, { value: number }> | undefined;
      const metricVal = catData?.[metricId];
      if (!metricVal || typeof metricVal.value !== "number") {
        return NextResponse.json({ error: "Metric not found" }, { status: 404 });
      }

      // Global average across all states/regions (for cross-country comparison)
      const globalValues = allMetrics
        .filter((m) => !NATIONAL_SCOPE_IDS.has(String(m._id)))
        .map((m) => {
          const c = m[category as MetricCategoryId] as
            Record<string, { value: number }> | undefined;
          return c?.[metricId]?.value;
        })
        .filter((v): v is number => v !== undefined);
      const globalAverage =
        globalValues.length > 0
          ? globalValues.reduce((a, b) => a + b, 0) / globalValues.length
          : undefined;

      // Affecting policies from national scope
      const uniqueLegTypeIds = [...new Set(nationalPoliciesArr.map((p) => p.legislationTypeId))];
      const legTypes = await db
        .collection<LegislationType>("legislationTypes")
        .find({ _id: { $in: uniqueLegTypeIds } })
        .toArray();
      const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

      const affectingPolicies: AffectingPolicy[] = [];

      for (const policy of nationalPoliciesArr) {
        // 📊 budget-sync: computed fiscal metrics are mirror-owned — no law
        // contributes to them, so surface no affecting policies.
        if (MIRROR_CONTROLLED_METRIC_IDS.has(metricId)) break;
        const legType = legTypeMap.get(policy.legislationTypeId);
        if (!legType) continue;

        const matchedOption = getMatchedPolicyOption(legType, policy);
        const matchingTargets = legType.effectTargetsWeighted?.filter(
          (t) => t.metricCategoryId === category && t.metricId === metricId
        );
        if (!matchingTargets || matchingTargets.length === 0) {
          const consumptionTaxPolicy = getConsumptionTaxGdpPolicy({
            legType,
            matchedOption,
            countryId: nationalCountryId,
            category,
            metricId,
            scope: "national",
          });
          if (consumptionTaxPolicy) affectingPolicies.push(consumptionTaxPolicy);
          continue;
        }

        const policyDirection = getFallbackPolicyDirection(policy, matchedOption, category);
        if (policyDirection === 0) continue;
        const totalWeightedDirection = matchingTargets.reduce(
          (sum, t) => sum + t.weight * policyDirection,
          0
        );
        const totalWeight = matchingTargets.reduce((sum, t) => sum + Math.abs(t.weight), 0);
        affectingPolicies.push({
          name: legType.name,
          policyOptionName: matchedOption?.name,
          pushesMetricUp: pushesValueUp(totalWeightedDirection, isHigherBetter),
          weight: totalWeight,
          scope: "national",
        });
      }

      const stateName = COUNTRY_CONFIGS[nationalCountryId]?.name ?? stateId;
      return NextResponse.json(
        {
          stateId,
          stateName,
          category,
          metricId,
          value: metricVal.value,
          nationalAverage: undefined, // National page - value IS the national average
          globalAverage, // Cross-country comparison
          tickRate,
          history,
          affectingPolicies,
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
          },
        }
      );
    }

    // ── Regular state ─────────────────────────────────────────────────────────
    // SP5: merged two-store view (economic/population live on macroMetrics).
    // States first (tiny, projected): the national-average metric fetch below
    // is scoped to this country's state ids instead of loading every region
    // metric doc in the world. countryId on StateMetrics is optional/legacy,
    // so scoping by _id set is the reliable filter.
    const allStates = await db
      .collection<State>("states")
      .find({}, { projection: { countryId: 1 } })
      .toArray();
    const sameCountryIds = allStates
      .filter((state) => state.countryId === countryId)
      .map((state) => state._id);
    const [stateDoc, metrics, allMetrics] = await Promise.all([
      db.collection<State>("states").findOne({ _id: stateId, countryId }),
      findMergedRegionMetricsForDisplay(db, { _id: stateId, countryId }),
      findMergedRegionMetricsManyForDisplay(db, { _id: { $in: sameCountryIds } }),
    ]);

    if (!metrics || !stateDoc) {
      return NextResponse.json({ error: "State or metrics not found" }, { status: 404 });
    }

    const catData = metrics[category as MetricCategoryId] as
      Record<string, { value: number; trend?: number }> | undefined;
    let metricVal = catData?.[metricId];
    // Backfill independenceDesire for SCO/WAL/NIR on stale DBs that predate
    // Phase 2 seeding. Matches the FM Devolution tab + region metrics tab
    // fallbacks so the over-time page loads immediately. Real values appear
    // once a turn ticks (drift) or admin reseeds.
    if (
      metricVal === undefined &&
      category === "governance" &&
      metricId === "independenceDesire" &&
      isUKDevolutionRegion(stateId)
    ) {
      metricVal = { value: 50, trend: 0 };
    }
    if (metricVal === undefined) {
      return NextResponse.json({ error: "Metric not found" }, { status: 404 });
    }

    // National average for this metric within the same country
    const countryStateIds = new Set(
      allStates.filter((state) => state.countryId === stateDoc.countryId).map((state) => state._id)
    );
    const values = allMetrics
      .filter((m) => !NATIONAL_SCOPE_IDS.has(String(m._id)) && countryStateIds.has(String(m._id)))
      .map((m) => {
        const c = m[category as MetricCategoryId] as Record<string, { value: number }> | undefined;
        return c?.[metricId]?.value;
      })
      .filter((v): v is number => v !== undefined);
    const nationalAverage =
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;

    // Per-turn tick rate from active policies
    const tickRates = await computeStateTickRates(db, stateId, countryId);
    const tickRate = tickRates[category]?.[metricId];

    // Historical data
    const history = await getMetricHistory(db, stateId, category as MetricCategoryId, metricId);

    // Policies affecting this metric via effectTargetsWeighted.
    // Fetch the state's own policies plus every national-scope doc in one query; pick the
    // one matching this state's country (fall back to the US federal bucket).
    const nationalScopeIds = Object.keys(NATIONAL_SCOPE);
    const allPolicyDocs = await db
      .collection<StatePolicy>("statePolicies")
      .find({ stateId: { $in: [stateId, ...nationalScopeIds] } })
      .toArray();
    const statePoliciesArr = allPolicyDocs.filter((p) => p.stateId === stateId);
    const nationalScopeId = getNationalDocId(stateDoc.countryId);
    const effectiveScopeId = nationalScopeId ?? "federal";
    const nationalPoliciesArr = allPolicyDocs.filter((p) => p.stateId === effectiveScopeId);
    const allActivePolicies = [
      ...statePoliciesArr.map((p) => ({ ...p, scope: "state" as const, scopeMultiplier: 1.0 })),
      ...nationalPoliciesArr.map((p) => ({
        ...p,
        scope: "national" as const,
        scopeMultiplier: FEDERAL_MULTIPLIER,
      })),
    ];
    const uniqueLegTypeIds = [...new Set(allActivePolicies.map((p) => p.legislationTypeId))];
    const legTypes = await db
      .collection<LegislationType>("legislationTypes")
      .find({ _id: { $in: uniqueLegTypeIds } })
      .toArray();
    const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

    const affectingPolicies: AffectingPolicy[] = [];

    for (const policy of allActivePolicies) {
      // 📊 budget-sync: computed fiscal metrics are mirror-owned — no affecting policies.
      if (MIRROR_CONTROLLED_METRIC_IDS.has(metricId)) break;
      const legType = legTypeMap.get(policy.legislationTypeId);
      if (!legType) continue;

      const matchedOption = getMatchedPolicyOption(legType, policy);
      const matchingTargets = legType.effectTargetsWeighted?.filter(
        (t) => t.metricCategoryId === category && t.metricId === metricId
      );
      if (!matchingTargets || matchingTargets.length === 0) {
        const consumptionTaxPolicy = getConsumptionTaxGdpPolicy({
          legType,
          matchedOption,
          countryId: stateDoc.countryId,
          category,
          metricId,
          scope: policy.scope,
        });
        if (consumptionTaxPolicy) affectingPolicies.push(consumptionTaxPolicy);
        continue;
      }

      const policyDirection = getFallbackPolicyDirection(policy, matchedOption, category);
      if (policyDirection === 0) continue;

      const totalWeightedDirection = matchingTargets.reduce(
        (sum, t) => sum + t.weight * policyDirection,
        0
      );
      const totalWeight = matchingTargets.reduce((sum, t) => sum + Math.abs(t.weight), 0);

      affectingPolicies.push({
        name: legType.name,
        policyOptionName: matchedOption?.name,
        pushesMetricUp: pushesValueUp(totalWeightedDirection, isHigherBetter),
        weight: totalWeight,
        scope: policy.scope,
      });
    }

    return NextResponse.json(
      {
        stateId,
        stateName: stateDoc.name ?? stateId,
        category,
        metricId,
        value: metricVal.value,
        trend: metricVal.trend,
        nationalAverage,
        tickRate,
        history,
        affectingPolicies,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
