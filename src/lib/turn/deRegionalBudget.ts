/**
 * DE regional budget constraint system for Bundesländer.
 *
 * Runs every turn alongside UK and JP budget processing. Each Land's revenue
 * comes from three sources mirroring German fiscal federalism:
 *
 *   1. Income Tax Share (Einkommensteueranteil): 42.5% of federal income tax
 *      collected in-territory, scaled by the enacted de_income_tax_rate.
 *   2. VAT Share (Umsatzsteueranteil): 46.5% of VAT revenue distributed by
 *      population, scaled by the enacted de_vat_rate.
 *   3. Federal Equalization Grant (BEZ): Finance Minister allocation or an
 *      equal per-capita split of the grant pool.
 *
 * Revenues are compared against enacted Bundestag spending costs. Lands in
 * deficit for more than one turn trigger forced austerity (most expensive
 * programme downgraded one tier), matching UK and JP behaviour.
 */

import type { Db } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import type { State, StateMetrics } from "@/lib/db/types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types/legislation";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import { loadAnnualSubsidyCostMaps } from "@/lib/subsidies/subsidyBudgetCosts";
import { getCountryConfig } from "@/lib/constants/countries";

// ── Constants ────────────────────────────────────────────────────────────────

const DE_REGION_COUNT = 16;

// German Länder collectively receive 42.5% of federal income tax
const LAENDER_INCOME_TAX_SHARE = 0.425;

// Average ratio of top marginal rate vs effective rate paid by a typical earner
const INCOME_TAX_EFFECTIVE_RATE = 0.6;

// German Länder collectively receive 46.5% of federal VAT revenue, split by population
const LAENDER_VAT_SHARE = 0.465;

// Private consumption as a share of GDP (German long-run average)
const CONSUMPTION_TO_GDP_RATIO = 0.55;

// Legislation type IDs used for revenue calculation (national-scope policies)
const INCOME_TAX_TYPE_ID = "de_income_tax_rate";
const VAT_TYPE_ID = "de_vat_rate";
// Per-Land trade tax (Gewerbesteuer-Hebesatz) — set at Land level via `de_trade_tax`
const TRADE_TAX_TYPE_ID = "de_trade_tax";

// Gewerbesteuer Steuermesszahl (federally fixed; municipalities pick the Hebesatz multiplier).
// Effective rate = STEUERMESSZAHL × (Hebesatz / 100).
const STEUERMESSZAHL = 0.035;
// Domestic corporate profits as a share of GDP — anchors the Gewerbesteuer base when no
// per-Land corporate-profit metric is available. Mirrors GDP_DOMESTIC_CORPORATE_FACTOR
// from src/lib/budget/revenue.ts (0.06).
const GDP_DOMESTIC_CORPORATE_FACTOR = 0.06;
// Statutory baseline Hebesatz when no `de_trade_tax` policy is set for a Land.
const DEFAULT_HEBESATZ = 400;

// Fallback median income per capita when stateMetrics is unavailable (EUR)
const DEFAULT_MEDIAN_INCOME = 35_000;

// Fallback GDP per capita when state data is unavailable (EUR)
const DEFAULT_GDP_PER_CAPITA = 45_000;

// Default federal equalization grant pool per capita (EUR/year) when no Finance Minister set
const DEFAULT_FEDERAL_GRANT_PER_CAPITA = 500;

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

// ── Pure calculation ─────────────────────────────────────────────────────────

export interface DEBudgetInput {
  incomeTaxRate: number; // top marginal rate (e.g. 42 for 42%)
  vatRate: number; // standard VAT rate (e.g. 19 for 19%)
  /** Gewerbesteuer-Hebesatz for this Land (e.g. 400 means 400% multiplier on the 3.5% Steuermesszahl) */
  tradeTaxHebesatz: number;
  medianIncome: number; // EUR per capita
  gdpPerCapita: number; // EUR per capita
  regionPopulation: number;
  nationalPopulation: number;
  ministerAllocation: number | null; // null = even per-capita split
  /**
   * Number of Länder actually seeded for this era (16 for modern DE; 11 for
   * the 1953 preset — Baden-Württemberg's 1952 merger but before Saarland
   * joined in 1957). Defaults to `DE_REGION_COUNT` (16) so existing callers
   * that omit it (tests, and any future caller) see unchanged behavior.
   * Passing the true count matters here because the even per-capita split
   * below divides the national pool by this figure — a stale 16 against 11
   * actually-seeded regions only distributes 11/16 of the intended pool
   * (fiscal-scale audit, 2026-07-28).
   */
  regionCount?: number;
  /**
   * Federal equalization pool, EUR (or era-local-currency) per capita.
   * Defaults to `DEFAULT_FEDERAL_GRANT_PER_CAPITA` (500) so existing callers
   * that omit it are unaffected. Era-aware callers should pass
   * `getCountryConfig("DE", preset).federalEqualizationGrantPerCapita`.
   */
  grantPerCapita?: number;
}

export interface DEBudgetResult {
  incomeTaxShare: number;
  vatShare: number;
  federalEqualizationGrant: number;
  tradeTaxRevenue: number;
  totalBudget: number;
}

/**
 * Calculate a Land's total budget from its four revenue sources.
 *
 * Income tax and VAT scale with enacted national rates and the Land's economic
 * base. Gewerbesteuer scales with the per-Land Hebesatz and the Steuermesszahl,
 * applied to a domestic-corporate-profits base derived from Land GDP. The
 * federal equalization grant uses the Finance Minister allocation when set,
 * or defaults to an equal per-capita share of the national pool.
 */
export function calculateDERegionalBudget(input: DEBudgetInput): DEBudgetResult {
  const incomeTaxShare =
    input.regionPopulation *
    input.medianIncome *
    (input.incomeTaxRate / 100) *
    INCOME_TAX_EFFECTIVE_RATE *
    LAENDER_INCOME_TAX_SHARE;

  const vatShare =
    input.regionPopulation *
    input.gdpPerCapita *
    CONSUMPTION_TO_GDP_RATIO *
    (input.vatRate / 100) *
    LAENDER_VAT_SHARE;

  // Gewerbesteuer — Land-level revenue, paid by corporations operating in the Land.
  // Base ≈ Land GDP × domestic-corporate-profit share. Effective rate = Steuermesszahl × Hebesatz/100.
  const tradeTaxRevenue =
    input.regionPopulation *
    input.gdpPerCapita *
    GDP_DOMESTIC_CORPORATE_FACTOR *
    STEUERMESSZAHL *
    (input.tradeTaxHebesatz / 100);

  const regionCount = input.regionCount ?? DE_REGION_COUNT;
  const grantPerCapita = input.grantPerCapita ?? DEFAULT_FEDERAL_GRANT_PER_CAPITA;
  const federalEqualizationGrant =
    input.ministerAllocation ?? (grantPerCapita * input.nationalPopulation) / regionCount;

  const totalBudget = incomeTaxShare + vatShare + tradeTaxRevenue + federalEqualizationGrant;

  return {
    incomeTaxShare,
    vatShare,
    federalEqualizationGrant,
    tradeTaxRevenue,
    totalBudget,
  };
}

// ── Turn processing ──────────────────────────────────────────────────────────

/**
 * Main turn processing function for DE Länder budgets.
 *
 * Called once per turn. Fetches all DE Länder, calculates budgets from enacted
 * income-tax and VAT legislation, detects deficits, applies forced austerity
 * when needed, and upserts RegionalBudget documents.
 */
export async function processDERegionalBudgets(
  db: Db,
  turnNumber: number,
  preset?: string
): Promise<{ regionsProcessed: number }> {
  const deRegions = await db.collection<State>("states").find({ countryId: "DE" }).toArray();
  if (deRegions.length === 0) return { regionsProcessed: 0 };

  // `preset` threaded through so era-specific knobs (the 1953-scaled
  // `federalEqualizationGrantPerCapita` in ERA_COUNTRY_CONFIG_OVERRIDES) apply —
  // without it every era shares the modern-EUR-calibrated constant, which is
  // ~5x too large against the 1953 DE budget (fiscal-scale audit, 2026-07-28).
  // `deRegions.length` (not the hardcoded DE_REGION_COUNT=16) is also used
  // below so the equal-split pool matches whatever count is actually seeded —
  // 1953 DE has 11 Länder (deRegions1953: pre-Saarland, post-Baden-Württemberg
  // merger), not 16.
  const grantPerCapita =
    getCountryConfig("DE", preset).federalEqualizationGrantPerCapita ??
    DEFAULT_FEDERAL_GRANT_PER_CAPITA;

  const { stateCostByStateId } = await loadAnnualSubsidyCostMaps(db);

  const regionIds = deRegions.map((r) => r._id as string);

  // Fetch all enacted DE regional policies (for spending calculation)
  const allRegionalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: { $in: regionIds } })
    .toArray();

  // Fetch DE national policies (for income tax rate and VAT rate)
  const nationalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: "de_national" })
    .toArray();

  // Fetch relevant legislation types
  const regionalLegTypeIds = new Set(allRegionalPolicies.map((p) => p.legislationTypeId));
  const nationalLegTypeIds = new Set(nationalPolicies.map((p) => p.legislationTypeId));
  const allLegTypeIds = [...new Set([...regionalLegTypeIds, ...nationalLegTypeIds])];

  const legTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: allLegTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  // Read national income tax and VAT rates from enacted legislation
  const incomeTaxPolicy = nationalPolicies.find((p) => p.legislationTypeId === INCOME_TAX_TYPE_ID);
  const vatPolicy = nationalPolicies.find((p) => p.legislationTypeId === VAT_TYPE_ID);

  const incomeTaxRate = getTaxRateFromPolicy(incomeTaxPolicy, legTypeMap);
  const vatRate = getTaxRateFromPolicy(vatPolicy, legTypeMap);

  const nationalPopulation = deRegions.reduce((sum, r) => sum + r.population, 0);

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

  // Fetch median income per region (SP5: economic.* lives on macroMetrics)
  const stateMetrics = await db
    .collection<StateMetrics>("macroMetrics")
    .find({ _id: { $in: regionIds } })
    .toArray();
  const metricsMap = new Map(stateMetrics.map((m) => [m._id, m]));

  // Read Finance Minister allocation (controls federal equalization distribution)
  const ministerSetting = await db
    .collection<CabinetSetting>("cabinetSettings")
    .findOne({ _id: "DE_finance_minister" });
  const allocationPercents = ministerSetting?.allocationPercents ?? null;

  let regionsProcessed = 0;
  // Batched per-region writes (see regionalBudget.ts for rationale).
  const statePolicyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
  const regionalBudgetOps: AnyBulkWriteOperation<RegionalBudget>[] = [];

  for (const region of deRegions) {
    const regionPolicies = policiesByRegion.get(region._id) ?? [];
    const existingBudget = budgetMap.get(region._id);

    const regionMetrics = metricsMap.get(region._id);
    const medianIncome = regionMetrics?.economic?.medianIncome?.value ?? DEFAULT_MEDIAN_INCOME;

    // Derive GDP per capita from state data; fall back to national default
    const gdpPerCapita =
      region.gdp && region.population > 0
        ? (region.gdp * 1_000_000) / region.population
        : DEFAULT_GDP_PER_CAPITA;

    // Per-Land Gewerbesteuer-Hebesatz — defaults to statutory 400% if no `de_trade_tax`
    // policy is enacted for this Land.
    const tradeTaxPolicy = regionPolicies.find((p) => p.legislationTypeId === TRADE_TAX_TYPE_ID);
    const tradeTaxHebesatz = getTaxRateFromPolicy(tradeTaxPolicy, legTypeMap) || DEFAULT_HEBESATZ;

    const ministerAllocation = allocationPercents
      ? ((allocationPercents[region._id] ?? 100 / deRegions.length) / 100) *
        (grantPerCapita * nationalPopulation)
      : null;

    const budgetResult = calculateDERegionalBudget({
      incomeTaxRate,
      vatRate,
      tradeTaxHebesatz,
      medianIncome,
      gdpPerCapita,
      regionPopulation: region.population,
      nationalPopulation,
      ministerAllocation,
      regionCount: deRegions.length,
      grantPerCapita,
    });

    // Sum all enacted regional spending costs (no DE-specific tax exclusions yet)
    const spendingPolicies = regionPolicies;
    let enactedBillCosts = 0;
    for (const policy of spendingPolicies) {
      const costPerCapita = getOptionCostPerCapita(policy, legTypeMap);
      enactedBillCosts += costPerCapita * region.population;
    }
    // DE regional budgets need the subsidy line in the same write path because
    // the generic subsidy phase cannot win a parallel write race against this one.
    const subsidyCosts = stateCostByStateId.get(region._id) ?? 0;
    enactedBillCosts += subsidyCosts;

    const surplus = budgetResult.totalBudget - enactedBillCosts;
    const isOverBudget = surplus < 0;
    const previousTurnsOver = existingBudget?.turnsOverBudget ?? 0;
    const turnsOverBudget = isOverBudget ? previousTurnsOver + 1 : 0;

    // Forced austerity: downgrade the most expensive enacted programme after 1 consecutive deficit turn
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

    const budgetDoc: RegionalBudget = {
      _id: region._id,
      countryId: "DE",
      turn: turnNumber,
      // UK fields zeroed for DE regions
      councilTaxRevenue: 0,
      businessRatesRevenue: 0,
      westminsterGrant: 0,
      // DE-specific revenue
      incomeTaxShare: budgetResult.incomeTaxShare,
      vatShare: budgetResult.vatShare,
      federalEqualizationGrant: budgetResult.federalEqualizationGrant,
      tradeTaxRevenue: budgetResult.tradeTaxRevenue,
      totalBudget: budgetResult.totalBudget,
      enactedBillCosts,
      subsidyCosts,
      surplus,
      isOverBudget,
      turnsOverBudget,
      // DE does not use property/commercial value drift (no council tax equivalent)
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
