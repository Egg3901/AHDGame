/**
 * JP regional budget constraint system.
 *
 * Runs every turn alongside UK budget processing. Calculates each JP
 * region's budget from resident tax, fixed asset tax, and the national
 * government grant (Local Allocation Tax), then compares against enacted
 * spending. Regions in deficit for more than one turn trigger forced
 * austerity (most expensive programme downgraded one tier).
 *
 * Revenue = Resident Tax + Fixed Asset Tax + National Grant
 * Headroom = Revenue - Enacted Spending ≥ 0
 *
 * Default grant distribution: equal 1/8th per region.
 * The Internal Affairs minister can override those shares via cabinet settings.
 */

import type { AnyBulkWriteOperation } from "mongodb";
import type { State, StateMetrics } from "@/lib/db/types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import { loadAnnualSubsidyCostMaps } from "@/lib/subsidies/subsidyBudgetCosts";

// ── Constants ────────────────────────────────────────────────────────────────

const JP_REGION_COUNT = 8;

const RESIDENT_TAX_TYPE_ID = "jp_resident_tax";
const FIXED_ASSET_TAX_TYPE_ID = "jp_fixed_asset_tax";
const LOCAL_ALLOCATION_TAX_TYPE_ID = "jp_local_allocation_tax";

/** Tax type IDs excluded from spending calculations (they generate revenue). */
const JP_TAX_TYPE_IDS = new Set([RESIDENT_TAX_TYPE_ID, FIXED_ASSET_TAX_TYPE_ID]);

/** Default median income per capita for JP regions (¥4.4M national median). */
const DEFAULT_MEDIAN_INCOME = 4_400_000;

/** Default property value per capita for JP regions. */
const DEFAULT_PROPERTY_VALUE = 8_000_000;

// ── Pure calculation ─────────────────────────────────────────────────────────

export interface JPBudgetInput {
  residentTaxRate: number;
  fixedAssetTaxRate: number;
  nationalGrantPerCapita: number;
  regionPopulation: number;
  medianIncome: number;
  propertyValueBase: number;
  nationalPopulation: number;
  ministerAllocation: number | null;
}

export interface JPBudgetResult {
  residentTaxRevenue: number;
  fixedAssetTaxRevenue: number;
  nationalGrant: number;
  totalBudget: number;
}

/**
 * Calculate a JP region's total budget from its three revenue sources.
 *
 * Resident tax and fixed asset tax scale linearly with rate × value base × population.
 * The national grant either uses a minister-set allocation or defaults to an
 * even 1/8th split of the national per-capita grant pool.
 */
export function calculateJPRegionalBudget(input: JPBudgetInput): JPBudgetResult {
  const residentTaxRevenue = input.residentTaxRate * input.medianIncome * input.regionPopulation;
  const fixedAssetTaxRevenue =
    input.fixedAssetTaxRate * input.propertyValueBase * input.regionPopulation;
  const nationalGrant =
    input.ministerAllocation ??
    (input.nationalGrantPerCapita * input.nationalPopulation) / JP_REGION_COUNT;
  const totalBudget = residentTaxRevenue + fixedAssetTaxRevenue + nationalGrant;

  return { residentTaxRevenue, fixedAssetTaxRevenue, nationalGrant, totalBudget };
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

/**
 * Main turn processing function for JP regional budgets.
 *
 * Called once per turn. Fetches all JP regions, calculates budgets, detects
 * deficits, applies forced austerity when needed, and upserts RegionalBudget
 * documents.
 */
export async function processJPRegionalBudgets(
  db: import("mongodb").Db,
  turnNumber: number
): Promise<{ regionsProcessed: number }> {
  const jpRegions = await db.collection<State>("states").find({ countryId: "JP" }).toArray();
  if (jpRegions.length === 0) return { regionsProcessed: 0 };

  const { stateCostByStateId } = await loadAnnualSubsidyCostMaps(db);

  // Fetch all enacted JP regional policies
  const regionIds = jpRegions.map((r) => r._id as string);
  const allRegionalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: { $in: regionIds } })
    .toArray();

  // Fetch JP national policies (for Local Allocation Tax amount)
  const nationalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: "jp_national" })
    .toArray();

  // Fetch relevant legislation types
  const regionalLegTypeIds = new Set(allRegionalPolicies.map((p) => p.legislationTypeId));
  const nationalLegTypeIds = new Set(nationalPolicies.map((p) => p.legislationTypeId));
  const allLegTypeIds = [...new Set([...regionalLegTypeIds, ...nationalLegTypeIds])];

  const legTypes = await db
    // full-read(legislationTypes): policyOptions tables price every regional law
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: allLegTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  // Find national grant per capita from jp_local_allocation_tax
  const fundingPolicy = nationalPolicies.find(
    (p) => p.legislationTypeId === LOCAL_ALLOCATION_TAX_TYPE_ID
  );
  const nationalGrantPerCapita = fundingPolicy
    ? getOptionCostPerCapita(fundingPolicy, legTypeMap)
    : 0;

  const nationalPopulation = jpRegions.reduce((sum, r) => sum + r.population, 0);

  // Group regional policies by stateId
  const policiesByRegion = new Map<string, StatePolicy[]>();
  for (const policy of allRegionalPolicies) {
    const existing = policiesByRegion.get(policy.stateId) ?? [];
    existing.push(policy);
    policiesByRegion.set(policy.stateId, existing);
  }

  // Fetch existing budget documents
  const existingBudgets = await db
    .collection<RegionalBudget>("regionalBudgets")
    .find({ _id: { $in: regionIds } })
    .toArray();
  const budgetMap = new Map(existingBudgets.map((b) => [b._id, b]));

  // Fetch real median income per region (SP5: economic.* lives on macroMetrics)
  const stateMetrics = await db
    .collection<StateMetrics>("macroMetrics")
    .find({ _id: { $in: regionIds } })
    .toArray();
  const metricsMap = new Map(stateMetrics.map((m) => [m._id, m]));

  // Cabinet settings are keyed as `${countryId}_${positionId}`. JP regional
  // transfers are administered through Internal Affairs, so the turn phase must
  // read that exact position key or the UI sliders never affect live budgets.
  const ministerSetting = await db
    .collection<CabinetSetting>("cabinetSettings")
    .findOne({ _id: "JP_internal_affairs_minister" });
  const allocationPercents = ministerSetting?.allocationPercents ?? null;

  let regionsProcessed = 0;
  // Batched per-region writes (see regionalBudget.ts for rationale) — scales
  // with region count toward the 30-50-country target.
  const statePolicyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
  const regionalBudgetOps: AnyBulkWriteOperation<RegionalBudget>[] = [];

  for (const region of jpRegions) {
    const regionPolicies = policiesByRegion.get(region._id) ?? [];
    const existingBudget = budgetMap.get(region._id);

    // Find resident tax rate and fixed asset tax rate
    const residentTaxPolicy = regionPolicies.find(
      (p) => p.legislationTypeId === RESIDENT_TAX_TYPE_ID
    );
    const fixedAssetPolicy = regionPolicies.find(
      (p) => p.legislationTypeId === FIXED_ASSET_TAX_TYPE_ID
    );

    const residentTaxRate = getTaxRateFromPolicy(residentTaxPolicy, legTypeMap) / 100;
    const fixedAssetTaxRate = getTaxRateFromPolicy(fixedAssetPolicy, legTypeMap) / 100;

    // Read median income from actual state metrics; fall back to national default
    const regionMetrics = metricsMap.get(region._id);
    const medianIncome = regionMetrics?.economic?.medianIncome?.value ?? DEFAULT_MEDIAN_INCOME;
    const propertyValueBase = existingBudget?.propertyValuePerCapita ?? DEFAULT_PROPERTY_VALUE;
    const propertyBaseline = existingBudget?.propertyValueBaseline ?? DEFAULT_PROPERTY_VALUE;

    const ministerAllocation = allocationPercents
      ? ((allocationPercents[region._id] ?? 100 / JP_REGION_COUNT) / 100) *
        (nationalGrantPerCapita * nationalPopulation)
      : null;

    // Calculate total budget
    const budgetResult = calculateJPRegionalBudget({
      residentTaxRate,
      fixedAssetTaxRate,
      nationalGrantPerCapita,
      regionPopulation: region.population,
      medianIncome,
      propertyValueBase,
      nationalPopulation,
      ministerAllocation,
    });

    // Sum all enacted regional spending (excluding tax types)
    const spendingPolicies = regionPolicies.filter(
      (p) => !JP_TAX_TYPE_IDS.has(p.legislationTypeId)
    );
    let enactedBillCosts = 0;
    for (const policy of spendingPolicies) {
      const costPerCapita = getOptionCostPerCapita(policy, legTypeMap);
      enactedBillCosts += costPerCapita * region.population;
    }
    // JP prefectural budgets share the same parallel-phase constraint as UK
    // regions, so subsidy spend has to be composed into the persisted budget here.
    const subsidyCosts = stateCostByStateId.get(region._id) ?? 0;
    enactedBillCosts += subsidyCosts;

    // Determine surplus/deficit
    const surplus = budgetResult.totalBudget - enactedBillCosts;
    const isOverBudget = surplus < 0;
    const previousTurnsOver = existingBudget?.turnsOverBudget ?? 0;
    const turnsOverBudget = isOverBudget ? previousTurnsOver + 1 : 0;

    // Forced austerity: if over budget for more than 1 turn, downgrade most expensive programme
    if (turnsOverBudget > 1 && spendingPolicies.length > 0) {
      const policiesWithCost = spendingPolicies.map((p) => ({
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

    // Upsert the RegionalBudget document
    const budgetDoc: RegionalBudget = {
      _id: region._id,
      countryId: "JP",
      turn: turnNumber,
      // UK fields zeroed for JP regions
      councilTaxRevenue: 0,
      businessRatesRevenue: 0,
      westminsterGrant: 0,
      // JP-specific revenue
      residentTaxRevenue: budgetResult.residentTaxRevenue,
      fixedAssetTaxRevenue: budgetResult.fixedAssetTaxRevenue,
      nationalGrant: budgetResult.nationalGrant,
      totalBudget: budgetResult.totalBudget,
      enactedBillCosts,
      subsidyCosts,
      surplus,
      isOverBudget,
      turnsOverBudget,
      propertyValuePerCapita: propertyValueBase,
      commercialValuePerCapita: 0,
      propertyValueBaseline: propertyBaseline,
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
