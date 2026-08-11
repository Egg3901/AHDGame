/**
 * Regional budget constraint system for UK regions.
 *
 * Runs every turn as part of the effects & metrics group. Calculates each UK
 * region's budget from council tax, business rates, and the Westminster grant,
 * then compares against enacted spending. Regions in deficit for more than one
 * turn trigger forced austerity (most expensive programme downgraded one tier).
 *
 * Pure calculation helpers are exported separately for testability.
 */

import type { AnyBulkWriteOperation } from "mongodb";
import type { State } from "@/lib/db/types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import { loadAnnualSubsidyCostMaps } from "@/lib/subsidies/subsidyBudgetCosts";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";

// ── Pure calculation types ───────────────────────────────────────────────────

export interface BudgetCalculationInput {
  councilTaxRate: number; // e.g. 0.015 for 1.5%
  businessRate: number; // e.g. 0.5 for 50%
  propertyValuePerCapita: number;
  commercialValuePerCapita: number;
  regionPopulation: number;
  westminsterGrantPerCapita: number; // From uk_local_government_funding legislation
  nationalPopulation: number; // ~67M
  chancellorAllocation: number | null; // null = even 1/12th split
}

export interface BudgetCalculationResult {
  councilTaxRevenue: number;
  businessRatesRevenue: number;
  westminsterGrant: number;
  totalBudget: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of UK regions sharing the Westminster grant when no chancellor allocation exists. */
const UK_REGION_COUNT = 12;

/** Default property value per capita used when no budget doc exists yet. */
const DEFAULT_PROPERTY_VALUE_PER_CAPITA = 120_000;

/** Default commercial value per capita used when no budget doc exists yet. */
const DEFAULT_COMMERCIAL_VALUE_PER_CAPITA = 45_000;

// Tax legislation type IDs
const COUNCIL_TAX_TYPE_ID = "uk_council_tax";
const BUSINESS_RATES_TYPE_ID = "uk_business_rates";
const LOCAL_GOVT_FUNDING_TYPE_ID = "uk_local_government_funding";

/** Tax type IDs excluded from spending calculations (they generate revenue, not spend). */
const TAX_TYPE_IDS = new Set([COUNCIL_TAX_TYPE_ID, BUSINESS_RATES_TYPE_ID]);

// ── Pure functions ───────────────────────────────────────────────────────────

/**
 * Calculate a region's total budget from its three revenue sources.
 *
 * Council tax and business rates scale linearly with rate × value base × population.
 * The Westminster grant either uses a chancellor-set allocation or defaults to an
 * even 1/12th split of the national per-capita grant pool.
 */
export function calculateRegionalBudget(input: BudgetCalculationInput): BudgetCalculationResult {
  const councilTaxRevenue =
    input.councilTaxRate * input.propertyValuePerCapita * input.regionPopulation;
  const businessRatesRevenue =
    input.businessRate * input.commercialValuePerCapita * input.regionPopulation;
  const westminsterGrant =
    input.chancellorAllocation ??
    (input.westminsterGrantPerCapita * input.nationalPopulation) / UK_REGION_COUNT;
  const totalBudget = councilTaxRevenue + businessRatesRevenue + westminsterGrant;

  return { councilTaxRevenue, businessRatesRevenue, westminsterGrant, totalBudget };
}

/**
 * Drift a value base (property or commercial) toward a policy-determined target.
 *
 * Each turn the current value moves 0.3% of the distance to the target (0.5%
 * if the region is in deficit — austerity erodes the tax base faster). Values
 * are clamped to 25%–300% of the original baseline to prevent runaway spirals.
 */
export function driftValueBase(
  currentValue: number,
  baseline: number,
  targetMultiplier: number,
  isInDeficit: boolean
): number {
  const target = baseline * targetMultiplier;
  // Deficit accelerates downward drift because reduced services erode property values
  const driftRate = isInDeficit ? 0.005 : 0.003;
  const newValue = currentValue + (target - currentValue) * driftRate;
  const floor = baseline * 0.25;
  const ceiling = baseline * 3.0;
  return Math.max(floor, Math.min(ceiling, newValue));
}

// ── Turn processing ──────────────────────────────────────────────────────────

/**
 * Find the tax rate from a state policy by looking up its option in the legislation type.
 * Returns the `rate` field from the matching policy option, or 0 if not found.
 */
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

/**
 * Get the annual cost per capita for a policy option.
 * Returns 0 if the option is not found or has no cost defined.
 */
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

/**
 * Annual cost of an enacted regional policy on the region's own fiscal base.
 * Political-legislation v2 laws (spec §5.2) price through the new cost engine
 * (their options carry costModelV2, not annualCostPerCapita — the legacy
 * per-capita path would silently price them at 0); legacy laws keep the
 * per-capita × population form.
 */
function enactedRegionalPolicyCost(
  policy: StatePolicy,
  legTypeMap: Map<string, LegislationType>,
  region: State
): number {
  const law = getLaw(policy.legislationTypeId);
  if (law && law.kind !== "tax" && law.levels) {
    const level = Math.max(0, Math.min(4, policy.policyOptionIndex ?? 0));
    const fiscal = computeLawCost(
      law.levels[level],
      { gdp: (region.gdp ?? 0) * 1_000_000, population: region.population ?? 0 },
      law.countryId,
      null
    );
    // NET burden: a regional enactment's revenue accrues to the same payer
    // (spec §5.2 — "each payer its own"), so revenue-bearing laws charge
    // cost − revenue (a net contributor reduces the region's spending line).
    return fiscal.cost - fiscal.revenue;
  }
  return getOptionCostPerCapita(policy, legTypeMap) * region.population;
}

/**
 * Compute a spending-derived target multiplier for value base drift.
 *
 * High spending relative to the centrist baseline pushes values up (investment
 * improves the area); low spending pushes them down (neglect erodes values).
 * Centrist option (#3, index 3) maps to multiplier 1.0.
 */
function computeSpendingMultiplier(
  spendingPolicies: StatePolicy[],
  legTypeMap: Map<string, LegislationType>
): number {
  if (spendingPolicies.length === 0) return 1.0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const policy of spendingPolicies) {
    const legType = legTypeMap.get(policy.legislationTypeId);
    if (!legType?.policyOptions) continue;
    const optionIndex = legType.policyOptions.findIndex((o) => o.id === policy.policyOptionId);
    if (optionIndex < 0) continue;

    // Map option index to a multiplier: centrist (index 3) = 1.0
    // 7 options: indices 0..6 map to multipliers 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7
    const optionCount = legType.policyOptions.length;
    const centristIndex = Math.floor(optionCount / 2);
    const deviation = centristIndex - optionIndex; // positive = left/high spending
    const multiplier = 1.0 + deviation * 0.1;

    weightedSum += multiplier;
    totalWeight += 1;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 1.0;
}

/**
 * Main turn processing function for UK regional budgets.
 *
 * Called once per turn. Fetches all UK regions, calculates budgets, detects
 * deficits, applies forced austerity when needed, drifts value bases, and
 * upserts RegionalBudget documents.
 *
 * @returns Object with regionsProcessed count.
 */
export async function processRegionalBudgets(
  db: import("mongodb").Db,
  turnNumber: number
): Promise<{ regionsProcessed: number }> {
  // 1. Fetch all UK regions
  const ukRegions = await db.collection<State>("states").find({ countryId: "UK" }).toArray();

  if (ukRegions.length === 0) return { regionsProcessed: 0 };

  const { stateCostByStateId } = await loadAnnualSubsidyCostMaps(db);

  // 2. Fetch all enacted UK regional policies
  const allRegionalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: { $in: ukRegions.map((r) => r._id as string) } })
    .toArray();

  // 3. Fetch UK national policies (for Westminster grant amount)
  const nationalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: "uk_national" })
    .toArray();

  // 4. Fetch relevant legislation types for option lookups
  const regionalLegTypeIds = new Set(allRegionalPolicies.map((p) => p.legislationTypeId));
  const nationalLegTypeIds = new Set(nationalPolicies.map((p) => p.legislationTypeId));
  const allLegTypeIds = [...new Set([...regionalLegTypeIds, ...nationalLegTypeIds])];

  const legTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: allLegTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  // 5. Find Westminster grant per capita from national uk_local_government_funding policy
  const fundingPolicy = nationalPolicies.find(
    (p) => p.legislationTypeId === LOCAL_GOVT_FUNDING_TYPE_ID
  );
  const westminsterGrantPerCapita = fundingPolicy
    ? getOptionCostPerCapita(fundingPolicy, legTypeMap)
    : 0;

  // Total UK population for even-split calculation
  const nationalPopulation = ukRegions.reduce((sum, r) => sum + r.population, 0);

  // Group regional policies by stateId for efficient lookup
  const policiesByRegion = new Map<string, StatePolicy[]>();
  for (const policy of allRegionalPolicies) {
    const existing = policiesByRegion.get(policy.stateId) ?? [];
    existing.push(policy);
    policiesByRegion.set(policy.stateId, existing);
  }

  // 6. Fetch existing budget documents for all regions
  const regionIds = ukRegions.map((r) => r._id);
  const existingBudgets = await db
    .collection<RegionalBudget>("regionalBudgets")
    .find({ _id: { $in: regionIds } })
    .toArray();
  const budgetMap = new Map(existingBudgets.map((b) => [b._id, b]));

  // Read Chancellor allocation percentages from cabinet settings
  const chancellorSetting = await db
    .collection<CabinetSetting>("cabinetSettings")
    .findOne({ _id: "UK_chancellor" });
  const allocationPercents = chancellorSetting?.allocationPercents ?? null;

  let regionsProcessed = 0;

  // Batched: the per-region regionalBudgets upsert (always) and the rare
  // forced-austerity statePolicies update used to be sequential updateOne
  // calls inside this loop — one+ round-trip per region. Accumulate into
  // bulkWrite arrays and commit once after the loop. Small at 12 UK regions,
  // but this is the shape every per-country regional-budget phase shares, and
  // it scales with region count toward the 30-50-country target.
  const statePolicyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
  const regionalBudgetOps: AnyBulkWriteOperation<RegionalBudget>[] = [];

  for (const region of ukRegions) {
    const regionPolicies = policiesByRegion.get(region._id) ?? [];
    const existingBudget = budgetMap.get(region._id);

    // a. Find council tax rate and business rate from enacted tax policies
    const councilTaxPolicy = regionPolicies.find(
      (p) => p.legislationTypeId === COUNCIL_TAX_TYPE_ID
    );
    const businessRatePolicy = regionPolicies.find(
      (p) => p.legislationTypeId === BUSINESS_RATES_TYPE_ID
    );

    const councilTaxRate = getTaxRateFromPolicy(councilTaxPolicy, legTypeMap) / 100;
    const businessRate = getTaxRateFromPolicy(businessRatePolicy, legTypeMap) / 100;

    // Use existing value bases or defaults
    const propertyValuePerCapita =
      existingBudget?.propertyValuePerCapita ?? DEFAULT_PROPERTY_VALUE_PER_CAPITA;
    const commercialValuePerCapita =
      existingBudget?.commercialValuePerCapita ?? DEFAULT_COMMERCIAL_VALUE_PER_CAPITA;
    const propertyBaseline =
      existingBudget?.propertyValueBaseline ?? DEFAULT_PROPERTY_VALUE_PER_CAPITA;
    const commercialBaseline =
      existingBudget?.commercialValueBaseline ?? DEFAULT_COMMERCIAL_VALUE_PER_CAPITA;
    const chancellorAllocation = allocationPercents
      ? ((allocationPercents[region._id] ?? 100 / UK_REGION_COUNT) / 100) *
        (westminsterGrantPerCapita * nationalPopulation)
      : null;

    // b. Calculate total budget
    const budgetResult = calculateRegionalBudget({
      councilTaxRate,
      businessRate,
      propertyValuePerCapita,
      commercialValuePerCapita,
      regionPopulation: region.population,
      westminsterGrantPerCapita,
      nationalPopulation,
      chancellorAllocation,
    });

    // c. Sum all enacted regional spending (excluding tax types)
    const spendingPolicies = regionPolicies.filter((p) => !TAX_TYPE_IDS.has(p.legislationTypeId));
    let enactedBillCosts = 0;
    for (const policy of spendingPolicies) {
      enactedBillCosts += enactedRegionalPolicyCost(policy, legTypeMap, region);
    }
    // Subsidy costs must be folded into the regional phase itself because the
    // dedicated subsidy-budget phase runs in parallel and cannot safely patch
    // `regionalBudgets` after this document is written.
    const subsidyCosts = stateCostByStateId.get(region._id) ?? 0;
    enactedBillCosts += subsidyCosts;

    // d. Determine surplus/deficit
    const surplus = budgetResult.totalBudget - enactedBillCosts;
    const isOverBudget = surplus < 0;
    const previousTurnsOver = existingBudget?.turnsOverBudget ?? 0;
    const turnsOverBudget = isOverBudget ? previousTurnsOver + 1 : 0;

    // e. Forced austerity: if over budget for more than 1 turn, downgrade most expensive programme
    if (turnsOverBudget > 1 && spendingPolicies.length > 0) {
      // Sort by cost descending to find the most expensive enacted programme
      // (region-total cost so v2 and legacy laws compare on the same basis).
      const policiesWithCost = spendingPolicies.map((p) => ({
        policy: p,
        cost: enactedRegionalPolicyCost(p, legTypeMap, region),
      }));
      policiesWithCost.sort((a, b) => b.cost - a.cost);

      const mostExpensive = policiesWithCost[0];
      if (mostExpensive && mostExpensive.cost > 0) {
        const legType = legTypeMap.get(mostExpensive.policy.legislationTypeId);
        if (legType?.policyOptions) {
          const currentIndex = legType.policyOptions.findIndex(
            (o) => o.id === mostExpensive.policy.policyOptionId
          );
          // Downgrade one tier (lower index = cheaper option in our spending types)
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

    // f. Drift property and commercial value bases
    const targetMultiplier = computeSpendingMultiplier(spendingPolicies, legTypeMap);
    const newPropertyValue = driftValueBase(
      propertyValuePerCapita,
      propertyBaseline,
      targetMultiplier,
      isOverBudget
    );
    const newCommercialValue = driftValueBase(
      commercialValuePerCapita,
      commercialBaseline,
      targetMultiplier,
      isOverBudget
    );

    // g. Upsert the RegionalBudget document
    const budgetDoc: RegionalBudget = {
      _id: region._id,
      countryId: "UK",
      turn: turnNumber,
      councilTaxRevenue: budgetResult.councilTaxRevenue,
      businessRatesRevenue: budgetResult.businessRatesRevenue,
      westminsterGrant: budgetResult.westminsterGrant,
      totalBudget: budgetResult.totalBudget,
      enactedBillCosts,
      subsidyCosts,
      surplus,
      isOverBudget,
      turnsOverBudget,
      propertyValuePerCapita: newPropertyValue,
      commercialValuePerCapita: newCommercialValue,
      propertyValueBaseline: propertyBaseline,
      commercialValueBaseline: commercialBaseline,
      chancellorAllocation,
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
