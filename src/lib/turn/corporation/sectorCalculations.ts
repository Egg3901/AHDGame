import type { AnyBulkWriteOperation, ObjectId } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import { activeParentDividendFloorPct } from "@/lib/corporations/subsidiaries/helpers";
import { COUNTRY_CURRENCY_MAP, SECTOR_FX_SPREAD } from "@/lib/constants/currencies";
import type { CommodityType } from "@/lib/constants/commodities";
import { MARKET_DISABLED, type MarketContext } from "@/lib/market/marketContext";
import {
  computeCorporateCreditAtTurn,
  sumCorporateSectorConstructionInProgress,
} from "@/lib/bonds/corporateCredit";
import { ceoOwnershipFraction } from "@/lib/corporations/ceoOwnership";
import {
  calcMarketingGrowth,
  calcLogisticsStrengthAfterTurn,
  calcRdScoreAfterTurn,
  rdMoraleFactor,
  TURNS_PER_DAY,
  MAX_DIVIDEND_RATE,
  SECTOR_RISK_PREMIUM,
  CEO_SALARY_MAX_REVENUE_MULTIPLE,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import {
  resolveWageIndex,
  resolveAutomationIndex,
  LABOUR_DISABLED,
  type LabourContext,
  type WageIndexAccumulator,
  type AutomationIndexAccumulator,
} from "@/lib/labour/laborCost";
import { makeLabourDemandByState } from "@/lib/labour/labourMarket";
import { computeTechAssetValueAnchor } from "@/lib/corporations/techAssetValue";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { indexFundOwnershipFraction } from "@/lib/corporations/indexOwnership";
// getCountryConfig is needed for the prime rate fallback:
//   primeRateByCountry.get(sectorCountryId) ?? getCountryConfig(sectorCountryId).centralBank.defaultPrimeRate
import { getCountryConfig } from "@/lib/constants/countries";
import type {
  CorporationLookups,
  CorpSnapshot,
  FundDividendAccrual,
  SectorCalculationsResult,
} from "./types";
import { perTurnCouponPayment, BOND_UNIT_FACE_VALUE } from "@/lib/constants/bonds";
import { imfFacilityPaymentAnchorPerTurn } from "@/lib/imf/imfFacilityFinancials";
import { computeSharePrices, type SharePriceInput } from "./sharePriceFormula";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";
import { computeEscrowFundingTransfer } from "@/lib/corporations/escrowFunding";
import { pushEarningsHistory, normalizedEarningsFromHistory } from "./earningsRollingAverage";
import { applyEquityMethodEarnings } from "./equityMethodEarnings";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import {
  perTurnIssuerBondInterestExpense,
  perTurnBondCouponIncomeAsHolder,
} from "@/lib/bonds/corpBondCashflows";
import { addCorpToCorpSettlement, type SettleCorpInfo } from "./settleSupplyAgreements";

/** Primary commodities that proxy R&D conditions for each sector type. */
const SECTOR_RD_COMMODITIES: Partial<Record<string, [string, string?]>> = {
  energy: ["coal", "natural_gas"],
  mining: ["iron_ore", "copper"],
  agriculture: ["grain", "produce"],
  manufacturing: ["steel", "industrial_chemicals"],
  technology: ["electronics", "rare_earth"],
  pharmaceuticals: ["pharmaceuticals", "industrial_chemicals"],
  finance: ["consulting_services", "software"],
  media: ["software", "consulting_services"],
  retail: ["consumer_goods", "produce"],
  healthcare: ["pharmaceuticals", "consulting_services"],
  education: ["consulting_services", "software"],
  transportation: ["petroleum", "steel"],
  construction: ["steel", "timber"],
  utilities: ["coal", "natural_gas"],
  telecoms: ["electronics", "software"],
  hospitality: ["produce", "consumer_goods"],
  legal: ["consulting_services", "software"],
};

/**
 * R&D demand factor (0.85–1.15): ties R&D accrual to global commodity
 * market conditions. Base signal from software + consulting (tech ecosystem),
 * blended with 1–2 sector-specific commodities when available.
 * Neutral (1.0) when balanced or data is missing.
 */
function computeRdDemandFactor(
  software?: { supply: number; demand: number },
  consulting?: { supply: number; demand: number },
  sector1?: { supply: number; demand: number },
  sector2?: { supply: number; demand: number }
): number {
  const ds = (b?: { supply: number; demand: number }) =>
    !b || b.supply <= 0 ? 1 : b.demand / b.supply;
  const ratios = [ds(software), ds(consulting)];
  if (sector1) ratios.push(ds(sector1));
  if (sector2) ratios.push(ds(sector2));
  const avg = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  return Math.min(1.15, Math.max(0.85, 1 + (avg - 1) * 0.25));
}

export function processSectors(
  lookups: CorporationLookups,
  turn: number | undefined,
  now: Date,
  techTreesEnabled: boolean = false,
  currentYear?: number,
  labour: LabourContext = LABOUR_DISABLED,
  // Structural market rework context (see marketContext.ts): Tier 1 price
  // realization + Tier 3/D1 throughput coupling. Inert (multipliers 1) when
  // disabled — the default.
  market: MarketContext = MARKET_DISABLED,
  subsidiaryCorporationsEnabled: boolean = false,
  /** gameConfig.commandEconomyEnabled — gates the soft-budget exemptions. */
  commandEconomyEnabled: boolean = false,
  /** gameConfig.privateBankingEnabled — branch/commodity capacity split. */
  privateBankingEnabled: boolean = false
): SectorCalculationsResult {
  const currentTurn = typeof turn === "number" ? turn : 1;

  let totalRevenueGenerated = 0;
  let totalIncomeGenerated = 0;
  let sectorsProcessed = 0;

  // v2: per-state labour wage index accumulator (worker-weighted wage multiplier).
  const wageIndexByState = new Map<string, WageIndexAccumulator>();
  // v2-3b: per-state automation index accumulator (worker-weighted laborCostMultiplier).
  // Deliberately separate from wageIndexByState — see accumulateWageIndex's call
  // site below for why automation is excluded from the wage index.
  const automationIndexByState = new Map<string, AutomationIndexAccumulator>();
  // Phase 1 labour market telemetry: per-state desired headcount. Unlike the two
  // indices above this is NOT gated on the labour system being on, so it stays
  // populated in worlds where wages are off.
  const labourDemandByState = makeLabourDemandByState();
  const labourDemandWageIndexByState = new Map<string, WageIndexAccumulator>();
  // v3 Phase 6: strike trigger/resolution events, for index.ts (which owns
  // db) to turn into sentiment pulses. Same "collect during the pure loop,
  // consume after" pattern as sectorFxSpreadFees below.
  const pendingStrikeEvents: SectorCalculationsResult["strikeEvents"] = [];
  // Extraction sectors that newly crossed into capacity-bound state this turn,
  // for index.ts to turn into player notifications (same collect-then-consume
  // pattern as strike events).
  const pendingCapacityBindingEvents: SectorCalculationsResult["capacityBindingEvents"] = [];

  const sectorOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: { $set: Record<string, unknown> };
    };
  }[] = [];

  const corpOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: { $inc: Record<string, number>; $set: Record<string, unknown> };
    };
  }[] = [];

  // Shared read-only inputs + cross-sector collectors for the per-sector
  // computation, which lives in ./sectorTurn (processSector). The collector
  // maps/arrays are mutated in place by processSector, exactly as the inline
  // loop did before the extraction.
  const sectorTurnEnv: SectorTurnEnv = {
    lookups,
    turn,
    currentTurn,
    now,
    techTreesEnabled,
    currentYear,
    commandEconomyEnabled,
    labour,
    market,
    wageIndexByState,
    automationIndexByState,
    labourDemandByState,
    labourDemandWageIndexByState,
    pendingStrikeEvents,
    pendingCapacityBindingEvents,
    sectorOps,
    privateBankingEnabled,
  };

  const ceoSalaryPayments = new Map<string, Map<CurrencyCode, number>>();
  const dividendPayments = new Map<string, Map<CurrencyCode, number>>();
  const corpDividendPaymentsAnchorByCorpId = new Map<string, number>();
  // Same totals as above, but split by the PAYING corp's currency so a
  // cross-currency corp→corp dividend can be charged the FX spread downstream.
  const corpDividendPaymentsAnchorByCorpCurrency = new Map<string, Map<CurrencyCode, number>>();
  // Reduced FX spreads skimmed from foreign-currency operating income repatriated
  // to each corp's home currency. Distributed to the CB system in index.ts.
  const sectorFxSpreadFees: Array<{
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    fee: number;
  }> = [];
  const fundDividendAccruals: FundDividendAccrual[] = [];
  const marketingSpendAnchorByBuyerId = new Map<string, number>();
  const advertisingSellerDeliveredValues = [
    ...(market.advertisingSellerDeliveredValueAnchorByCorpId ?? new Map()),
  ].filter(
    ([corpId, value]) => lookups.corpById.has(corpId) && Number.isFinite(value) && value > 0
  );
  const totalAdvertisingDeliveredValueAnchor = advertisingSellerDeliveredValues.reduce(
    (sum, [, value]) => sum + value,
    0
  );
  const marketingOrderWeightByBuyerId = new Map<string, number>();
  if (market.clearingEnabled && totalAdvertisingDeliveredValueAnchor > 0) {
    for (const corp of lookups.corporations) {
      const code = resolveCorpLiquidCurrencyCode(corp);
      const rate = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);
      const requested =
        readCorpEconomicAnchor(corp.marketingBudget ?? 0, code, rate) / TURNS_PER_DAY;
      const funded = Math.min(
        Math.max(0, requested),
        Math.max(
          0,
          corpCapitalToAnchor(
            Number.isFinite(corp.liquidCapital) ? corp.liquidCapital : 0,
            code,
            rate
          )
        )
      );
      if (funded > 0) marketingOrderWeightByBuyerId.set(corp._id.toString(), funded);
    }
  }
  const totalMarketingOrderWeight = [...marketingOrderWeightByBuyerId.values()].reduce(
    (sum, weight) => sum + weight,
    0
  );

  function addToPaymentMap(
    map: Map<string, Map<CurrencyCode, number>>,
    charIdStr: string,
    amountAnchor: number,
    corpCountryId: string
  ) {
    const currency =
      COUNTRY_CURRENCY_MAP[corpCountryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
    // `amountAnchor` is ₳ (same convention as sector revenue / netIncomeBeforeDividends).
    // Character / imperial balances live in currencyBalances.personal.<code>, denominated in
    // the tagged currency — convert before storing so the downstream $inc lands at correct
    // local-currency scale. Mirrors the corp-to-corp credit in ./index.ts:92-114.
    const fxRate = lookups.exchangeRatesByCurrency.get(currency);
    const localAmount =
      Number.isFinite(fxRate) && fxRate && fxRate > 0 ? amountAnchor * fxRate : amountAnchor;
    if (!map.has(charIdStr)) map.set(charIdStr, new Map());
    const currMap = map.get(charIdStr)!;
    currMap.set(currency, (currMap.get(currency) ?? 0) + localAmount);
  }
  const corpSnapshots: CorpSnapshot[] = [];

  // Per-corp earnings history (updated this turn) and growth-rate accumulators
  // used to build the three-component share-price formula inputs after all corps
  // have been processed.
  const updatedEarningsHistoryByCorpId = new Map<string, number[]>();
  const corpGrowthNumerByCorpId = new Map<string, number>();
  const corpGrowthDenomByCorpId = new Map<string, number>();
  // Realized profit margin (net income before dividends ÷ revenue) per corp this
  // turn. Normalized (currency- and size-agnostic) so it can tier how fast a
  // player CEO trains Business Acumen — better-run corps teach more.
  const profitMarginByCorpId = new Map<string, number>();

  // Annualized operating income accumulators, split by corp-vs-sector country match.
  // Domestic = corp HQ'd in the same country as the sector; foreign = elsewhere.
  // Written to federalBudget.taxBases.{domestic,foreign}CorporateProfits and the
  // corresponding stateBudgets field in corporation/index.ts write-back loop.
  const domesticIncomeByCountry = new Map<string, number>();
  const foreignIncomeByCountry = new Map<string, number>();
  const domesticIncomeByOperatingState = new Map<string, number>();
  const foreignIncomeByOperatingState = new Map<string, number>();
  // O1c (design §5): paid growth cost per operating state → region capital stock.
  const growthInvestmentByOperatingState = new Map<string, number>();

  for (const corp of lookups.corporations) {
    // Resolve corp's home currency and FX rate once per corp. Every stored
    // corp-economic field (sector revenue, corp budgets, CEO salary, liquidCapital)
    // is in this currency post-v0.2.6; turn math runs in ₳ so we normalize each
    // read at the top of the loop and re-denominate on write.
    const resolvedHomeCurrency = resolveCorpLiquidCurrencyCode(corp);
    const localFxRate = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);

    const corpId = corp._id.toString();
    // Sector tech-tree bonuses (decade-gated R&D unlocks) — derived once per corp
    // from its unlocked node set. Inert (neutral 0pp / ×1) when the feature gate
    // is off. See lib/constants/techTree.
    // R&D accrual is tied moderately to the software (technology output) and
    // consulting-services markets: when demand for them runs ahead of supply the
    // innovation ecosystem is hot and R&D compounds a little faster, and vice
    // versa. Clamped to ±15%. Inert when the feature gate is off.
    const rdDemandFactor = techTreesEnabled
      ? (() => {
          const [c1, c2] = SECTOR_RD_COMMODITIES[corp.type as string] ?? [];
          return computeRdDemandFactor(
            lookups.globalCommodityBalances.get("software"),
            lookups.globalCommodityBalances.get("consulting_services"),
            c1 ? lookups.globalCommodityBalances.get(c1 as CommodityType) : undefined,
            c2 ? lookups.globalCommodityBalances.get(c2 as CommodityType) : undefined
          );
        })()
      : 1;
    const sectors = lookups.sectorsByCorp.get(corpId) ?? [];
    let corpRevenue = 0;
    let corpGrowthNumer = 0;
    let corpGrowthDenom = 0;
    let corpCosts = 0;
    // Worker-morale accumulators (#84): revenue-weighted average sector wageLevel
    // drives an R&D-efficiency multiplier below. Neutral (avg 1) when labour off.
    let corpWageWeighted = 0;
    let corpWageWeight = 0;
    let corpSectorNPV = 0; // Sum of sector NPVs for balance sheet price
    // Diagnostic accumulators (revenue-weighted)
    let diagWeightedMargin = 0;
    let diagWeightedCommodityInput = 0;
    let diagWeightedCommoditySurplus = 0;
    let diagWeightedExportPremium = 0;
    let diagWeightedMacro = 0;
    let diagWeightedStateMetrics = 0;
    let diagWeightedLegacyStateMetrics = 0;
    let diagTotalGrowthCost = 0;
    // Per-sector records for territorial tax apportionment (fed rate by sector country,
    // state rate by sector state) and for tax-base blending (Tasks 3 and 4).
    const sectorResults: Array<{
      hourlyRevenue: number;
      effectiveMargin: number;
      stateId: string;
      countryId: string;
    }> = [];

    for (const sector of sectors) {
      // Sector economic fields are stored in the sector's HOST-state functional
      // currency (the market it operates in), not the parent corp's home
      // currency — a foreign-owned sector's real (₳) value must track its host,
      // not its owner. Resolve per-sector; for domestic sectors this equals the
      // corp currency resolved above.
      const sectorCurrencyCode = resolveSectorHostCurrencyCode(sector, corp);
      const sectorFxRate = fxRateForSectorHostFromMap(
        sector,
        corp,
        lookups.exchangeRatesByCurrency
      );
      const r = processSector(
        sectorTurnEnv,
        corp,
        sector,
        sectors.length,
        sectorCurrencyCode,
        sectorFxRate
      );
      corpGrowthNumer += (r.newCurrentGrowthRate / 100) * r.hourlyRevenue;
      corpGrowthDenom += r.hourlyRevenue;
      corpSectorNPV += r.npvContribution;

      // O1c: paid growth cost → the operating state's capital investment.
      if (r.growthInvestmentAnchor > 0) {
        growthInvestmentByOperatingState.set(
          r.stateId,
          (growthInvestmentByOperatingState.get(r.stateId) ?? 0) + r.growthInvestmentAnchor
        );
      }

      corpRevenue += r.hourlyRevenue;
      // Weight worker morale (wageLevel) by sector revenue for the R&D factor.
      corpWageWeighted += r.hourlyRevenue * (sector.wageLevel ?? 1);
      corpWageWeight += r.hourlyRevenue;
      // Include regulatoryBurden so it flows to corpLevelCosts (apportioned by
      // revenue share for tax) AND to incomePreDividends → earningsHistory →
      // the share-price formula's earningsPower component. Without this, the
      // burden would only hit sectorNPV and would be silently absorbed by
      // corp-level income.
      // Suspended (embargoed foreign) sectors are mothballed: no operating cost
      // either, so the corp neither earns nor bleeds while dormant.
      corpCosts += r.costs;
      sectorsProcessed++;

      // Accumulate revenue-weighted diagnostic data for margin breakdown
      diagWeightedMargin += r.effectiveMargin * r.hourlyRevenue;
      diagWeightedCommodityInput += r.commodityMod * r.hourlyRevenue;
      diagWeightedCommoditySurplus += r.surplusMod * r.hourlyRevenue;
      diagWeightedExportPremium += r.exportPremiumMod * r.hourlyRevenue;
      diagWeightedMacro += r.macroMod * r.hourlyRevenue;
      diagWeightedStateMetrics += r.stateMetricsCappedTotal * r.hourlyRevenue;
      diagWeightedLegacyStateMetrics += r.stateMetricsLegacyTotal * r.hourlyRevenue;
      diagTotalGrowthCost += r.hourlyGrowthCost;

      // Record per-sector metrics for tax apportionment and base blending (Tasks 3/4).
      sectorResults.push({
        hourlyRevenue: r.hourlyRevenue,
        effectiveMargin: r.effectiveMargin,
        stateId: r.stateId,
        countryId: r.countryId,
      });
    }

    // Corporation-level costs (daily rates divided by TURNS_PER_DAY).
    // Corp-economic fields store in local currency post-v0.2.6 — normalize to ₳
    // for the per-turn arithmetic. The anchor variants also feed the marketing/
    // logistics strength helpers below (their thresholds are ₳-calibrated).
    const imfBailoutActive = corp.imfBailoutActive === true;

    const marketingBudgetAnchor = readCorpEconomicAnchor(
      corp.marketingBudget,
      resolvedHomeCurrency,
      localFxRate
    );
    const logisticsBudgetAnchor = readCorpEconomicAnchor(
      corp.logisticsBudget ?? 0,
      resolvedHomeCurrency,
      localFxRate
    );
    const rdBudgetAnchor = readCorpEconomicAnchor(
      corp.rdBudget ?? 0,
      resolvedHomeCurrency,
      localFxRate
    );
    const ceoSalaryAnchor = readCorpEconomicAnchor(
      corp.ceoSalary ?? 0,
      resolvedHomeCurrency,
      localFxRate
    );

    const requestedHourlyMarketing = marketingBudgetAnchor / TURNS_PER_DAY;
    const hourlyLogistics = logisticsBudgetAnchor / TURNS_PER_DAY;
    // R&D spend lives in the same daily-budget cadence as marketing/logistics
    // and counts against the 150% overhead cap. Feeds rdScore growth below.
    const hourlyRd = rdBudgetAnchor / TURNS_PER_DAY;
    const requestedCeoSalary = imfBailoutActive ? 0 : ceoSalaryAnchor / TURNS_PER_DAY;

    // liquidCapital normalized to ₳ using the per-corp FX resolved at loop entry.
    // Every downstream comparison against liquidCapital must normalize to a common
    // denomination — the field is in home currency post-forex, every computed
    // cash flow is in ₳.
    // Guard against NaN/non-finite values (BSON Double NaN survives ?? because NaN is not null).
    const liquidCapitalAnchor = corpCapitalToAnchor(
      Number.isFinite(corp.liquidCapital) ? corp.liquidCapital : 0,
      resolvedHomeCurrency,
      localFxRate
    );

    // Under clearing, marketing is a purchase only to the extent advertising
    // was delivered. Each funded buyer receives its pro-rata share of the
    // delivered book's clearing value, capped again by its budget and cash.
    // When the world has no advertising seller, retain the cost but create no
    // settlement: marketing does not become globally free at zero supply.
    const marketingSettlementEnabled = market.clearingEnabled;
    const marketingCashAvailable = Math.max(
      0,
      liquidCapitalAnchor + corpRevenue - corpCosts - hourlyLogistics - hourlyRd
    );
    const deliveredValueShare =
      totalMarketingOrderWeight > 0
        ? totalAdvertisingDeliveredValueAnchor *
          ((marketingOrderWeightByBuyerId.get(corpId) ?? 0) / totalMarketingOrderWeight)
        : 0;
    const hourlyMarketing = marketingSettlementEnabled
      ? Math.min(
          Math.max(0, requestedHourlyMarketing),
          marketingCashAvailable,
          totalAdvertisingDeliveredValueAnchor > 0
            ? Math.max(0, deliveredValueShare)
            : Math.max(0, requestedHourlyMarketing)
        )
      : requestedHourlyMarketing;
    if (
      marketingSettlementEnabled &&
      totalAdvertisingDeliveredValueAnchor > 0 &&
      hourlyMarketing > 0
    ) {
      marketingSpendAnchorByBuyerId.set(corpId, hourlyMarketing);
    }

    // Compute income before CEO salary to determine what the corp can afford
    const costsBeforeCeo = corpCosts + hourlyMarketing + hourlyLogistics + hourlyRd;
    const incomeBeforeCeo = corpRevenue - costsBeforeCeo;
    const corpCountryId = corp.countryId;

    // Cap CEO salary: only pay what the corp can cover without going below zero.
    // projectedLiquid is what liquidCapital would be after all costs except CEO salary.
    // Both sides in ₳: liquidCapital is normalized; incomeBeforeCeo is already ₳.
    const projectedLiquid = liquidCapitalAnchor + incomeBeforeCeo;
    let actualCeoSalary: number;
    let shouldZeroCeoSalary = false;
    if (requestedCeoSalary <= 0 || projectedLiquid <= 0) {
      // Corp is already broke or no salary set — pay nothing, zero out salary if it was set
      actualCeoSalary = 0;
      if ((corp.ceoSalary ?? 0) > 0) shouldZeroCeoSalary = true;
    } else if (requestedCeoSalary > projectedLiquid) {
      // Salary exceeds what corp can cover — pay only what's available, then zero out
      actualCeoSalary = projectedLiquid;
      shouldZeroCeoSalary = true;
    } else {
      actualCeoSalary = requestedCeoSalary;
    }

    // Bug #0728: CEO salary may not exceed 1.25x gross (sector) revenue. corpRevenue
    // excludes bond proceeds (which land in liquidCapital) and bond coupon income (a
    // separate line), so issuing bonds can never raise this ceiling. Zero revenue ⇒ $0.
    // The stored ceoSalary is left intact (not zeroed) so a legitimate corp resumes
    // paying once revenue returns. Both sides are per-turn ₳.
    const salaryRevenueCap = CEO_SALARY_MAX_REVENUE_MULTIPLE * Math.max(0, corpRevenue);
    if (actualCeoSalary > salaryRevenueCap) {
      actualCeoSalary = salaryRevenueCap;
    }

    const totalCorpCosts = costsBeforeCeo + actualCeoSalary;
    const incomePreDividends = corpRevenue - totalCorpCosts;

    // Corporate tax (territorial, per-sector): each sector pays its country's federal rate
    // and its state's rate on its revenue-weighted apportioned share of corp income.
    // Corp-level overhead (marketing, logistics, CEO, growth) is allocated across sectors
    // by revenue share. Losing sectors pay 0; profitable sectors pay even if corp total is
    // negative (nexus-based). Loss-making corps with all-negative sectors pay 0 in both tiers.
    // See docs/plans/archive/2026-04/2026-04-18-corp-tax-apportionment-design.md.
    let sectorMaintenanceTotal = 0;
    for (const s of sectorResults) {
      sectorMaintenanceTotal += s.hourlyRevenue * (1 - s.effectiveMargin / 100);
    }
    const corpLevelCosts = totalCorpCosts - sectorMaintenanceTotal;

    let totalFederalTax = 0;
    let totalStateTax = 0;
    // Per-jurisdiction breakdown so each turn's history snapshot can record which countries/
    // states received tax from this corp. Empty maps for single-jurisdiction corps — the
    // persist layer omits empty maps so we don't carry noisy `{}` keys on every doc.
    const taxPaidByCountry = new Map<string, number>();
    const taxPaidByState = new Map<string, number>();
    // Split breakdown for the corporationHistory diagnostic. Same total as the combined
    // maps above; splits by whether the corp is HQ'd in the sector's country (domestic)
    // or elsewhere (foreign). Populated only when non-zero, persisted only when non-empty.
    const taxPaidByCountryDomestic = new Map<string, number>();
    const taxPaidByCountryForeign = new Map<string, number>();
    const taxPaidByStateDomestic = new Map<string, number>();
    const taxPaidByStateForeign = new Map<string, number>();
    // Legal structure: pass_through → 0% corp tax; preferential → taxMultiplier× rate; standard → 1×
    const corpLegalStructure = getLegalStructureForCorp(corp);
    const corpTaxMultiplier =
      corpLegalStructure.taxTreatment === "pass_through"
        ? 0
        : corpLegalStructure.taxTreatment === "preferential"
          ? (corpLegalStructure.taxMultiplier ?? 1)
          : 1;

    // Consolidated loss offset. Taxing each sector's positive income in
    // isolation (`max(0, sectorNetIncome)`) meant a diversified corp's losses
    // offset NOTHING: live t176, Lockheed Chemicals owed 944k/turn of tax on
    // 122k/turn of consolidated revenue — its chemical plants taxed gross
    // while its farming losses were invisible to the base, ~80% of all US
    // corporate tax from one structurally loss-making company. Standard
    // consolidated filing nets losses against profits within the group, so:
    // scale every sector's taxable income by consolidated ÷ gross-positive.
    // Per-sector state/country ATTRIBUTION is preserved proportionally; a
    // corp with no losing sectors has scale = 1 and is byte-identical.
    let grossPositiveTaxable = 0;
    let consolidatedNet = 0;
    for (const s of sectorResults) {
      const revenueShare = corpRevenue > 0 ? s.hourlyRevenue / corpRevenue : 0;
      const sectorNetIncome =
        s.hourlyRevenue * (s.effectiveMargin / 100) - corpLevelCosts * revenueShare;
      consolidatedNet += sectorNetIncome;
      if (sectorNetIncome > 0) grossPositiveTaxable += sectorNetIncome;
    }
    const lossOffsetScale =
      grossPositiveTaxable > 0
        ? Math.max(0, Math.min(1, consolidatedNet / grossPositiveTaxable))
        : 0;

    for (const s of sectorResults) {
      const revenueShare = corpRevenue > 0 ? s.hourlyRevenue / corpRevenue : 0;
      const sectorOpIncome = s.hourlyRevenue * (s.effectiveMargin / 100);
      const sectorNetIncome = sectorOpIncome - corpLevelCosts * revenueShare;
      const sectorTaxable = Math.max(0, sectorNetIncome) * lossOffsetScale;
      if (sectorTaxable <= 0) continue;
      // Domestic = corp HQ'd in the same country as this sector.
      // Foreign = corp HQ'd elsewhere; pays the host country's foreign rate.
      const isDomestic = corp.countryId === s.countryId;
      const federalRate =
        corpTaxMultiplier *
        (isDomestic
          ? (lookups.domesticCorpTaxRateByCountry.get(s.countryId) ?? 0)
          : (lookups.foreignCorpTaxRateByCountry.get(s.countryId) ?? 0));
      const stateRate =
        corpTaxMultiplier *
        (isDomestic
          ? (lookups.domesticStateCorpTaxRateByState.get(s.stateId) ?? 0)
          : (lookups.foreignStateCorpTaxRateByState.get(s.stateId) ?? 0));
      const fedTax = sectorTaxable * (federalRate / 100);
      const stTax = sectorTaxable * (stateRate / 100);
      totalFederalTax += fedTax;
      totalStateTax += stTax;
      const targetCountryMap = isDomestic ? taxPaidByCountryDomestic : taxPaidByCountryForeign;
      const targetStateMap = isDomestic ? taxPaidByStateDomestic : taxPaidByStateForeign;
      if (fedTax > 0) {
        taxPaidByCountry.set(s.countryId, (taxPaidByCountry.get(s.countryId) ?? 0) + fedTax);
        targetCountryMap.set(s.countryId, (targetCountryMap.get(s.countryId) ?? 0) + fedTax);
      }
      if (stTax > 0) {
        taxPaidByState.set(s.stateId, (taxPaidByState.get(s.stateId) ?? 0) + stTax);
        targetStateMap.set(s.stateId, (targetStateMap.get(s.stateId) ?? 0) + stTax);
      }
    }

    // Per-turn bond cash flows (matches consolidated `income` on corporation API financials).
    // Issuer interest is waived for national enterprises (government bond subsidy).
    // Bond amounts denominate in bond.currencyCode (Task 18B); both helpers
    // normalize to ₳ via lookups.exchangeRatesByCurrency so the corp's
    // income math stays anchor-consistent across cross-currency holdings.
    const issuerBonds = lookups.bondsByCorpId.get(corp._id.toString());
    const perTurnBondInterestExpense = perTurnIssuerBondInterestExpense(
      issuerBonds,
      lookups.exchangeRatesByCurrency
    );
    const heldBonds = lookups.bondsHeldByCorpId.get(corp._id.toString()) ?? [];
    const perTurnBondCouponIncome = perTurnBondCouponIncomeAsHolder(
      heldBonds,
      lookups.exchangeRatesByCurrency
    );
    const isNationalEnterprise = !!corp.countryOwnerId;
    const perTurnBondDragOnNetIncome = isNationalEnterprise ? 0 : perTurnBondInterestExpense;

    // Bond coupon income is taxed at the corp's home-country federal rate only
    // (state/regional never taxes bond interest — standard municipal-bond
    // convention extended to corporate holdings here). Added to totalFederalTax
    // so the deduction lands in `afterTaxOperating` alongside operating tax,
    // and recorded in `taxPaidByCountry` under the corp's home country so the
    // history breakdown attributes the revenue correctly.
    // Corp's home country — bond income is always domestic from the corp's perspective.
    // pass_through structures pay no corporate tax including on bond income (corpTaxMultiplier = 0).
    const corpCountryFedRate = lookups.domesticCorpTaxRateByCountry.get(corp.countryId) ?? 0;
    const bondCouponFedTax =
      Math.max(0, perTurnBondCouponIncome) * corpTaxMultiplier * (corpCountryFedRate / 100);
    if (bondCouponFedTax > 0) {
      totalFederalTax += bondCouponFedTax;
      taxPaidByCountry.set(
        corp.countryId,
        (taxPaidByCountry.get(corp.countryId) ?? 0) + bondCouponFedTax
      );
      taxPaidByCountryDomestic.set(
        corp.countryId,
        (taxPaidByCountryDomestic.get(corp.countryId) ?? 0) + bondCouponFedTax
      );
    }

    // State-owned enterprises pay no corporate income tax. A nationalized industry is
    // owned by the state, and it already returns its profit to that same state through the
    // per-turn remittance (processSoeRemittance). Levying corporate tax on top charged one
    // profit twice to a single owner: it drained SOEs to zero and pushed the tax-driven ones
    // (whose losses the operating-loss backstop deliberately does not cover) negative. Zero
    // the accumulators AND the per-country maps so neither the corp's cash debit nor the
    // government's tax-revenue credit records a charge — the remittance line is the return.
    if (isStateOwned(corp)) {
      totalFederalTax = 0;
      totalStateTax = 0;
      taxPaidByCountry.clear();
      taxPaidByCountryDomestic.clear();
      taxPaidByCountryForeign.clear();
    }

    const corporateTaxOwed = totalFederalTax + totalStateTax;
    const afterTaxOperating = incomePreDividends - corporateTaxOwed;
    const netIncomeBeforeDividends =
      afterTaxOperating + perTurnBondCouponIncome - perTurnBondDragOnNetIncome;

    // Capture realized margin for Business-Acumen growth tiering (CEO success).
    profitMarginByCorpId.set(
      corp._id.toString(),
      corpRevenue > 0 ? netIncomeBeforeDividends / corpRevenue : 0
    );

    // Dividend payouts: % of net income (after tax and bond interest / coupon / subsidy),
    // capped by that same net income so a corp distributes no more than it actually
    // earned this turn. The cap uses netIncomeBeforeDividends (which INCLUDES bond
    // coupon income), NOT operating-only afterTaxOperating: capping at operating
    // profit silently zeroed the payout for a corp whose profit comes from bond
    // holdings — it would pass the eligibility gate below (net income > 0) yet pay
    // nothing, breaking pass-through structures' "profits must be distributed"
    // contract. Bond coupon/interest settle in the bond phase (see `income` note
    // below), so distributing against net income never pays out borrowed/financing
    // cash — only realized earnings.
    // Hard-clamp to MAX_DIVIDEND_RATE so legacy corps set above the new cap are contained at turn time.
    const dividendRate = Math.min(corp.dividendRate ?? 0, MAX_DIVIDEND_RATE);
    let hourlyDividendPayout = 0;

    const shouldClearDividends =
      (dividendRate > 0 && netIncomeBeforeDividends < 0) || imfBailoutActive;
    const effectiveDividendRate = shouldClearDividends ? 0 : dividendRate;
    // For pass-through structures: enforce minimum payout without overwriting the stored dividendRate.
    const minDividendPct = (corpLegalStructure.minimumDividendRate ?? 0) * 100;
    // Subsidiary corporations (feature-gated): honor a parent-set dividend floor
    // only while the setter still controls >50% voting power of this corp.
    const parentDividendFloorPct = activeParentDividendFloorPct({
      enabled: subsidiaryCorporationsEnabled,
      parentDividendFloorPct: corp.parentDividendFloorPct,
      parentDividendFloorSetByCorpId: corp.parentDividendFloorSetByCorpId,
      controllingParent: getControllingCorporateParent(corp),
      maxRate: MAX_DIVIDEND_RATE,
    });
    const payoutDividendRate = shouldClearDividends
      ? 0
      : Math.max(effectiveDividendRate, minDividendPct, parentDividendFloorPct);

    if (
      !imfBailoutActive &&
      payoutDividendRate > 0 &&
      netIncomeBeforeDividends > 0 &&
      corp.shareholders &&
      corp.shareholders.length > 0
    ) {
      const rawDividendPool = netIncomeBeforeDividends * (payoutDividendRate / 100);
      hourlyDividendPayout = Math.min(rawDividendPool, Math.max(0, netIncomeBeforeDividends));
      const totalShares = corp.totalShares ?? 10_000_000;
      for (const sh of corp.shareholders) {
        const share = totalShares > 0 ? sh.shares / totalShares : 0;
        const payment = hourlyDividendPayout * share;
        if (payment > 0) {
          if (sh.characterId) {
            addToPaymentMap(dividendPayments, sh.characterId.toString(), payment, corp.countryId);
          } else if (sh.imperialCharacterId) {
            addToPaymentMap(
              dividendPayments,
              `imperial:${sh.imperialCharacterId.toString()}`,
              payment,
              corp.countryId
            );
          } else if (sh.nppId) {
            addToPaymentMap(
              dividendPayments,
              `npp:${sh.nppId.toString()}`,
              payment,
              corp.countryId
            );
          } else if (sh.fundId) {
            fundDividendAccruals.push({
              fundId: sh.fundId,
              corporationId: corp._id,
              shares: sh.shares,
              amountAnchor: payment,
            });
          } else if (sh.corporationId) {
            const hid = sh.corporationId.toString();
            corpDividendPaymentsAnchorByCorpId.set(
              hid,
              (corpDividendPaymentsAnchorByCorpId.get(hid) ?? 0) + payment
            );
            // Track the same ₳ amount keyed by the paying corp's currency so the
            // recipient's cross-currency FX spread can be charged in Phase 3c.
            const payerCcy = (resolveCorpLiquidCurrencyCode(corp) ?? "USD") as CurrencyCode;
            const byCcy =
              corpDividendPaymentsAnchorByCorpCurrency.get(hid) ?? new Map<CurrencyCode, number>();
            byCcy.set(payerCcy, (byCcy.get(payerCcy) ?? 0) + payment);
            corpDividendPaymentsAnchorByCorpCurrency.set(hid, byCcy);
          }
        }
      }
    }

    // Final income after corporate tax and dividends (bond coupon/interest settle in bond turn)
    let income = afterTaxOperating - hourlyDividendPayout;

    // Operating income per source currency (₳, this turn) for the foreign-income
    // FX spread below. Keyed by the sector country's currency.
    const opIncomeByCcy = new Map<CurrencyCode, number>();
    let totalOpIncomeForCorp = 0;

    // Accumulate annualized operating income by sector country and operating state for
    // the corporate-profits tax-base blend. Uses sectorOpIncome (pre-cost-allocation) so
    // the jurisdiction-level base tracks economic activity in the state/country, not the
    // corp's overhead choices. Matches the apportionment model where federal and state
    // tax both follow sector operating location.
    // See docs/plans/archive/2026-04/2026-04-18-corp-tax-apportionment-design.md.
    for (const s of sectorResults) {
      const sectorOpIncome = s.hourlyRevenue * (s.effectiveMargin / 100);
      if (sectorOpIncome <= 0) continue;
      // Track per-currency operating income (this turn, ₳) for the FX spread.
      const sectorCcy = (COUNTRY_CURRENCY_MAP[s.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
        resolvedHomeCurrency ??
        "USD") as CurrencyCode;
      opIncomeByCcy.set(sectorCcy, (opIncomeByCcy.get(sectorCcy) ?? 0) + sectorOpIncome);
      totalOpIncomeForCorp += sectorOpIncome;
      const annualized = sectorOpIncome * TURNS_PER_YEAR;
      const isDomestic = corp.countryId === s.countryId;
      const countryBucket = isDomestic ? domesticIncomeByCountry : foreignIncomeByCountry;
      const stateBucket = isDomestic
        ? domesticIncomeByOperatingState
        : foreignIncomeByOperatingState;
      countryBucket.set(s.countryId, (countryBucket.get(s.countryId) ?? 0) + annualized);
      stateBucket.set(s.stateId, (stateBucket.get(s.stateId) ?? 0) + annualized);
    }

    // Reduced FX spread on the foreign-currency portion of operating income
    // repatriated into the corp's home currency. Skimmed from `income` BEFORE it
    // credits liquidCapital / feeds credit + snapshots, so a corp can never be
    // pushed negative and downstream metrics stay consistent. Fees (in each
    // source currency) are routed to the CB system in index.ts.
    if (income > 0 && totalOpIncomeForCorp > 0 && resolvedHomeCurrency) {
      let sectorSpreadAnchor = 0;
      for (const [srcCcy, opAnchor] of opIncomeByCcy) {
        if (srcCcy === resolvedHomeCurrency || !(opAnchor > 0)) continue;
        const netForeignAnchor = income * (opAnchor / totalOpIncomeForCorp);
        const feeAnchor = netForeignAnchor * SECTOR_FX_SPREAD;
        if (feeAnchor <= 0) continue;
        sectorSpreadAnchor += feeAnchor;
        const srcRate = lookups.exchangeRatesByCurrency.get(srcCcy) ?? 1;
        const fee = Math.round(feeAnchor * (srcRate > 0 ? srcRate : 1));
        if (fee > 0) {
          sectorFxSpreadFees.push({
            fromCurrency: srcCcy,
            toCurrency: resolvedHomeCurrency as CurrencyCode,
            fee,
          });
        }
      }
      income -= sectorSpreadAnchor;
    }

    totalRevenueGenerated += corpRevenue;
    totalIncomeGenerated += income;

    // Marketing strength accumulation: base 1/turn + 0.5/turn per $100k, with diminishing returns.
    // Thresholds are ₳-calibrated ($100k anchor), so pass the anchor-normalized budget.
    const marketingGrowth = calcMarketingGrowth(
      marketingSettlementEnabled ? hourlyMarketing * TURNS_PER_DAY : marketingBudgetAnchor,
      corp.marketingStrength ?? 0
    );

    // Logistics strength: decays 5%/turn, grows with spending. No diminishing returns —
    // the decay naturally caps accumulation. Same anchor-threshold convention.
    const currentLogisticsStrength = corp.logisticsStrength ?? 0;
    const newLogisticsStrength = calcLogisticsStrengthAfterTurn(
      currentLogisticsStrength,
      logisticsBudgetAnchor
    );
    const logisticsDelta = newLogisticsStrength - currentLogisticsStrength;

    // R&D score: decays 3%/turn, grows with spending. Diminishing returns on stored
    // score above 100 (mirrors marketing). Drives innovation probability and boost magnitude.
    // rdBudgetAnchor was resolved at the top of the per-corp loop so it also
    // flows through the operating-cost deduction (hourlyRd).
    const currentRdScore = corp.rdScore ?? 0;
    // rdDemandFactor (±15%) ties R&D output to technology + consulting demand.
    // moraleFactor (#84, ±15%) rewards paying workers above baseline: happier
    // workers convert R&D spend more efficiently. Neutral when labour is off.
    const avgWageLevel = corpWageWeight > 0 ? corpWageWeighted / corpWageWeight : 1;
    const moraleFactor = rdMoraleFactor(avgWageLevel);
    const newRdScore = calcRdScoreAfterTurn(
      currentRdScore,
      rdBudgetAnchor * rdDemandFactor * moraleFactor
    );
    const rdScoreDelta = newRdScore - currentRdScore;

    // The bulk cash transfer below owns the debit for a filled advertising
    // order. Add back only that buyer's settled accounting expense here so the
    // pre-settlement cash leg is charged exactly once after the transfer lands.
    // With no sellers there is no transfer and the ordinary expense remains.
    const cashIncomeBeforeMarketingSettlement =
      income + (marketingSpendAnchorByBuyerId.has(corpId) ? hourlyMarketing : 0);
    const incomeForBalance = anchorToCorpCapital(
      cashIncomeBeforeMarketingSettlement,
      resolvedHomeCurrency,
      localFxRate
    );

    // Share price is finalized after all corps are processed (iterative cross-holding quotes).
    const totalShares = corp.totalShares ?? 10_000_000;
    const endLiquidAnchor = liquidCapitalAnchor + cashIncomeBeforeMarketingSettlement;
    /** Placeholder until cross-holding iteration writes the real price into corpOps. */
    const placeholderSharePrice = Number.isFinite(corp.sharePrice) ? corp.sharePrice : 0.1;

    // Split escalation decay: reduce by 1 each turn (minimum 0)
    const currentEscalation = corp.splitEscalation ?? 0;
    const newEscalation = Math.max(0, currentEscalation - 1);

    // Credit math lives in ₳: liquidCapital normalized to ₳, plus per-turn income (₳).
    // `fxByCurrency` lets the scorer anchor-normalize bond principal / coupon so
    // debt/equity and interest-coverage ratios compare coherent units.
    const bondList = lookups.bondsByCorpId.get(corp._id.toString()) ?? [];

    const creditPack = computeCorporateCreditAtTurn({
      liquidCapitalAnchor: endLiquidAnchor,
      incomePerTurn: income,
      sectorNpv: corpSectorNPV,
      bonds: bondList,
      corporationId: corp._id,
      currentTurn,
      bondDefaultCreditPenaltyUntilTurn: corp.bondDefaultCreditPenaltyUntilTurn,
      previousCompositeScore: corp.creditCompositeSnapshot ?? undefined,
      fxByCurrency: lookups.exchangeRatesByCurrency,
      ceoOwnershipFraction: ceoOwnershipFraction(corp),
      // Suggestion #62: index-fund ownership earns a one-notch credit upgrade,
      // netted against the insider-concentration downgrade above.
      indexFundOwnershipFraction: indexFundOwnershipFraction(corp),
      isPrivate: corp.isPrivate ?? false,
      // P3a: capitalized build spend is an asset. `computeCorporateCreditAtTurn`
      // grew this leg but no production call site passed it, so a corp that had
      // just paid into a plant still read as having destroyed that equity and
      // got downgraded for investing — the exact failure the parameter exists to
      // prevent. 0 for every pre-P3a corp, so non-plants ratings are unchanged.
      constructionInProgressAnchor: sumCorporateSectorConstructionInProgress(sectors, corp._id),
    });

    // Per-turn escrow funding (escrow mode only): move configured cash from the
    // treasury into the market-making escrow. Both fields are corp-local, so this
    // is a 1:1 local move. The escrow is NOT a share-price valuation input
    // (decoupled 2026-06-07), so funding the escrow lowers liquidCapital and thus
    // the tangible-book floor — it is no longer price-neutral. Only the persisted
    // liquidCapital/escrow need reflect the move here.
    // `incomeForBalance` is the pre-settlement local-currency cash delta used
    // by both this bulk op and the initial snapshot. The settlement pass later
    // applies its delta to both representations before pricing and persistence.
    const escrowFundingMove =
      getShareBuybackMode(corp) === "escrow"
        ? computeEscrowFundingTransfer({
            fundingPerTurn: corp.escrowFundingPerTurn,
            liquidCapital: corp.liquidCapital + incomeForBalance,
          })
        : 0;

    // Capture snapshot for history charts + credit time series
    corpSnapshots.push({
      corpId: corp._id,
      revenue: corpRevenue,
      totalCosts: totalCorpCosts,
      incomePreDividends,
      income,
      perTurnBondCouponIncome,
      perTurnBondInterestExpense,
      perTurnBondDragOnNetIncome,
      liquidCapitalAnchorAfterIncome: endLiquidAnchor,
      dividendPaidPerTurn: hourlyDividendPayout,
      federalTaxPaid: totalFederalTax,
      stateTaxPaid: totalStateTax,
      taxPaidByCountry,
      taxPaidByState,
      taxPaidByCountryDomestic,
      taxPaidByCountryForeign,
      taxPaidByStateDomestic,
      taxPaidByStateForeign,
      marketingStrength: (corp.marketingStrength ?? 0) + marketingGrowth,
      logisticsStrength: Math.round(newLogisticsStrength * 100) / 100,
      rdScore: Math.round(newRdScore * 100) / 100,
      dividendRate: payoutDividendRate,
      // Snapshot mirrors the DB field: home currency post-migration, ₳ pre-migration.
      // Escrow funding leaves the treasury this turn, so reflect it in the snapshot.
      liquidCapital: corp.liquidCapital + incomeForBalance - escrowFundingMove,
      escrowFundingMove,
      escrowBalanceAfter: (corp.shareEscrowBalance ?? 0) + escrowFundingMove,
      actualSharePrice: placeholderSharePrice,
      totalShares,
      sectorNPV: corpSectorNPV,
      creditComposite: creditPack.creditRating.compositeScore,
      creditRating: creditPack.creditRating.rating,
      marginDiagnostic:
        corpRevenue > 0
          ? {
              effectiveMargin: Math.round((diagWeightedMargin / corpRevenue) * 100) / 100,
              commodityInputMod: Math.round((diagWeightedCommodityInput / corpRevenue) * 100) / 100,
              commoditySurplusMod:
                Math.round((diagWeightedCommoditySurplus / corpRevenue) * 100) / 100,
              exportPremiumMod: Math.round((diagWeightedExportPremium / corpRevenue) * 100) / 100,
              macroMod: Math.round((diagWeightedMacro / corpRevenue) * 100) / 100,
              stateMetricsMod: Math.round((diagWeightedStateMetrics / corpRevenue) * 100) / 100,
              legacyStateMetricsMod:
                Math.round((diagWeightedLegacyStateMetrics / corpRevenue) * 100) / 100,
              growthCostRatio: Math.round((diagTotalGrowthCost / corpRevenue) * 10000) / 10000,
              sectorCount: sectors.length,
            }
          : undefined,
    });

    // Push this turn's annualized after-tax income into the rolling history.
    const annualIncomeBase = netIncomeBeforeDividends * TURNS_PER_YEAR;
    const updatedEarningsHistory = pushEarningsHistory(corp.earningsHistory, annualIncomeBase);
    updatedEarningsHistoryByCorpId.set(corpId, updatedEarningsHistory);
    corpGrowthNumerByCorpId.set(corpId, corpGrowthNumer);
    corpGrowthDenomByCorpId.set(corpId, corpGrowthDenom);

    // $inc operates on the DB field directly — must match its denomination.
    // Post-migration corps hold liquidCapital in local currency; `incomeForBalance`
    // (computed above) is the ₳ income converted to local. Escrow funding nets out
    // of liquidCapital and into shareEscrowBalance (escrow mode only).
    corpOps.push({
      updateOne: {
        filter: { _id: corp._id },
        update: {
          $inc: {
            liquidCapital: incomeForBalance - escrowFundingMove,
            ...(escrowFundingMove > 0 ? { shareEscrowBalance: escrowFundingMove } : {}),
            marketingStrength: marketingGrowth,
            logisticsStrength: logisticsDelta,
            rdScore: rdScoreDelta,
          },
          $set: {
            earningsHistory: updatedEarningsHistory,
            sharePrice: placeholderSharePrice,
            splitEscalation: newEscalation,
            countryId: corpCountryId,
            updatedAt: now,
            creditRatingSnapshot: creditPack.creditRating.rating,
            creditCompositeSnapshot: creditPack.creditRating.compositeScore,
            creditSnapshotTurn: currentTurn,
            creditRatingComponents: creditPack.creditRating.components,
            // Ticket #919: `shouldClearDividends` already zeroes THIS turn's payout
            // (see payoutDividendRate above) whenever net income dips negative for a
            // single turn — that's the correct, transient skip. Persisting
            // `dividendRate: 0` here as well permanently overwrote the CEO's chosen
            // policy after just one bad turn, silently and with no notification, so
            // dividends stayed off forever even once the corp turned profitable
            // again. Only an active IMF bailout (which the rate-setting API itself
            // also blocks — see dividends/route.ts) should force-clear the stored rate.
            ...(imfBailoutActive ? { dividendRate: 0, lastDividendChange: now } : {}),
            ...(shouldZeroCeoSalary || imfBailoutActive ? { ceoSalary: 0 } : {}),
          },
        },
      },
    });

    // Track CEO salary payment (uses capped amount, not requested)
    if (actualCeoSalary > 0 && corp.ceoId) {
      if (corp.ceoType === "npp") {
        // NPP CEOs accumulate salary in their funds field
        const nppId = corp.ceoId.toString();
        addToPaymentMap(dividendPayments, `npp:${nppId}`, actualCeoSalary, corp.countryId);
      } else {
        const key =
          corp.ceoType === "imperial" ? `imperial:${corp.ceoId.toString()}` : corp.ceoId.toString();
        addToPaymentMap(ceoSalaryPayments, key, actualCeoSalary, corp.countryId);
      }
    }
  }

  // Route only the clearing value of delivered advertising. Buyer shares are
  // already capped above, so unfilled budget remains in treasury. Pair legs
  // stay unrounded until every corporation's transfers have been aggregated,
  // preventing small buyers from losing every sub-unit seller allocation.
  if (marketingSpendAnchorByBuyerId.size > 0 && totalAdvertisingDeliveredValueAnchor > 0) {
    const marketingDeltasLocal = new Map<string, number>();
    const corpInfo = (corpId: string): SettleCorpInfo | undefined => {
      const corp = lookups.corpById.get(corpId);
      if (!corp) return undefined;
      return {
        _id: corp._id,
        name: corp.name,
        ccy: resolveCorpLiquidCurrencyCode(corp),
        fxRate: fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency),
      };
    };
    for (const [buyerId, spendAnchor] of marketingSpendAnchorByBuyerId) {
      const buyer = corpInfo(buyerId);
      if (!buyer) continue;
      let allocatedAnchor = 0;
      for (let i = 0; i < advertisingSellerDeliveredValues.length; i++) {
        const [sellerId, deliveredValueAnchor] = advertisingSellerDeliveredValues[i];
        const seller = corpInfo(sellerId);
        if (!seller) continue;
        const amountAnchor =
          i === advertisingSellerDeliveredValues.length - 1
            ? spendAnchor - allocatedAnchor
            : spendAnchor * (deliveredValueAnchor / totalAdvertisingDeliveredValueAnchor);
        allocatedAnchor += amountAnchor;
        addCorpToCorpSettlement(
          marketingDeltasLocal,
          buyerId,
          buyer,
          sellerId,
          seller,
          amountAnchor
        );
      }
    }
    // Net the settled advertising out of each seller's CASH leg. The seller
    // already booked this advertising as ordinary sector revenue, so income and
    // tax keep it; crediting the transfer receipt ON TOP double-pays it in cash
    // (once through revenue → liquidCapital, once through this settlement). This
    // mirrors the buyer's cost add-back above, which defers the marketing DEBIT
    // to this same transfer so the cost lands exactly once: here we defer the
    // seller's advertising CREDIT the same way, removing its delivered value
    // from cash so the transfer receipt is its only ad cash. When budgets fund
    // the delivered book the receipt equals the delivered value and the two
    // cancel (money conserved); a funding shortfall (delivered > funded) leaves
    // the unpaid remainder as bad debt on the seller, never minted cash.
    for (const [sellerId, deliveredValueAnchor] of advertisingSellerDeliveredValues) {
      const seller = corpInfo(sellerId);
      if (!seller) continue;
      const deliveredLocal = anchorToCorpCapital(deliveredValueAnchor, seller.ccy, seller.fxRate);
      if (!Number.isFinite(deliveredLocal)) continue;
      marketingDeltasLocal.set(
        sellerId,
        (marketingDeltasLocal.get(sellerId) ?? 0) - deliveredLocal
      );
    }
    for (let i = 0; i < lookups.corporations.length; i++) {
      const delta = marketingDeltasLocal.get(lookups.corporations[i]._id.toString()) ?? 0;
      if (delta === 0) continue;
      const corp = lookups.corporations[i];
      const update = corpOps[i].updateOne.update;
      update.$inc.liquidCapital = (update.$inc.liquidCapital ?? 0) + delta;

      // History, credit, and the tangible-book floor must see the same final
      // treasury as the bulk write, for both payer debits and seller receipts.
      const snapshot = corpSnapshots[i];
      const code = resolveCorpLiquidCurrencyCode(corp);
      const rate = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);
      snapshot.liquidCapital += delta;
      snapshot.liquidCapitalAnchorAfterIncome += corpCapitalToAnchor(delta, code, rate);

      const creditPack = computeCorporateCreditAtTurn({
        liquidCapitalAnchor: snapshot.liquidCapitalAnchorAfterIncome,
        incomePerTurn: snapshot.income,
        sectorNpv: snapshot.sectorNPV,
        bonds: lookups.bondsByCorpId.get(corp._id.toString()) ?? [],
        corporationId: corp._id,
        currentTurn,
        bondDefaultCreditPenaltyUntilTurn: corp.bondDefaultCreditPenaltyUntilTurn,
        previousCompositeScore: corp.creditCompositeSnapshot ?? undefined,
        fxByCurrency: lookups.exchangeRatesByCurrency,
        ceoOwnershipFraction: ceoOwnershipFraction(corp),
        indexFundOwnershipFraction: indexFundOwnershipFraction(corp),
        isPrivate: corp.isPrivate ?? false,
        constructionInProgressAnchor: sumCorporateSectorConstructionInProgress(
          lookups.sectorsByCorp.get(corp._id.toString()) ?? [],
          corp._id
        ),
      });
      snapshot.creditComposite = creditPack.creditRating.compositeScore;
      snapshot.creditRating = creditPack.creditRating.rating;
      update.$set.creditRatingSnapshot = creditPack.creditRating.rating;
      update.$set.creditCompositeSnapshot = creditPack.creditRating.compositeScore;
      update.$set.creditRatingComponents = creditPack.creditRating.components;
    }
  }

  const lenderReceiptsAnchorByCorpId = new Map<string, number>();
  for (let i = 0; i < lookups.corporations.length; i++) {
    const corp = lookups.corporations[i];
    const snap = corpSnapshots[i];
    if (!corp.imfBailoutActive || !corp.imfBailoutImfCorporationId) continue;
    const pay = imfFacilityPaymentAnchorPerTurn(corp, snap.income);
    if (pay <= 1e-9) continue;
    const lid = corp.imfBailoutImfCorporationId.toString();
    lenderReceiptsAnchorByCorpId.set(lid, (lenderReceiptsAnchorByCorpId.get(lid) ?? 0) + pay);
  }

  // Build equity-adjusted earnings map via a single forward pass (no circular iteration).
  // Cross-corp holdings contribute proportional BASE earnings; the adjusted values are
  // only used for the share-price formula, not re-fed into each other.
  const baseEarningsMap = new Map<string, number>();
  for (const [cId, history] of updatedEarningsHistoryByCorpId) {
    baseEarningsMap.set(cId, normalizedEarningsFromHistory(history));
  }
  const totalSharesById = new Map<string, number>(
    lookups.corporations.map((c) => [c._id.toString(), c.totalShares ?? 10_000_000])
  );
  const adjustedEarningsMap = applyEquityMethodEarnings(
    baseEarningsMap,
    lookups.crossCorpStockHoldingsByHolderCorpId,
    totalSharesById
  );

  // Build per-corp inputs for the three-component fundamental formula.
  // Currency note: the formula operates ENTIRELY in ₳ — previousSharePrice is
  // normalized to ₳ on the way in, and finalPrices comes back in ₳;
  // re-denominate to home currency only at the persistence boundary below.
  const sharePriceInputs: SharePriceInput[] = lookups.corporations.map((corp, i) => {
    const s = corpSnapshots[i];
    const id = corp._id.toString();
    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);
    const corpPrimeRate =
      (lookups.primeRateByCountry.get(corp.countryId) ??
        getCountryConfig(corp.countryId).centralBank.defaultPrimeRate) / 100;
    const riskPremium = SECTOR_RISK_PREMIUM[corp.type as string] ?? SECTOR_RISK_PREMIUM.default;
    const growthNumer = corpGrowthNumerByCorpId.get(id) ?? 0;
    const growthDenom = corpGrowthDenomByCorpId.get(id) ?? 0;
    // `shareIssuanceProceeds` tracks cash the corp has realized from selling its
    // OWN shares out of the public float (incremented on float buys, decremented
    // on float sells; issuance itself no longer moves it — Bug #0624). Exclude it
    // from the tangible-book numerator so realized issuance proceeds don't prop up
    // the book-value floor and dilution genuinely reduces share price — the cash is
    // still available for operations, just not for the floor. The field may run
    // negative (float sold back for more than was realized); `Math.max(0, …)` below
    // bounds the effect, so a negative value only raises the floor toward true
    // liquidCapital, which is benign.
    const issuanceProceedsAnchor = corpCapitalToAnchor(corp.shareIssuanceProceeds ?? 0, code, rate);
    return {
      corpId: id,
      liquidCapitalAnchor: Math.max(0, s.liquidCapitalAnchorAfterIncome - issuanceProceedsAnchor),
      sectorNPVAnchor: s.sectorNPV,
      issuedBondDebt: lookups.issuedBondDebtByCorpId.get(id) ?? 0,
      bondHoldingsAnchor: lookups.bondAndImfPortfolioAnchorByCorpId.get(id) ?? 0,
      normalizedEarningsAnchor: adjustedEarningsMap.get(id) ?? 0,
      // Annualised bond-coupon income (snapshot value is per-turn ₳).
      bondCouponEarningsAnchor: Math.max(0, s.perTurnBondCouponIncome) * TURNS_PER_YEAR,
      // Annualised issuer-side interest, same per-turn ₳ source: nets against
      // coupons so leveraged operators are not priced as bond funds.
      bondInterestExpenseAnchor: Math.max(0, s.perTurnBondDragOnNetIncome) * TURNS_PER_YEAR,
      sectorGrowthRate: growthDenom > 0 ? growthNumer / growthDenom : 0,
      costOfCapital: corpPrimeRate + riskPremium,
      totalShares: s.totalShares,
      previousSharePrice: readCorpEconomicAnchor(corp.sharePrice ?? 0.1, code, rate),
      imfBailoutActive: corp.imfBailoutActive === true,
      lastShareStructureTurn: corp.lastShareStructureTurn ?? null,
      ceoOwnershipFraction: ceoOwnershipFraction(corp),
      // Suggestion #62: index-fund ownership earns a bounded price premium.
      indexFundOwnershipFraction: indexFundOwnershipFraction(corp),
      isPrivate: corp.isPrivate ?? false,
      techAssetValueAnchor: computeTechAssetValueAnchor(corp, currentYear),
    };
  });

  const finalPrices = computeSharePrices(sharePriceInputs, currentTurn);

  for (let i = 0; i < lookups.corporations.length; i++) {
    const corp = lookups.corporations[i];
    const s = corpSnapshots[i];
    const id = corp._id.toString();
    // finalPrices is anchor-denominated; convert to the corp's home currency
    // for DB persistence and the CorpSnapshot mirror that downstream snapshot
    // writers (marketCapSnapshot.ts) consume.
    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);
    const priceAnchor =
      finalPrices.get(id) ?? readCorpEconomicAnchor(corp.sharePrice ?? 0.1, code, rate);
    const priceLocal = writeCorpEconomicLocal(priceAnchor, code, rate);
    s.actualSharePrice = priceLocal;
    const op = corpOps[i] as {
      updateOne: { update: { $set?: Record<string, unknown> } };
    };
    if (op.updateOne.update.$set) {
      op.updateOne.update.$set.sharePrice = priceLocal;
      op.updateOne.update.$set.fundamentalSharePrice = priceLocal;
    }
  }

  return {
    sectorOps,
    corpOps: corpOps as AnyBulkWriteOperation<Corporation>[],
    corpSnapshots,
    ceoSalaryPayments,
    dividendPayments,
    corpDividendPaymentsAnchorByCorpId,
    corpDividendPaymentsAnchorByCorpCurrency,
    sectorFxSpreadFees,
    fundDividendAccruals,
    domesticIncomeByCountry,
    foreignIncomeByCountry,
    domesticIncomeByOperatingState,
    foreignIncomeByOperatingState,
    growthInvestmentByOperatingState,
    totalRevenueGenerated,
    totalIncomeGenerated,
    sectorsProcessed,
    profitMarginByCorpId,
    labourWageIndexByState: new Map(
      Array.from(wageIndexByState, ([stateId, acc]) => [stateId, resolveWageIndex(acc)])
    ),
    automationIndexByState: new Map(
      Array.from(automationIndexByState, ([stateId, acc]) => [stateId, resolveAutomationIndex(acc)])
    ),
    labourDemandByState,
    labourDemandWageIndexByState: new Map(
      Array.from(labourDemandWageIndexByState, ([stateId, acc]) => [stateId, resolveWageIndex(acc)])
    ),
    strikeEvents: pendingStrikeEvents,
    capacityBindingEvents: pendingCapacityBindingEvents,
  };
}
