/**
 * Regional budget constraint system for UK regions.
 *
 * Runs every turn as part of the effects & metrics group. Calculates each UK
 * region's budget from council tax, business rates, and the Westminster grant,
 * then compares against enacted spending. Regions in deficit for more than one
 * turn trigger forced austerity (most expensive programme downgraded one tier).
 *
 * **Revenue is derived from the region's own economy and the national grant
 * pool — never from a `legislationTypes` lookup.** The political-legislation
 * v2 preset unseeds every legacy `countryScope: "uk"` type (see
 * `seedLegislationTypes`), so the previous model — council tax rate read off
 * an enacted `uk_council_tax` policy, Westminster grant off a national
 * `uk_local_government_funding` policy — resolved to a silent 0 on every v2
 * world while the COST half kept pricing through the v2 catalog. That
 * asymmetry left all 12 UK regions with £0 revenue against real enacted costs,
 * pinning them in permanent deficit and firing forced austerity every turn.
 * RU/DE/CN/JP regional budgets already derive from the national budget; this
 * brings UK onto the same footing.
 *
 * The per-capita value bases that model replaced were also modern-calibrated
 * (a flat £120,000/head) with no era awareness: on the 1953 preset they billed
 * London £18.8B of council tax against a £17.5B *national* GDP. Anchoring to
 * live regional GDP is era-proof by construction.
 *
 * Pure calculation helpers are exported separately for testability.
 */

import type { AnyBulkWriteOperation } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import { loadAnnualSubsidyCostMaps } from "@/lib/subsidies/subsidyBudgetCosts";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";

// ── Pure calculation types ───────────────────────────────────────────────────

export interface BudgetCalculationInput {
  /** Region GDP in absolute local currency (states.gdp × 1e6). */
  regionGdp: number;
  /**
   * Drifted residential value base as a multiple of its baseline (1.0 = at
   * baseline). Carries the austerity feedback loop: a region that lets its
   * services decay erodes its own tax base, and collects less next turn.
   */
  propertyValueIndex: number;
  /** Drifted commercial value base as a multiple of its baseline. */
  commercialValueIndex: number;
  regionPopulation: number;
  nationalPopulation: number;
  /** National grant pool available to regions, absolute local currency. */
  grantPool: number;
  /** Chancellor's explicit allocation; null = population-proportional share. */
  chancellorAllocation: number | null;
}

export interface BudgetCalculationResult {
  councilTaxRevenue: number;
  businessRatesRevenue: number;
  westminsterGrant: number;
  totalBudget: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Fallback share, as a percentage, for a region the Chancellor's allocation map
 * omits (100/12 ≈ 8.33%). With NO allocation map at all the grant is split
 * population-proportionally instead, so this is not an even-split constant.
 */
const UK_REGION_COUNT = 12;

/** `states.gdp` is stored in millions of local currency; costs and revenue are absolute. */
const GDP_MILLIONS = 1_000_000;

/** Default property value per capita used when no budget doc exists yet. */
const DEFAULT_PROPERTY_VALUE_PER_CAPITA = 120_000;

/** Default commercial value per capita used when no budget doc exists yet. */
const DEFAULT_COMMERCIAL_VALUE_PER_CAPITA = 45_000;

/**
 * Domestic rates (council tax) as a share of regional GDP, at an unchanged
 * value base. Calibrated on post-war UK local-authority accounts, where
 * domestic rates ran ≈1.6% of GDP. The statutory-share form mirrors how DE
 * (42.5% income-tax share / 46.5% VAT share) and CN (40% EIT share) derive
 * regional revenue: an authored constant, not a per-region enacted rate.
 */
export const COUNCIL_TAX_GDP_SHARE = 0.016;

/**
 * Non-domestic rates (business rates) as a share of regional GDP, at an
 * unchanged value base. Commercial property yields less than the residential
 * base in the same period, hence ≈1.0% against council tax's 1.6%.
 */
export const BUSINESS_RATES_GDP_SHARE = 0.01;

// Tax legislation type IDs
const COUNCIL_TAX_TYPE_ID = "uk_council_tax";
const BUSINESS_RATES_TYPE_ID = "uk_business_rates";

/** Tax type IDs excluded from spending calculations (they generate revenue, not spend). */
const TAX_TYPE_IDS = new Set([COUNCIL_TAX_TYPE_ID, BUSINESS_RATES_TYPE_ID]);

// ── Pure functions ───────────────────────────────────────────────────────────

/**
 * Calculate a region's total budget from its three revenue sources.
 *
 * Council tax and business rates are statutory shares of the region's own GDP,
 * scaled by its drifted value indices. The Westminster grant either uses a
 * chancellor-set allocation or a population-proportional share of the national
 * grant pool.
 */
export function calculateRegionalBudget(input: BudgetCalculationInput): BudgetCalculationResult {
  const councilTaxRevenue = input.regionGdp * COUNCIL_TAX_GDP_SHARE * input.propertyValueIndex;
  const businessRatesRevenue =
    input.regionGdp * BUSINESS_RATES_GDP_SHARE * input.commercialValueIndex;
  const westminsterGrant =
    input.chancellorAllocation ??
    (input.nationalPopulation > 0
      ? (input.grantPool * input.regionPopulation) / input.nationalPopulation
      : 0);
  const totalBudget = councilTaxRevenue + businessRatesRevenue + westminsterGrant;

  return { councilTaxRevenue, businessRatesRevenue, westminsterGrant, totalBudget };
}

/**
 * A drifted value base as a multiple of its baseline. Guards a zero/absent
 * baseline (legacy docs) by reporting "at baseline" rather than dividing by
 * zero — a NaN here would silently zero the region's whole tax take.
 */
function valueIndex(current: number, baseline: number): number {
  if (!(baseline > 0)) return 1;
  return current / baseline;
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
      { gdp: (region.gdp ?? 0) * GDP_MILLIONS, population: region.population ?? 0 },
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

  // 3. Fetch relevant legislation types for legacy option lookups. Only the
  //    COST half still consults these (v2 laws price through the catalog), so
  //    a missing type can no longer zero a region's revenue.
  const allLegTypeIds = [...new Set(allRegionalPolicies.map((p) => p.legislationTypeId))];

  const legTypes = await db
    // full-read(legislationTypes): policyOptions tables price every state law
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: allLegTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  // 4. The Westminster grant pool comes from the national budget's state-grants
  //    line — the enacted figure when there is one, else the authored era
  //    baseline. Live UK carries stateGrants = 0 with baselineStateGrants =
  //    £250M, so reading only the enacted line would unfund every region.
  const nationalBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne(
      { _id: getNationalBudgetId("UK") },
      { projection: { spending: 1, baselineStateGrants: 1 } }
    );
  const grantPool =
    nationalBudget?.spending?.stateGrants || nationalBudget?.baselineStateGrants || 0;

  // Total UK population for the grant's population-proportional split
  const nationalPopulation = ukRegions.reduce((sum, r) => sum + r.population, 0);

  // Group regional policies by stateId for efficient lookup
  const policiesByRegion = new Map<string, StatePolicy[]>();
  for (const policy of allRegionalPolicies) {
    const existing = policiesByRegion.get(policy.stateId) ?? [];
    existing.push(policy);
    policiesByRegion.set(policy.stateId, existing);
  }

  // 5. Fetch existing budget documents for all regions
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

    // a. Use existing value bases or defaults. These are no longer a currency
    //    amount in the revenue formula — only their ratio to baseline is read,
    //    so the drift feedback loop survives the switch to GDP anchoring.
    const propertyValuePerCapita =
      existingBudget?.propertyValuePerCapita ?? DEFAULT_PROPERTY_VALUE_PER_CAPITA;
    const commercialValuePerCapita =
      existingBudget?.commercialValuePerCapita ?? DEFAULT_COMMERCIAL_VALUE_PER_CAPITA;
    const propertyBaseline =
      existingBudget?.propertyValueBaseline ?? DEFAULT_PROPERTY_VALUE_PER_CAPITA;
    const commercialBaseline =
      existingBudget?.commercialValueBaseline ?? DEFAULT_COMMERCIAL_VALUE_PER_CAPITA;
    const chancellorAllocation = allocationPercents
      ? ((allocationPercents[region._id] ?? 100 / UK_REGION_COUNT) / 100) * grantPool
      : null;

    // b. Calculate total budget
    const budgetResult = calculateRegionalBudget({
      regionGdp: (region.gdp ?? 0) * GDP_MILLIONS,
      propertyValueIndex: valueIndex(propertyValuePerCapita, propertyBaseline),
      commercialValueIndex: valueIndex(commercialValuePerCapita, commercialBaseline),
      regionPopulation: region.population,
      nationalPopulation,
      grantPool,
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
