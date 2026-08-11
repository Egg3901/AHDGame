/**
 * CN regional budget constraint system.
 *
 * Runs every turn alongside UK, JP, and DE budget processing. Calculates each
 * CN macro-region's budget from two sources:
 *
 *   1. EIT local share (企业所得税地方分成): 40% of Enterprise Income Tax
 *      collected in-territory, derived from enacted cn_enterprise_income_tax
 *      rate × regional GDP × corporate profit ratio.
 *   2. Central transfer grant (中央转移支付): Finance Minister-controlled
 *      redistribution from a national pool, or an equal 1/7th split by default.
 *   3. Provincial Resource Tax revenue (资源税): per-region rate set by the
 *      enacted cn_provincial_resource_tax policy × regional GDP × resource-
 *      extraction proxy (analogous to DE's Hebesatz-driven tradeTaxRevenue).
 *
 * Enacted regional spending (non-tax provincial legislation types — added in
 * PR4-5 of the CN legislation overhaul) is compared against total revenue.
 * Regions in deficit for more than one turn trigger forced austerity (most
 * expensive programme downgraded one tier).
 */

import type { Db } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import type { State } from "@/lib/db/types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import { loadAnnualSubsidyCostMaps } from "@/lib/subsidies/subsidyBudgetCosts";
import { getCountryConfig } from "@/lib/constants/countries";

// ── Pure calculation ─────────────────────────────────────────────────────────

/**
 * Budget-math constants for one-party countries with a CN-style
 * "local-retention + central transfer" model. Production callers derive
 * these from `CountryConfig.onePartyRegionalBudget` plus the dynamic
 * region count.
 */
export interface OnePartyBudgetConfig {
  /** Share of the per-region tax retained locally (CN: 0.40). */
  localTaxRetentionShare: number;
  /** Corporate profits as a fraction of regional GDP (CN: 0.06). */
  corporateProfitRatio: number;
  /** Default central transfer pool per capita (local currency / year). */
  centralTransferPerCapita: number;
  /** Number of regions used for the equal-split fallback (= regions.length). */
  regionCount: number;
  /**
   * Resource-extraction (mining, oil/gas, water, salt) as a fraction of
   * regional GDP. Base for per-region resource-tax revenue. Optional — when
   * undefined, resource-tax revenue is zero regardless of policy state.
   * CN: 0.03 — real-world share varies widely by province; this is a
   * nation-wide proxy.
   */
  resourceExtractionRatio?: number;
  /**
   * Consumption base as a fraction of regional GDP for the standing Business
   * Tax (营业税) — the dominant 1991 Chinese local tax. CN: 0.50. Optional —
   * when undefined, Business Tax revenue is zero.
   */
  businessTaxConsumptionRatio?: number;
  /** Standing Business Tax rate (percent). CN: 24. Optional; default 0. */
  businessTaxRate?: number;
}

/** CN-shaped defaults for backward-compat with pure-function callers (tests). */
const DEFAULT_ONE_PARTY_BUDGET_CONFIG: OnePartyBudgetConfig = {
  localTaxRetentionShare: 0.4,
  corporateProfitRatio: 0.06,
  centralTransferPerCapita: 4_000,
  regionCount: 7,
  resourceExtractionRatio: 0.03,
};

export interface CNBudgetInput {
  /** Enacted EIT rate as a percentage (e.g. 25 for 25%). */
  eitRate: number;
  /** Regional GDP in millions of CNY (matches State.gdp field). */
  regionGdp: number;
  regionPopulation: number;
  nationalPopulation: number;
  /** Finance Minister override (absolute CNY). null = use equal 1/N split. */
  ministerAllocation: number | null;
  /**
   * Per-region Resource Tax rate from the enacted cn_provincial_resource_tax
   * policy (percentage, e.g. 6 for 6%). Defaults to 0 when the region has not
   * enacted the policy yet.
   */
  resourceTaxRate?: number;
}

export interface CNBudgetResult {
  eitShare: number;
  centralTransferGrant: number;
  resourceTaxRevenue: number;
  businessTaxRevenue: number;
  totalBudget: number;
}

export function calculateCNRegionalBudget(
  input: CNBudgetInput,
  budgetConfig: OnePartyBudgetConfig = DEFAULT_ONE_PARTY_BUDGET_CONFIG
): CNBudgetResult {
  const eitShare =
    input.regionGdp *
    1_000_000 *
    budgetConfig.corporateProfitRatio *
    (input.eitRate / 100) *
    budgetConfig.localTaxRetentionShare;

  const centralTransferGrant =
    input.ministerAllocation ??
    (budgetConfig.centralTransferPerCapita * input.nationalPopulation) / budgetConfig.regionCount;

  const resourceTaxRevenue =
    input.regionGdp *
    1_000_000 *
    (budgetConfig.resourceExtractionRatio ?? 0) *
    ((input.resourceTaxRate ?? 0) / 100);

  // Standing Business Tax (营业税) — the dominant 1991 Chinese local tax. Always
  // collected (not enactment-gated) so regions are reliably self-funding.
  const businessTaxRevenue =
    input.regionGdp *
    1_000_000 *
    (budgetConfig.businessTaxConsumptionRatio ?? 0) *
    ((budgetConfig.businessTaxRate ?? 0) / 100);

  return {
    eitShare,
    centralTransferGrant,
    resourceTaxRevenue,
    businessTaxRevenue,
    totalBudget: eitShare + centralTransferGrant + resourceTaxRevenue + businessTaxRevenue,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTaxRateFromPolicy(
  policy: StatePolicy | undefined,
  legTypeMap: Map<string, LegislationType>
): number {
  if (!policy) return 0;
  const legType = legTypeMap.get(policy.legislationTypeId);
  if (!legType?.policyOptions) return 0;
  const option = legType.policyOptions.find((o) => o.id === policy.policyOptionId);
  return option?.rate ?? 0;
}

function getOptionCostPerCapita(
  policy: StatePolicy | undefined,
  legTypeMap: Map<string, LegislationType>
): number {
  if (!policy) return 0;
  const legType = legTypeMap.get(policy.legislationTypeId);
  if (!legType?.policyOptions) return 0;
  const option = legType.policyOptions.find((o) => o.id === policy.policyOptionId);
  return option?.annualCostPerCapita ?? 0;
}

// ── Turn processing ──────────────────────────────────────────────────────────

export async function processCNRegionalBudgets(
  db: Db,
  turnNumber: number,
  preset?: string
): Promise<{ regionsProcessed: number }> {
  // Read CN's budget knobs from CountryConfig. If the field is absent
  // (misconfigured), bail rather than fall back to magic numbers. `preset` is
  // threaded through so era-specific knobs (e.g. the 1953-scaled
  // centralTransferPerCapita in ERA_COUNTRY_CONFIG_OVERRIDES) apply — without
  // it every era shares the modern/1991 CNY-calibrated constant, which is
  // ~35x too large against the USD-anchored 1953 CN budget (fiscal-scale
  // audit, 2026-07-28).
  const countryConfig = getCountryConfig("CN", preset);
  const budgetKnobs = countryConfig.onePartyRegionalBudget;
  if (!budgetKnobs) return { regionsProcessed: 0 };

  const cnRegions = await db.collection<State>("states").find({ countryId: "CN" }).toArray();
  if (cnRegions.length === 0) return { regionsProcessed: 0 };

  const budgetConfig: OnePartyBudgetConfig = {
    localTaxRetentionShare: budgetKnobs.localTaxRetentionShare,
    corporateProfitRatio: budgetKnobs.corporateProfitRatio,
    centralTransferPerCapita: budgetKnobs.centralTransferPerCapita,
    regionCount: cnRegions.length,
    resourceExtractionRatio: budgetKnobs.resourceExtractionRatio,
    businessTaxConsumptionRatio: budgetKnobs.businessTaxConsumptionRatio,
    businessTaxRate: budgetKnobs.businessTaxRate,
  };

  const { stateCostByStateId } = await loadAnnualSubsidyCostMaps(db);

  const regionIds = cnRegions.map((r) => r._id as string);

  const allRegionalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: { $in: regionIds } })
    .toArray();

  const nationalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: "cn_national" })
    .toArray();

  const allLegTypeIds = [
    ...new Set([
      ...allRegionalPolicies.map((p) => p.legislationTypeId),
      ...nationalPolicies.map((p) => p.legislationTypeId),
    ]),
  ];

  const legTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: allLegTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  const eitPolicy = nationalPolicies.find(
    (p) => p.legislationTypeId === budgetKnobs.primaryTaxLegislationKey
  );
  const eitRate = getTaxRateFromPolicy(eitPolicy, legTypeMap) || budgetKnobs.defaultTaxRate;

  const nationalPopulation = cnRegions.reduce((sum, r) => sum + r.population, 0);

  const policiesByRegion = new Map<string, StatePolicy[]>();
  for (const policy of allRegionalPolicies) {
    const existing = policiesByRegion.get(policy.stateId) ?? [];
    existing.push(policy);
    policiesByRegion.set(policy.stateId, existing);
  }

  const existingBudgets = await db
    .collection<RegionalBudget>("regionalBudgets")
    .find({ _id: { $in: regionIds } })
    .toArray();
  const budgetMap = new Map(existingBudgets.map((b) => [b._id, b]));

  // Finance Minister cabinet setting controls central transfer distribution
  const ministerSetting = await db
    .collection<CabinetSetting>("cabinetSettings")
    .findOne({ _id: "CN_minister_of_finance" });
  const allocationPercents = ministerSetting?.allocationPercents ?? null;

  let regionsProcessed = 0;
  // Batched per-region writes (see regionalBudget.ts for rationale).
  const statePolicyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
  const regionalBudgetOps: AnyBulkWriteOperation<RegionalBudget>[] = [];

  for (const region of cnRegions) {
    const regionPolicies = policiesByRegion.get(region._id) ?? [];
    const existingBudget = budgetMap.get(region._id);

    const ministerAllocation = allocationPercents
      ? ((allocationPercents[region._id] ?? 100 / budgetConfig.regionCount) / 100) *
        (budgetConfig.centralTransferPerCapita * nationalPopulation)
      : null;

    // Per-region Resource Tax policy (CN: 资源税) — analogous to DE's per-Land
    // Hebesatz. Absent when the country config has no resourceTaxLegislationKey
    // or when the region has not yet enacted the policy.
    const resourceTaxPolicy = budgetKnobs.resourceTaxLegislationKey
      ? regionPolicies.find((p) => p.legislationTypeId === budgetKnobs.resourceTaxLegislationKey)
      : undefined;
    const resourceTaxRate = getTaxRateFromPolicy(resourceTaxPolicy, legTypeMap);

    const budgetResult = calculateCNRegionalBudget(
      {
        eitRate,
        regionGdp: region.gdp ?? 0,
        regionPopulation: region.population,
        nationalPopulation,
        ministerAllocation,
        resourceTaxRate,
      },
      budgetConfig
    );

    let enactedBillCosts = 0;
    for (const policy of regionPolicies) {
      enactedBillCosts += getOptionCostPerCapita(policy, legTypeMap) * region.population;
    }
    const subsidyCosts = stateCostByStateId.get(region._id) ?? 0;
    enactedBillCosts += subsidyCosts;

    const surplus = budgetResult.totalBudget - enactedBillCosts;
    const isOverBudget = surplus < 0;
    const previousTurnsOver = existingBudget?.turnsOverBudget ?? 0;
    const turnsOverBudget = isOverBudget ? previousTurnsOver + 1 : 0;

    if (turnsOverBudget > 1 && regionPolicies.length > 0) {
      const policiesWithCost = regionPolicies.map((p) => ({
        policy: p,
        cost: getOptionCostPerCapita(p, legTypeMap),
      }));
      policiesWithCost.sort((a, b) => b.cost - a.cost);

      const mostExpensive = policiesWithCost[0];
      if (mostExpensive && mostExpensive.cost > 0) {
        const legType = legTypeMap.get(mostExpensive.policy.legislationTypeId);
        if (legType?.policyOptions) {
          const currentIndex = legType.policyOptions.findIndex(
            (o) => o.id === mostExpensive.policy.policyOptionId
          );
          if (currentIndex > 0) {
            const newOption = legType.policyOptions[currentIndex - 1] as LegislationPolicyOption;
            statePolicyOps.push({
              updateOne: {
                filter: {
                  stateId: region._id,
                  legislationTypeId: mostExpensive.policy.legislationTypeId,
                },
                update: {
                  $set: {
                    policyOptionId: newOption.id,
                    policyOptionIndex: currentIndex - 1,
                    economic: newOption.economic,
                    social: newOption.social,
                    effectDirection: newOption.effectDirection,
                  },
                },
              },
            });
          }
        }
      }
    }

    const budgetDoc: RegionalBudget = {
      _id: region._id,
      countryId: "CN",
      turn: turnNumber,
      councilTaxRevenue: 0,
      businessRatesRevenue: 0,
      westminsterGrant: 0,
      eitShare: budgetResult.eitShare,
      centralTransferGrant: budgetResult.centralTransferGrant,
      resourceTaxRevenue: budgetResult.resourceTaxRevenue,
      businessTaxRevenue: budgetResult.businessTaxRevenue,
      totalBudget: budgetResult.totalBudget,
      enactedBillCosts,
      subsidyCosts,
      surplus,
      isOverBudget,
      turnsOverBudget,
      propertyValuePerCapita: 0,
      commercialValuePerCapita: 0,
      propertyValueBaseline: 0,
      commercialValueBaseline: 0,
      chancellorAllocation: ministerAllocation,
      updatedAt: new Date(),
    };

    regionalBudgetOps.push({
      updateOne: { filter: { _id: region._id }, update: { $set: budgetDoc }, upsert: true },
    });

    regionsProcessed++;
  }

  if (statePolicyOps.length > 0) {
    await db.collection<StatePolicy>("statePolicies").bulkWrite(statePolicyOps);
  }
  if (regionalBudgetOps.length > 0) {
    await db.collection<RegionalBudget>("regionalBudgets").bulkWrite(regionalBudgetOps);
  }

  return { regionsProcessed };
}
