/**
 * Federal / state revenue projections.
 *
 * **Currency (v0.2.6):** Every calculation in this file stays within a single country
 * and produces values in that country's currency. `taxBases` (see `budget.ts`) are
 * normalized to country currency during the corp-turn phase, and `taxRate%` is a
 * dimensionless percentage, so `taxRate × taxBase / 100` inherits country currency.
 * GDP-fallback formulas use `budget.gdp`, which is already country-local. No FX
 * conversion is performed here.
 */
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type {
  EnactedLaw,
  FederalBudget,
  StateBudget,
  FederalTaxRates,
  FederalTaxBases,
  StateTaxRates,
  StateTaxBases,
  EconomicGrowthFactors,
} from "@/lib/db/types/budget";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { State } from "@/lib/db/types/state";
import {
  calculateCountryOwnedBudgetRevenue,
  loadPlantsBudgetContext,
  type PlantsBudgetContext,
} from "./publicEnterpriseRevenue";
import { calculateFederalSpending } from "./spending";
import { keepLatestActiveLawPerType } from "./keepLatestActiveLawPerType";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { getEraContext, type EraContext } from "@/lib/era/context";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";
import { getCurrentTurn } from "@/lib/currentTurn";
import type { GameConfig } from "@/lib/db/types/gameConfig";

/**
 * Spec B revenue ceiling (flag-on only). A Laffer soft-cap: tax take above ~40%
 * of GDP is compressed (base erosion at punitive aggregate rates), so even maxing
 * every lever tops out near ~47% of GDP — below the max-everything spend, keeping
 * "max legislation" structurally unaffordable. Null year (flag off) ⇒ unchanged.
 */
const REVENUE_CAP_KNEE = 0.4;
const REVENUE_CAP_COMPRESS = 0.4;

/**
 * Per-country knee override for 1953 Stalinist command economies (BG/CS/HU/
 * PL/RO/YU — the `makeEasternBlocBudget1953` factory in seeds/reference/
 * budgets.ts). The 40%-of-GDP knee above is calibrated for modern mixed
 * economies where >40% GDP tax take is already a Laffer-curve extreme; Soviet
 * -type fiscal budgets of this era routinely ran 45–70% of national income
 * (turnover tax + enterprise-surplus remittance the bulk — Holzman / CIA NMP
 * -to-budget series, cited alongside these countries' authored tax bases in
 * budgets.ts). Their AUTHORED day-one default (Total Surplus Remittance 70% +
 * Maximal Turnover Tax 26%, the bloc's Stalinist maximum) computes to ≈52% of
 * GDP raw — already above the generic 40% knee — so without this override the
 * cap compressed every authored default down to ~41–45%, turning the
 * countries' own documented "small planned deficit" (spending ≈54% GDP vs
 * ≈52% revenue, a ~2% gap) into a ~13% GDP deficit that was never seeded or
 * intended (fiscal-scale audit, 2026-07-28). 55% keeps the full authored
 * default AND every reachable in-game lever setting uncompressed (raw revenue
 * tops out ≈60% GDP even with every remaining lever — income tax, social
 * insurance — maxed; enterprise levy and turnover tax are already at their
 * ceiling options), while still guarding against a future added lever pushing
 * materially past the bloc's real historical range.
 */
// The union republics belong here for a stronger reason than the satellites do:
// a republican budget in the USSR ran turnover tax and enterprise profit
// deductions at all-Union rates, with revenue shares set by Moscow, so its
// revenue-to-GDP ratio sat at the top of the bloc's range by construction.
// DD was the one Warsaw Pact economy missing from this list, and nothing about
// it justified the omission: `MARKETIZATION_SCHEDULE.DD` is level 10 through
// 1990, its live `economicFactors.marketizationLevel` is 0, and its
// `stateOwnershipConcentration` is 100 across 52 state-owned enterprises. It was
// therefore compressed against the 40% MARKET knee for its whole life —
// ₸22.7B clawed back in fy1963 and ₸27.6B in fy1964 while East Germany, then
// ₸51.8B/yr once it became the unified Germany (#1323). Reunification does not
// change the classification: the surviving state is still centrally planned, so
// it belongs on the same knee as the bloc it never left.
const COMMAND_ECONOMY_REVENUE_CAP_COUNTRIES = new Set([
  "BG",
  "CS",
  "DD",
  "HU",
  "PL",
  "RO",
  "YU",
  "UKR",
  "BLR",
  "BAL",
]);
const COMMAND_ECONOMY_REVENUE_CAP_KNEE = 0.55;

export function applyEraRevenueCap(
  rawTotal: number,
  gdp: number | undefined,
  eraYear: number | null,
  countryId?: string
): number {
  if (eraYear == null || !gdp || gdp <= 0) return rawTotal;
  const knee =
    countryId && COMMAND_ECONOMY_REVENUE_CAP_COUNTRIES.has(countryId.toUpperCase())
      ? COMMAND_ECONOMY_REVENUE_CAP_KNEE
      : REVENUE_CAP_KNEE;
  const share = rawTotal / gdp;
  if (share <= knee) return rawTotal;
  return (knee + (share - knee) * REVENUE_CAP_COMPRESS) * gdp;
}

type LegacyFederalTaxRates = Partial<FederalTaxRates> & {
  corporateTax?: number;
};

function coerceRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeFederalTaxRates(
  taxRates: LegacyFederalTaxRates | null | undefined
): FederalTaxRates | null {
  if (!taxRates) return null;

  const corporateFallback = coerceRate(taxRates.corporateTax) ?? 0;

  return {
    incomeTax: coerceRate(taxRates.incomeTax) ?? 0,
    domesticCorporateTax: coerceRate(taxRates.domesticCorporateTax) ?? corporateFallback,
    foreignCorporateTax: coerceRate(taxRates.foreignCorporateTax) ?? corporateFallback,
    payrollTax: coerceRate(taxRates.payrollTax) ?? 0,
    tariffs: coerceRate(taxRates.tariffs) ?? 0,
    salesTax: coerceRate(taxRates.salesTax) ?? 0,
    // DE-only — leave undefined for non-DE countries so revenue calc returns 0
    solidaritySurcharge: coerceRate(taxRates.solidaritySurcharge),
    // CN-only — leave undefined for non-CN countries so revenue calc returns 0
    landValueAddedTax: coerceRate(taxRates.landValueAddedTax),
    urbanMaintenanceTax: coerceRate(taxRates.urbanMaintenanceTax),
    stampDuty: coerceRate(taxRates.stampDuty),
    // IE-only — leave undefined for non-IE countries so revenue calc returns 0
    universalSocialCharge: coerceRate(taxRates.universalSocialCharge),
    capitalGainsTax: coerceRate(taxRates.capitalGainsTax),
    exciseDuty: coerceRate(taxRates.exciseDuty),
    propertyTax: coerceRate(taxRates.propertyTax),
  };
}

export function normalizeStateTaxRates(
  taxRates: Partial<StateTaxRates> | null | undefined
): StateTaxRates | null {
  if (!taxRates) return null;

  return {
    incomeTax: coerceRate(taxRates.incomeTax) ?? 0,
    salesTax: coerceRate(taxRates.salesTax) ?? 0,
    domesticCorporateTax: coerceRate(taxRates.domesticCorporateTax) ?? 0,
    foreignCorporateTax: coerceRate(taxRates.foreignCorporateTax) ?? 0,
    propertyTax: coerceRate(taxRates.propertyTax) ?? 0,
    // DE-only Gewerbesteuer-Hebesatz — undefined for non-DE Länder
    tradeTax: coerceRate(taxRates.tradeTax),
  };
}

// Fallback GDP factors if tax bases aren't set
const GDP_INCOME_TAX_FACTOR = 0.35; // 35% of GDP is taxable income
// Corporate profits ≈ 8% of GDP. Anchored roughly to US FDI income share at ~2% of GDP
// (foreign corps operating here) with the remaining ~6% attributed to domestic corps.
// Consumed only when taxBases are absent from the budget doc — bootstrap only.
export const GDP_DOMESTIC_CORPORATE_FACTOR = 0.06;
export const GDP_FOREIGN_CORPORATE_FACTOR = 0.02;
const GDP_PAYROLL_FACTOR = 0.31; // 31% of GDP is wages
const GDP_SALES_FACTOR = 0.55; // 55% of GDP is consumer spending
const GDP_IMPORT_FACTOR = 0.18; // 18% of GDP is imports
const GDP_PROPERTY_FACTOR = 3.0; // Property value ~3x GDP

/**
 * Money wiring (interstate-logistics plan step 5, phase B). Loads the latest
 * `sourcingNetworkLoad` doc at or before `upToTurn` and returns its
 * `importAggregates`, keyed by buyer countryId, unconverted (anchor currency,
 * one turn's worth). Callers hoist this ONCE per turn/fiscal-year pass and
 * read per-country entries out of the returned map, matching the
 * `landedPremiumByState` hoist pattern in `buildCorporationLookups`.
 */
export async function loadLatestSourcedImportAggregates(
  db: Db,
  upToTurn: number
): Promise<Map<string, { tariffPaid: number; importValue: number }>> {
  const docs = await db
    .collection<SourcingNetworkDoc>("sourcingNetworkLoad")
    .find({ turn: { $lte: upToTurn } })
    .sort({ turn: -1 })
    .limit(1)
    .toArray();
  const doc = docs[0];
  const result = new Map<string, { tariffPaid: number; importValue: number }>();
  if (!doc?.importAggregates) return result;
  for (const [countryId, agg] of Object.entries(doc.importAggregates)) {
    result.set(countryId, agg);
  }
  return result;
}

export async function calculateNationalGDP(db: Db, budgetId: string = "federal"): Promise<number> {
  // A1 SSOT (design §5.4): national GDP = Σ regional `state.gdp` — the per-turn
  // grown truth (the metric engine compounds each region's level every turn).
  // `state.gdp` is stored in MILLIONS; the national figure is in full units.
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  const countryId = budget?.countryId ?? (budgetId === "federal" ? "US" : budgetId);

  // Scope the query to this country up front — the previous global
  // `find({})` loaded every state across every country and filtered in JS,
  // a full-collection scan that only grows with more countries (dormant
  // today since all federalBudget docs carry taxBases so this GDP-fallback
  // path rarely fires, but a real scan when it does). NATIONAL_SCOPE_IDS
  // synthetic docs are still excluded in JS since they'd double-count.
  const states = await db
    .collection<State>("states")
    .find({ countryId: countryId as State["countryId"] })
    .toArray();
  const totalFromStates = states
    .filter((s) => !NATIONAL_SCOPE_IDS.has(s._id))
    .reduce((sum, s) => sum + (s.gdp || 0), 0);
  if (totalFromStates > 0) {
    return totalFromStates * 1_000_000;
  }

  // Fallbacks: a stale federalBudget.gdp (pre-reconciliation), then the constant.
  if (budget?.gdp && budget.gdp > 0) {
    return budget.gdp;
  }
  return 27_000_000_000_000; // $27T fallback
}

/**
 * Calculate federal revenue using stored tax bases and rates.
 * Revenue = TaxBase × TaxRate for each tax type.
 */
export async function calculateFederalRevenue(
  db: Db,
  taxRates: LegacyFederalTaxRates | null | undefined,
  budgetId: string = "federal",
  // Optional pre-fetched budget doc. Callers that already hold the doc (e.g.
  // refreshNationalBudgetRevenue's per-budget loop) pass it to skip a
  // redundant findOne — one saved round-trip per budget, which matters once
  // this runs per-country every turn across 30-50 countries. Only used when
  // its _id matches budgetId; otherwise the findOne fallback still runs.
  prefetchedBudget?: FederalBudget | null,
  // Plants-tier market context, hoisted by refreshNationalBudgetRevenue so the
  // market-mode + governor-ramp reads happen ONCE per turn rather than once per
  // country. Omitted ⇒ publicEnterpriseRevenue resolves it itself.
  plantsContext?: PlantsBudgetContext,
  // Era context and FX map, hoisted the same way. Omitted ⇒ resolved inline.
  hoistedEraContext?: EraContext,
  hoistedFxByCurrency?: ReadonlyMap<CurrencyCode, number>,
  // Money wiring (interstate-logistics plan step 5, phase B): this turn's
  // sourcing-pass import aggregate for this budget's country, anchor
  // currency, ONE TURN's worth (straight off `SourcingNetworkDoc.
  // importAggregates[countryId]` - see `loadLatestSourcedImportAggregates`).
  // Undefined ⇒ byte-identical to pre-wiring behavior (GDP-proxy tariffs
  // only). When provided, tariffs are netted against the GDP proxy so the
  // real sourced flow isn't double counted (the sourced imports are already
  // inside `bases.importValue`'s GDP estimate) - see the netting block below.
  sourcedImports?: { tariffPaidAnchor: number; importValueAnchor: number }
): Promise<FederalBudget["revenue"]> {
  const normalizedTaxRates = normalizeFederalTaxRates(taxRates) ?? {
    incomeTax: 0,
    domesticCorporateTax: 0,
    foreignCorporateTax: 0,
    payrollTax: 0,
    tariffs: 0,
    salesTax: 0,
    // IE-specific (default-zero for missing taxRates)
    universalSocialCharge: 0,
    capitalGainsTax: 0,
    exciseDuty: 0,
    propertyTax: 0,
  };

  // Get the current federal budget to read tax bases
  const federalBudget =
    prefetchedBudget && prefetchedBudget._id === budgetId
      ? prefetchedBudget
      : await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });

  // Spec B revenue ceiling: non-null year (flag on) ⇒ Laffer soft-cap on the total.
  // Defensive: a mock db without a gameState collection ⇒ flag off (legacy).
  let eraYear: number | null = null;
  try {
    eraYear = (hoistedEraContext ?? (await getEraContext(db))).year;
  } catch {
    eraYear = null;
  }

  // Use stored tax bases if available, otherwise derive from GDP
  let bases: FederalTaxBases;
  if (federalBudget?.taxBases) {
    bases = federalBudget.taxBases;
  } else {
    // Fallback: derive bases from GDP
    const nationalGDP = await calculateNationalGDP(db);
    bases = {
      taxableIncome: nationalGDP * GDP_INCOME_TAX_FACTOR,
      domesticCorporateProfits: nationalGDP * GDP_DOMESTIC_CORPORATE_FACTOR,
      foreignCorporateProfits: nationalGDP * GDP_FOREIGN_CORPORATE_FACTOR,
      wagesAndSalaries: nationalGDP * GDP_PAYROLL_FACTOR,
      importValue: nationalGDP * GDP_IMPORT_FACTOR,
      taxableSales: nationalGDP * GDP_SALES_FACTOR,
    };
  }

  // Resolved once, up front, so both the tariffs netting below and the
  // original mid-function computation (further down) use the same id.
  const netTariffCountryId = (federalBudget?.countryId ??
    (budgetId in COUNTRY_CONFIGS ? (budgetId as CountryId) : COUNTRY_CONFIGS.US.id)) as CountryId;

  // Calculate revenue from bases × rates
  const incomeTax = bases.taxableIncome * (normalizedTaxRates.incomeTax / 100);
  const domesticCorporateTax =
    bases.domesticCorporateProfits * (normalizedTaxRates.domesticCorporateTax / 100);
  const foreignCorporateTax =
    bases.foreignCorporateProfits * (normalizedTaxRates.foreignCorporateTax / 100);
  const payrollTax = bases.wagesAndSalaries * (normalizedTaxRates.payrollTax / 100);
  // Money wiring (phase B): with no sourced flow (flag off or a country the
  // sourcing pass hasn't touched this turn), this is byte-identical to the
  // old GDP-proxy line. With a sourced flow, we net the proxy against the
  // real (annualized, fx-converted) sourced import value before applying the
  // rate, then add the sourcing pass's own real tariff take on top - the
  // sourced units are already inside `bases.importValue`'s GDP estimate, so
  // booking the sourced tariff revenue WITHOUT netting the base would double
  // count that slice of trade. `TURNS_PER_YEAR` annualizes the one-turn
  // sourcing aggregate up to the same annual cadence `bases.importValue`
  // already carries; the fx rate converts anchor (₳) to this country's local
  // currency, matching every other amount in this file (local = anchor ×
  // rate, the convention used by `anchorToCorpCapital`).
  let tariffs: number;
  if (sourcedImports) {
    const fxCode = COUNTRY_CONFIGS[netTariffCountryId]?.currencyCode;
    const fxRate = (fxCode && hoistedFxByCurrency?.get(fxCode)) || 1.0;
    const annualizedSourcedImportValueLocal =
      sourcedImports.importValueAnchor * TURNS_PER_YEAR * fxRate;
    const annualizedSourcedTariffRevenueLocal =
      sourcedImports.tariffPaidAnchor * TURNS_PER_YEAR * fxRate;
    const nettedProxyBase = Math.max(0, bases.importValue - annualizedSourcedImportValueLocal);
    tariffs =
      nettedProxyBase * (normalizedTaxRates.tariffs / 100) + annualizedSourcedTariffRevenueLocal;
  } else {
    tariffs = bases.importValue * (normalizedTaxRates.tariffs / 100);
  }
  const salesTax = bases.taxableSales * (normalizedTaxRates.salesTax / 100);
  // DE Solidaritätszuschlag — surcharge on income tax owed. Non-DE: rate undefined → 0.
  const solidaritySurcharge = incomeTax * ((normalizedTaxRates.solidaritySurcharge ?? 0) / 100);
  // CN LVAT (土地增值税) — applied to a real-estate-sector proxy
  // (5% of domestic corporate profits, as a v1 approximation for real-estate-firm profits).
  // Non-CN: rate undefined → 0.
  const lvatBase = bases.domesticCorporateProfits * 0.05;
  const landValueAddedTax = lvatBase * ((normalizedTaxRates.landValueAddedTax ?? 0) / 100);
  // CN UMCT (城市维护建设税) — surcharge on VAT (salesTax) receipts. Non-CN: rate undefined → 0.
  const urbanMaintenanceTax = salesTax * ((normalizedTaxRates.urbanMaintenanceTax ?? 0) / 100);
  // CN Stamp Duty (印花税) — applied to a GDP-derived documented-transactions proxy (2% of GDP).
  // Non-CN: rate undefined → 0.
  const stampDutyBase = (federalBudget?.gdp ?? 0) * 0.02;
  const stampDuty = stampDutyBase * ((normalizedTaxRates.stampDuty ?? 0) / 100);
  // IE Universal Social Charge — separate levy on gross wages above thresholds.
  // Non-IE: rate undefined → 0.
  const universalSocialCharge =
    bases.wagesAndSalaries * ((normalizedTaxRates.universalSocialCharge ?? 0) / 100);
  // IE Capital Gains Tax — applied to a realised-gains proxy (3% of GDP).
  // Non-IE: rate undefined → 0.
  const capitalGainsBaseValue = (federalBudget?.gdp ?? 0) * 0.03;
  const capitalGainsTax = capitalGainsBaseValue * ((normalizedTaxRates.capitalGainsTax ?? 0) / 100);
  // IE Excise Duty — multiplier framing where 100 = calibrated baseline (1.5% of GDP).
  // Non-IE: rate undefined → 0.
  const exciseableBaseValue = (federalBudget?.gdp ?? 0) * 0.015;
  const exciseDuty = exciseableBaseValue * ((normalizedTaxRates.exciseDuty ?? 0) / 100);
  // IE Local Property Tax (LPT) — Revenue Commissioners-administered annual
  // charge. Computed against a band-averaged residential property base
  // calibrated at 0.5× GDP, so the 0.18% statutory mid-band rate yields
  // ~€500M/year (≈ real Ireland LPT receipts) on a ~€520B 2024 GDP.
  // Non-IE federal budgets: rate undefined → 0. State-level property tax is
  // handled separately in calculateStateRevenue against propertyValue.
  const propertyValueBaseValue = (federalBudget?.gdp ?? 0) * 0.5;
  const propertyTax = propertyValueBaseValue * ((normalizedTaxRates.propertyTax ?? 0) / 100);
  const budgetCountryId = netTariffCountryId;
  const publicEnterpriseRevenue = await calculateCountryOwnedBudgetRevenue(
    db,
    budgetCountryId,
    plantsContext,
    hoistedFxByCurrency
  );
  const healthcareIncome =
    publicEnterpriseRevenue.healthcareIncome ?? federalBudget?.revenue?.healthcareIncome ?? 0;
  // `??` (not `||`): a legitimately-zero persisted `other` must never snap to the
  // modern-US 200B constant — on a 1953-era budget that would be ~14× GDP
  // (spec §5.1 fallback guard). The constant remains only for legacy budgets
  // whose revenue.other was never persisted at all.
  const persistedOther = federalBudget?.revenue?.other ?? 200000000000;
  // Non-tax receipts track the SIZE OF THE ECONOMY, not a frozen figure authored
  // once at seed time. `otherRevenueGdpShareBaseline` holds the share; absent, it
  // self-heals from the persisted amount so an untouched budget is byte-identical
  // (see the field doc on FederalBudget). Without this the line decays as a share
  // of any growing economy, and breaks outright on a discontinuous GDP change:
  // DD's ₸4.0B survived reunification unchanged and went from 6.4% of the old
  // economy to 1.5% of the new one (#1323).
  const otherShare = federalBudget?.otherRevenueGdpShareBaseline;
  const budgetGdp = federalBudget?.gdp;
  const other =
    typeof otherShare === "number" &&
    Number.isFinite(otherShare) &&
    otherShare > 0 &&
    typeof budgetGdp === "number" &&
    Number.isFinite(budgetGdp) &&
    budgetGdp > 0
      ? otherShare * budgetGdp
      : persistedOther;
  const otherWithPublicEnterprise = other + (publicEnterpriseRevenue.other ?? 0);

  // Political-legislation v2 (spec §5.1): Σ revenue over unrepealed national
  // enacted laws, recomputed FROM SCRATCH on every call — mirrors the spending
  // side's full byCategory recompute, so syncs/heals never compound. Never
  // folded into `other`. These are legislated fiscal extractions, not
  // enterprise income, so they are tax-like and face the same base-erosion cap
  // as ordinary tax receipts. Persisted `other` and public-enterprise income
  // remain outside that cap: a Laffer curve must not erase hospital fees,
  // dividends, or unrelated non-tax receipts.
  //
  // "Recomputed from scratch" is what this comment always CLAIMED, but the code
  // summed the persisted `annualRevenueV2` field — a stored number, frozen at
  // whatever base it was last written against, while the cost half of the very
  // same `costModelV2` was being re-derived from live GDP every turn. The two
  // halves of one law drifted apart: DD's national book reported ₸0.725B of law
  // revenue against ₸3.07B of `gdpRevenueFraction`, because the stored figures
  // were computed when DD was East Germany on a ₸70.27B GDP and reunification
  // nearly quadrupled the base without rewriting them (#1323).
  //
  // Recompute through the same engine the cost side uses, on the same
  // regional-rollup base, so a law's revenue and its cost can no longer be
  // priced off different economies. Laws with no `costModelV2` are legacy and
  // keep their persisted value — there is nothing to recompute them from.
  const lawRevenueDocs = await db
    .collection<EnactedLaw>("enactedLaws")
    .find(
      {
        scope: "national",
        countryId: budgetCountryId,
        repealedAt: { $exists: false },
        $or: [{ annualRevenueV2: { $gt: 0 } }, { "costModelV2.gdpRevenueFraction": { $gt: 0 } }],
      },
      { projection: { annualRevenueV2: 1, costModelV2: 1, legislationTypeId: 1 } }
    )
    .toArray();
  // Same gate the spending side applies before building its v2 base: a country
  // outside COST_INCOME_ANCHORS has no v2 catalogue, so there is no live base to
  // reprice against and the persisted figures stand.
  const lawRevenueBase =
    budgetCountryId in COST_INCOME_ANCHORS && lawRevenueDocs.some((law) => law.costModelV2)
      ? await countryFiscalBase(db, budgetCountryId)
      : undefined;
  const lawRevenue = keepLatestActiveLawPerType(lawRevenueDocs).reduce((sum, law) => {
    const fraction = law.costModelV2?.gdpRevenueFraction;
    if (lawRevenueBase && fraction != null) return sum + fraction * lawRevenueBase.gdp;
    return sum + (law.annualRevenueV2 ?? 0);
  }, 0);

  const taxLikeRevenue =
    incomeTax +
    domesticCorporateTax +
    foreignCorporateTax +
    payrollTax +
    tariffs +
    salesTax +
    solidaritySurcharge +
    landValueAddedTax +
    urbanMaintenanceTax +
    stampDuty +
    universalSocialCharge +
    capitalGainsTax +
    exciseDuty +
    propertyTax +
    lawRevenue;
  const taxLikeRevenueAfterCap = applyEraRevenueCap(
    taxLikeRevenue,
    federalBudget?.gdp,
    eraYear,
    budgetCountryId
  );
  const revenueCapReduction = taxLikeRevenue - taxLikeRevenueAfterCap;

  return {
    incomeTax,
    domesticCorporateTax,
    foreignCorporateTax,
    payrollTax,
    tariffs,
    salesTax,
    solidaritySurcharge,
    landValueAddedTax,
    urbanMaintenanceTax,
    stampDuty,
    universalSocialCharge,
    capitalGainsTax,
    exciseDuty,
    propertyTax,
    healthcareIncome,
    lawRevenue,
    taxLikeRevenue,
    taxLikeRevenueAfterCap,
    revenueCapReduction,
    other: otherWithPublicEnterprise,
    total: taxLikeRevenueAfterCap + healthcareIncome + otherWithPublicEnterprise,
  };
}

export async function refreshNationalBudgetRevenue(db: Db, budgetIds?: string[]): Promise<number> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(budgetIds?.length ? { _id: { $in: budgetIds } } : {})
    .toArray();

  if (budgets.length === 0) {
    return 0;
  }

  // Each country's budget recompute is independent of every other's, and each
  // makes ~8-10 sequential DB reads (revenue bases, public-enterprise revenue,
  // enacted laws, population, regional transfers). Previously this ran fully
  // sequentially — 8 budgets × ~9 reads = ~70 serial round-trips, growing
  // linearly toward 30-50 countries. Now: compute all budgets concurrently
  // (bounded by the driver's connection pool), then commit every write in one
  // bulkWrite. The redundant per-budget findOne inside calculateFederalRevenue
  // is also skipped by passing the budget we already hold.
  const now = new Date();
  // One read each for the whole pass: the market mode / governor ramp, era
  // clock, and FX table cannot change mid-pass, and the per-country path would
  // otherwise re-read them per budget. Money wiring (phase B): same hoist -
  // one gameConfig flag check and one sourcingNetworkLoad read for the whole
  // pass, never one per country.
  const [plantsContext, eraContext, fxByCurrency, moneyWiringConfig] = await Promise.all([
    loadPlantsBudgetContext(db),
    getEraContext(db).catch(() => null),
    loadFxRatesByCurrency(db),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { interstateMoneyWiringEnabled: 1 } }),
  ]);
  const moneyWiringEnabled = moneyWiringConfig?.interstateMoneyWiringEnabled === true;
  const sourcedImportsByCountry = moneyWiringEnabled
    ? await loadLatestSourcedImportAggregates(db, await getCurrentTurn(db))
    : new Map<string, { tariffPaid: number; importValue: number }>();
  const results = await Promise.all(
    budgets.map(async (budget) => {
      // Skip budgets missing taxRates (e.g. incompletely seeded countries) —
      // one bad document must not crash the entire corporation turn phase.
      if (!budget.taxRates) return null;
      const countryId = budget.countryId ?? budget._id;
      const sourcedAgg = sourcedImportsByCountry.get(countryId);
      const revenue = await calculateFederalRevenue(
        db,
        budget.taxRates,
        budget._id,
        budget,
        plantsContext,
        eraContext ?? undefined,
        fxByCurrency,
        sourcedAgg
          ? { tariffPaidAnchor: sourcedAgg.tariffPaid, importValueAnchor: sourcedAgg.importValue }
          : undefined
      );
      // Recalculate spending to include current enacted laws and debt interest
      const spending = await calculateFederalSpending(
        db,
        { ...budget, revenue },
        budget.debt.principal * budget.debt.interestRate,
        eraContext ?? undefined
      );
      const surplus = revenue.total - spending.total;
      return {
        updateOne: {
          filter: { _id: budget._id },
          update: { $set: { revenue, spending, surplus, updatedAt: now } },
        },
      };
    })
  );

  const ops = results.filter((op): op is NonNullable<typeof op> => op !== null);
  if (ops.length === 0) return 0;

  await db.collection<FederalBudget>("federalBudget").bulkWrite(ops);
  return ops.length;
}

/**
 * Calculate state revenue using stored tax bases and rates.
 */
export async function calculateStateRevenue(
  db: Db,
  stateId: string,
  countryId: CountryId,
  taxRates: Partial<StateTaxRates> | null | undefined,
  federalGrants: number
): Promise<StateBudget["revenue"]> {
  const normalizedTaxRates = normalizeStateTaxRates(taxRates) ?? {
    incomeTax: 0,
    salesTax: 0,
    domesticCorporateTax: 0,
    foreignCorporateTax: 0,
    propertyTax: 0,
  };

  // Get the current state budget to read tax bases
  const stateBudget = await db
    .collection<StateBudget>("stateBudgets")
    .findOne({ _id: stateId, countryId });

  // Use stored tax bases if available, otherwise derive from state data
  let bases: StateTaxBases;
  if (stateBudget?.taxBases) {
    bases = stateBudget.taxBases;
  } else {
    // Fallback: derive bases from state GDP
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    // SP5: medianIncome lives on macroMetrics. (Also fixes the legacy filter,
    // which queried a nonexistent stateId field and always fell to the default.)
    const metrics = await db
      .collection<MacroMetricsDoc>("macroMetrics")
      .findOne({ _id: stateId, countryId });

    const population = state?.population || 1000000;
    const medianIncome = metrics?.economic?.medianIncome?.value || 50000;
    const gdpFactor = 2.5;
    const stateGDP = (population * medianIncome * gdpFactor) / 1000;

    bases = {
      taxableIncome: stateGDP * GDP_INCOME_TAX_FACTOR,
      taxableSales: stateGDP * GDP_SALES_FACTOR,
      domesticCorporateProfits: stateGDP * GDP_DOMESTIC_CORPORATE_FACTOR,
      foreignCorporateProfits: stateGDP * GDP_FOREIGN_CORPORATE_FACTOR,
      propertyValue: stateGDP * GDP_PROPERTY_FACTOR,
    };
  }

  // Calculate revenue from bases × rates
  const incomeTax = bases.taxableIncome * (normalizedTaxRates.incomeTax / 100);
  const salesTax = bases.taxableSales * (normalizedTaxRates.salesTax / 100);
  const domesticCorporateTax =
    bases.domesticCorporateProfits * (normalizedTaxRates.domesticCorporateTax / 100);
  const foreignCorporateTax =
    bases.foreignCorporateProfits * (normalizedTaxRates.foreignCorporateTax / 100);
  const propertyTax = bases.propertyValue * (normalizedTaxRates.propertyTax / 100);
  // DE Gewerbesteuer — Hebesatz × 0.035 (Steuermesszahl) × domestic corporate base.
  // Non-DE Länder: rate undefined → 0.
  const tradeTax =
    bases.domesticCorporateProfits * 0.035 * ((normalizedTaxRates.tradeTax ?? 0) / 100);
  const other = stateBudget?.revenue?.other || 0;
  // Preserve the accumulated extraction-royalty line across the annual recompute
  // (same treatment as `other`) so contractSettlement's per-turn $inc survives
  // and stays in `total`. See StateRevenue.resourceRoyalties.
  const resourceRoyalties = stateBudget?.revenue?.resourceRoyalties || 0;

  return {
    incomeTax,
    salesTax,
    domesticCorporateTax,
    foreignCorporateTax,
    propertyTax,
    tradeTax,
    federalGrants,
    other,
    resourceRoyalties,
    total:
      incomeTax +
      salesTax +
      domesticCorporateTax +
      foreignCorporateTax +
      propertyTax +
      tradeTax +
      federalGrants +
      other +
      resourceRoyalties,
  };
}

// Capital returns premium: corporate profits grow faster than wages (r > g)
// Historically ~1-2% annually; we use 1% for game balance
const CAPITAL_RETURNS_PREMIUM = 1.0;

/**
 * Fiscal-divergence guardrail (refs #fiscal-divergence-audit — see
 * `FederalBudget.taxBaseGdpShareBaseline`). Fraction of a base's gap from its
 * baseline GDP-share target closed per YEAR (not per turn — callers scale by
 * `perYearDivisor` so the annual pull is the same regardless of cadence).
 * `wageGrowth`/`tradeGrowth` carry a structural premium over realized
 * `gdpGrowth` (metricEngine/registry/economic.ts: wageGrowth's labor-market
 * "tightness" bonus has no offsetting term; tradeGrowth's WORLD_TRADE_BASELINE
 * floor alone typically exceeds realized GDP growth), so grown-only bases
 * compound away from the economy's actual size without bound. A *partial*
 * pull-back (not a hard cap) still lets sustained real drivers — deliberate
 * wage/trade policy held up for years — move the share; it only bounds
 * passive, undirected drift. 0.08 ⇒ ~8-9yr half-life: a multi-year deliberate
 * push clearly outruns it, a one-turn wobble is barely felt.
 */
export const TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL = 0.08;

/**
 * Ceiling on how far a tax base's growth rate may exceed the growth of the GDP
 * it is anchored to, in percentage points per year.
 *
 * The gravity above is a SPRING, and a spring can be outpulled. Writing the
 * per-year step out, with pull `p`, base growth `w` and GDP growth `g`, the
 * base/target ratio has fixed point
 *
 *     x = p / ((1 + g) − (1 + w)(1 − p))
 *
 * which is finite only while `(1 + w)(1 − p) < (1 + g)`. Past that the
 * denominator goes negative and there is NO equilibrium: the base diverges from
 * GDP without bound, and no value of `p` short of 1 recovers it. That is not a
 * hypothetical. Measured over turns 480-576, every country runs a large,
 * permanent wedge between the rates that grow the bases and the rate that grows
 * their target:
 *
 *     country   gdpGrowth   wageGrowth   tradeGrowth
 *     DD          3.55        16.47         24.06
 *     DE         −2.72         9.53          4.17
 *     RU          1.16        13.67         30.00   (pinned at its +30 bound)
 *     US         −2.91         4.46          2.65
 *
 * DD's denominator is negative, which is why its taxableIncome climbed 35% →
 * 103% OF GDP across 1953-64 — a base larger than the economy that produced it —
 * and why the Laffer cap was quietly discarding a quarter of its revenue every
 * year to hide it (#1323).
 *
 * The wedge itself is upstream and is NOT fixed here: `wageGrowth` tracks
 * `productivityGrowth`, which reads 9.9-12%/yr in DD's regions against ~3% in
 * the UK's, and `tradeGrowth` sits pinned at its registry bound for RU and DD
 * with `forexStrength` at 0, so the bound is not being reached through the
 * formula's own terms. Both are separate defects with their own blast radius.
 *
 * What this constant does is make the budget system's arithmetic sound
 * regardless: a base may still outgrow GDP — genuine wage or trade policy held
 * up for years should move its share — but only by a bounded premium, which
 * keeps the denominator positive and the equilibrium finite. At 2pp the fixed
 * point sits near 1.25x baseline, which is where the countries with coherent
 * inputs already sit (PL 1.23x, DE 1.33x) and which puts every ratio inside a
 * defensible real-world band: wages ~50% of GDP, consumption ~56%, imports ~20%.
 * It also returns the revenue cap to the rare backstop it was designed to be
 * rather than a standing 27% haircut.
 *
 * The premium is measured against NOMINAL GDP growth — see
 * `nominalGrowthCeiling`, which is where the inflation term is reasoned about.
 *
 * Deliberately a cap on the RATE, not on the level: a level clamp would snap
 * bases discontinuously, and the gravity is what closes an existing gap.
 */
export const TAX_BASE_GROWTH_PREMIUM_CAP = 2.0;

export interface TaxBaseGravityContext {
  /** Current national GDP, local currency, full units (not the states
   *  collection's millions unit) — e.g. `calculateNationalGDP`'s return, or a
   *  live Σ state.gdp the caller already has on hand. */
  currentGdp: number;
  /** Each base's target share of `currentGdp`, established once at this
   *  country's bootstrap (see `FederalBudget.taxBaseGdpShareBaseline`). A
   *  missing/non-positive key skips the pull for that base (no baseline yet
   *  — never invents one here). */
  shareBaseline: Partial<Record<keyof FederalTaxBases, number>>;
}

/** Nudge `value` a `pull` fraction of the way toward `gdp × targetShare`. A
 *  no-op when gravity is absent, GDP is unusable, or this base has no
 *  baseline share recorded yet. */
function pullTowardGdpShare(
  value: number,
  key: keyof FederalTaxBases,
  perYearDivisor: number,
  gravity: TaxBaseGravityContext | undefined
): number {
  if (!gravity || !(gravity.currentGdp > 0)) return value;
  const targetShare = gravity.shareBaseline[key];
  if (targetShare == null || !(targetShare > 0)) return value;
  const pull = TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL / perYearDivisor;
  const target = gravity.currentGdp * targetShare;
  return value + (target - value) * pull;
}

/**
 * The fastest a tax base may grow: NOMINAL GDP growth plus the premium.
 *
 * Nominal, not real, because the two sides carry inflation differently.
 * `wageGrowth` adds `WAGE_INFLATION_PASSTHROUGH x laggedInflation` on top of its
 * real component, so the bases are nominal quantities, while `compoundGdpLevel`
 * moves `state.gdp` by `gdpGrowth` alone. Capping a nominal rate against a real
 * one would freeze the base exactly when it must move most: BR-1991 runs ~480%
 * inflation and ~50%/yr nominal wage growth against ~2.5% real GDP growth, and
 * a real-only ceiling would have pinned its income-tax base near zero growth
 * through a hyperinflation (see fiscalGrowthFactors.test.ts, which pins that
 * band).
 *
 * Deflation cannot tighten the ceiling below real growth — a negative inflation
 * reading floors at 0 — so a deflationary year does not quietly turn this into a
 * base cut.
 */
function nominalGrowthCeiling(factors: EconomicGrowthFactors): number {
  const inflation = Number.isFinite(factors.inflationRate) ? Math.max(0, factors.inflationRate) : 0;
  return factors.gdpGrowth + inflation + TAX_BASE_GROWTH_PREMIUM_CAP;
}

/**
 * Grow federal tax bases by an economic-factor set. `perYearDivisor` selects the
 * cadence: 1 = the full annual step (the legacy fiscal-year form), TURNS_PER_YEAR
 * = a single per-turn slice (the fiscalBaseGrowth phase). Corporate profits grow
 * faster than wages to reflect returns to capital > returns to labor.
 *
 * `gravity`, when supplied, pulls each base a small fraction of the way back
 * toward its baseline share of current GDP AFTER the rate-based growth above —
 * see `TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL`. Omitted ⇒ byte-identical to the
 * pre-guardrail behavior (existing callers/tests are unaffected).
 */
function growFederalBases(
  bases: FederalTaxBases,
  factors: EconomicGrowthFactors,
  perYearDivisor: number,
  gravity?: TaxBaseGravityContext
): FederalTaxBases {
  // A base may outrun the GDP it is measured against, but only by this much.
  // See TAX_BASE_GROWTH_PREMIUM_CAP.
  const capped = (rate: number) => Math.min(rate, nominalGrowthCeiling(factors));
  const g = (rate: number) => 1 + rate / 100 / perYearDivisor;
  const gdpGrowthMultiplier = g(factors.gdpGrowth);
  const wageGrowthMultiplier = g(capped(factors.wageGrowth));
  const tradeGrowthMultiplier = g(capped(factors.tradeGrowth));
  // Corporate profits grow at GDP + capital premium (r > g).
  const corporateProfitMultiplier = g(factors.gdpGrowth + CAPITAL_RETURNS_PREMIUM);

  const grown: FederalTaxBases = {
    // Taxable income grows with wages
    taxableIncome: bases.taxableIncome * wageGrowthMultiplier,
    // Corporate profits grow faster than GDP (capital accumulation). Domestic/foreign split
    // is a legal-jurisdiction question — both pools grow at the same rate.
    domesticCorporateProfits: bases.domesticCorporateProfits * corporateProfitMultiplier,
    foreignCorporateProfits: bases.foreignCorporateProfits * corporateProfitMultiplier,
    // Wages grow with wage growth
    wagesAndSalaries: bases.wagesAndSalaries * wageGrowthMultiplier,
    // Imports grow with trade
    importValue: bases.importValue * tradeGrowthMultiplier,
    // Consumer spending grows with GDP and wages
    taxableSales: bases.taxableSales * ((gdpGrowthMultiplier + wageGrowthMultiplier) / 2),
  };
  if (!gravity) return grown;

  return {
    taxableIncome: pullTowardGdpShare(
      grown.taxableIncome,
      "taxableIncome",
      perYearDivisor,
      gravity
    ),
    domesticCorporateProfits: pullTowardGdpShare(
      grown.domesticCorporateProfits,
      "domesticCorporateProfits",
      perYearDivisor,
      gravity
    ),
    foreignCorporateProfits: pullTowardGdpShare(
      grown.foreignCorporateProfits,
      "foreignCorporateProfits",
      perYearDivisor,
      gravity
    ),
    wagesAndSalaries: pullTowardGdpShare(
      grown.wagesAndSalaries,
      "wagesAndSalaries",
      perYearDivisor,
      gravity
    ),
    importValue: pullTowardGdpShare(grown.importValue, "importValue", perYearDivisor, gravity),
    taxableSales: pullTowardGdpShare(grown.taxableSales, "taxableSales", perYearDivisor, gravity),
  };
}

/** Full annual growth step (legacy fiscal-year form). */
export function applyGrowthToFederalBases(
  bases: FederalTaxBases,
  factors: EconomicGrowthFactors,
  gravity?: TaxBaseGravityContext
): FederalTaxBases {
  return growFederalBases(bases, factors, 1, gravity);
}

/** Single per-turn slice (the fiscalBaseGrowth phase). TURNS_PER_YEAR of these
 *  compound to ≈ one annual step. */
export function applyPerTurnGrowthToFederalBases(
  bases: FederalTaxBases,
  factors: EconomicGrowthFactors,
  gravity?: TaxBaseGravityContext
): FederalTaxBases {
  return growFederalBases(bases, factors, TURNS_PER_YEAR, gravity);
}

/**
 * Compute a fresh `taxBaseGdpShareBaseline` from a budget's current bases and
 * GDP — each base's share of GDP right now. Called once per country, the
 * first time `fiscalBaseGrowth` finds the field absent (self-heal, mirroring
 * `eraGdpPerCapitaBaseline`'s bootstrap-then-track pattern in
 * `nationalMetrics.ts`). A non-positive `currentGdp` yields an empty object
 * (no baseline recorded — the caller retries next turn).
 */
export function computeTaxBaseGdpShareBaseline(
  bases: FederalTaxBases,
  currentGdp: number
): Partial<Record<keyof FederalTaxBases, number>> {
  if (!(currentGdp > 0)) return {};
  const share: Partial<Record<keyof FederalTaxBases, number>> = {};
  for (const key of Object.keys(bases) as (keyof FederalTaxBases)[]) {
    const value = bases[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      share[key] = value / currentGdp;
    }
  }
  return share;
}

/**
 * Grow state tax bases by an economic-factor set. `perYearDivisor` as above.
 * Property values grow on the GDP+inflation blend (real-estate appreciation).
 */
function growStateBases(
  bases: StateTaxBases,
  factors: EconomicGrowthFactors,
  perYearDivisor: number
): StateTaxBases {
  // Same premium ceiling as the federal bases (see TAX_BASE_GROWTH_PREMIUM_CAP).
  // State bases have no gravity pull at all — there is no per-state equivalent of
  // `taxBaseGdpShareBaseline` — so an uncapped wage rate here diverges from
  // regional GDP with nothing whatsoever pulling back.
  const g = (rate: number) => 1 + rate / 100 / perYearDivisor;
  const gdpGrowthMultiplier = g(factors.gdpGrowth);
  const wageGrowthMultiplier = g(Math.min(factors.wageGrowth, nominalGrowthCeiling(factors)));
  const corporateProfitMultiplier = g(factors.gdpGrowth + CAPITAL_RETURNS_PREMIUM);
  const propertyGrowthMultiplier = g((factors.gdpGrowth + factors.inflationRate) / 2);

  return {
    taxableIncome: bases.taxableIncome * wageGrowthMultiplier,
    taxableSales: bases.taxableSales * ((gdpGrowthMultiplier + wageGrowthMultiplier) / 2),
    domesticCorporateProfits: bases.domesticCorporateProfits * corporateProfitMultiplier,
    foreignCorporateProfits: bases.foreignCorporateProfits * corporateProfitMultiplier,
    propertyValue: bases.propertyValue * propertyGrowthMultiplier,
  };
}

/**
 * Replace any non-finite state tax base with the GDP-derived figure the revenue
 * path already falls back to when bases are absent.
 *
 * A NaN base is ABSORBING: every growth step multiplies it, so once one appears
 * it survives every turn and spreads — Berlin's live `stateBudgets` doc carries
 * NaN in `taxBases.{taxableIncome,taxableSales,propertyValue}`, and from there
 * in `revenue.{incomeTax,salesTax,propertyTax,total}`, `balance` and `surplus`
 * (#1323). Nothing detected it, because NaN fails every comparison silently
 * rather than throwing.
 *
 * Re-deriving from regional GDP is the same treatment an ABSENT base already
 * gets, which is the honest reading: a base that is not a number is not a
 * measurement. Zeroing instead would silently delete the region's revenue, and
 * leaving it would keep the region permanently unbudgetable.
 *
 * `stateGdp` is the region's GDP in full units. A non-finite or non-positive
 * GDP leaves the bases untouched — there is nothing to re-derive from, and
 * inventing zeroes would be worse than the NaN.
 */
export function sanitizeStateTaxBases(
  bases: StateTaxBases,
  stateGdp: number
): { bases: StateTaxBases; repaired: (keyof StateTaxBases)[] } {
  const factors: Record<keyof StateTaxBases, number> = {
    taxableIncome: GDP_INCOME_TAX_FACTOR,
    taxableSales: GDP_SALES_FACTOR,
    domesticCorporateProfits: GDP_DOMESTIC_CORPORATE_FACTOR,
    foreignCorporateProfits: GDP_FOREIGN_CORPORATE_FACTOR,
    propertyValue: GDP_PROPERTY_FACTOR,
  };
  const repaired: (keyof StateTaxBases)[] = [];
  if (!Number.isFinite(stateGdp) || stateGdp <= 0) return { bases, repaired };
  const next = { ...bases };
  for (const key of Object.keys(factors) as (keyof StateTaxBases)[]) {
    if (!Number.isFinite(next[key])) {
      next[key] = stateGdp * factors[key];
      repaired.push(key);
    }
  }
  return { bases: repaired.length > 0 ? next : bases, repaired };
}

/** Full annual growth step (legacy fiscal-year form). */
export function applyGrowthToStateBases(
  bases: StateTaxBases,
  factors: EconomicGrowthFactors
): StateTaxBases {
  return growStateBases(bases, factors, 1);
}

/** Single per-turn slice (the fiscalBaseGrowth phase). */
export function applyPerTurnGrowthToStateBases(
  bases: StateTaxBases,
  factors: EconomicGrowthFactors
): StateTaxBases {
  return growStateBases(bases, factors, TURNS_PER_YEAR);
}
