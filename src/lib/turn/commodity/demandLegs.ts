import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { Bond, Corporation, FederalBudget, StateBudget, StateMetrics } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import type { CommodityPrice } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { MONETARY_BASELINES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  COMMODITY_TYPES,
  DEMOGRAPHIC_CONSUMER_COMMODITIES,
  DEMOGRAPHIC_UPLIFT_PCT,
  FINANCIAL_NEUTRAL_RATE,
  FINANCIAL_RATE_GDP_FRACTION,
  FOOD_RATE_GDP_FRACTION,
  GOVT_SPEND_CATEGORY_ALIASES,
  MARKETING_ADVERTISING_DEMAND_ELASTICITY,
  MARKETING_ADVERTISING_DEMAND_RATE,
  MARKETING_ADVERTISING_REFERENCE_BUDGETS_ANCHOR,
  VEHICLE_RATE_GDP_FRACTION,
  computeLatentFinancialDemand,
  countryCommodityDemandMultiplier,
  demographicWealthMultiplier,
  govtSpendForCategory,
  type CommodityType,
} from "@/lib/constants/commodities";
import {
  computeHouseholdConsumption,
  type HouseholdStateSignals,
} from "@/lib/turn/householdConsumption";
import { distributeDemandToStates } from "@/lib/market/distributeDemandToStates";
import { GOVERNMENT_COMMODITY_DEMAND } from "@/lib/market/governmentCommodityDemand";
import { commodityDemandCalibration } from "@/lib/constants/commodityDemandCalibration";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { CountryLedger, GlobalLedger, StateLedger } from "./ledgerTypes";

/** Fresh zeroed per-commodity balance map for a state seen the first time. */
export function ensureStateLedger(byState: StateLedger, stateId: string) {
  let stateMap = byState.get(stateId);
  if (!stateMap) {
    stateMap = new Map<CommodityType, { supply: number; demand: number }>();
    for (const c of COMMODITY_TYPES) stateMap.set(c, { supply: 0, demand: 0 });
    byState.set(stateId, stateMap);
  }
  return stateMap;
}

export interface AdvertisingDemandInputs {
  allCorporations: Corporation[];
  currencyByCorpId: Map<string, { code: CurrencyCode | undefined; rate: number }>;
  advertisingBasePrice: number;
}

/**
 * Corporate marketing budgets add demand to the advertising commodity.
 * Each $1 of daily marketing budget contributes
 * MARKETING_ADVERTISING_DEMAND_RATE / basePrice campaign-units of demand,
 * distributed to the corporation's HQ state. Budgets are ₳-normalized, capped
 * by what the current treasury can fund for the next turn, and converted with
 * a sublinear economy-wide damping factor (1 when nothing is funded).
 */
export function applyAdvertisingDemand(
  inputs: AdvertisingDemandInputs,
  global: GlobalLedger,
  byState: StateLedger
): void {
  const { allCorporations, currencyByCorpId, advertisingBasePrice } = inputs;
  const fundedAdvertisingBudgets: Array<{ stateId: string; fundedAnchor: number }> = [];
  let totalFundedBudgetsAnchor = 0;
  for (const corp of allCorporations) {
    const budgetLocal = corp.marketingBudget ?? 0;
    if (budgetLocal <= 0 || !corp.headquartersState) continue;
    const fx = currencyByCorpId.get(corp._id.toString());
    const budgetAnchor = readCorpEconomicAnchor(budgetLocal, fx?.code, fx?.rate ?? 1);
    // Demand is a daily flow, while settlement charges one twenty-fourth each
    // turn. A corporation may therefore book at most the daily budget its
    // current treasury can cover for the next turn. Anything beyond that is
    // unfunded intent, not advertising demand.
    const liquidCapitalAnchor = readCorpEconomicAnchor(
      Number.isFinite(corp.liquidCapital) ? corp.liquidCapital : 0,
      fx?.code,
      fx?.rate ?? 1
    );
    const fundedBudgetAnchor = Math.min(
      budgetAnchor,
      Math.max(0, liquidCapitalAnchor) * TURNS_PER_DAY
    );
    if (!(fundedBudgetAnchor > 0)) continue;
    fundedAdvertisingBudgets.push({
      stateId: corp.headquartersState,
      fundedAnchor: fundedBudgetAnchor,
    });
    totalFundedBudgetsAnchor += fundedBudgetAnchor;
  }
  const advertisingDemandFactor =
    totalFundedBudgetsAnchor > 0
      ? Math.pow(
          totalFundedBudgetsAnchor / MARKETING_ADVERTISING_REFERENCE_BUDGETS_ANCHOR,
          MARKETING_ADVERTISING_DEMAND_ELASTICITY - 1
        )
      : 1;
  const effectiveAdvertisingRate = MARKETING_ADVERTISING_DEMAND_RATE * advertisingDemandFactor;
  for (const { stateId, fundedAnchor } of fundedAdvertisingBudgets) {
    const units = (fundedAnchor * effectiveAdvertisingRate) / advertisingBasePrice;

    // Add to global
    const advertisingBal = global.get("advertising")!;
    advertisingBal.demand += units;

    // Distribute to HQ state so state-level margins reflect real demand
    ensureStateLedger(byState, stateId).get("advertising")!.demand += units;
  }
}

/**
 * Demographics as a 4th demand source: income demographics consume every
 * commodity EXCEPT raw extractables as a proportional uplift of existing
 * demand, scaling with population and wealth. Shock-free by construction.
 */
export function applyDemographicsUplift(
  allStates: Pick<State, "_id" | "gdp" | "population">[],
  global: GlobalLedger,
  byState: StateLedger
): void {
  const stateById = new Map(allStates.map((s) => [s._id, s]));
  for (const [stateId, stateMap] of byState) {
    const st = stateById.get(stateId);
    const population = st?.population ?? 0;
    const gdp = st?.gdp ?? 0;
    if (population <= 0) continue;
    const wealthMult = demographicWealthMultiplier(gdp, population);
    for (const commodity of DEMOGRAPHIC_CONSUMER_COMMODITIES) {
      const bal = stateMap.get(commodity);
      const existing = bal?.demand ?? 0;
      if (existing <= 0) continue;
      // Proportional uplift of existing demand — shock-free, and scales with
      // population/GDP (existing demand does) plus wealth (richer consume more).
      const uplift = existing * DEMOGRAPHIC_UPLIFT_PCT * wealthMult;
      if (uplift <= 0) continue;
      bal!.demand += uplift;
      global.get(commodity)!.demand += uplift;
    }
  }
}

export interface HouseholdSignalInputs {
  allStateMetrics: StateMetrics[];
  existingPrices: CommodityPrice[];
}

/** Per-state household signals + prior-turn price/supply anchors. */
export function collectHouseholdSignals(inputs: HouseholdSignalInputs): {
  metricsByState: Map<string, HouseholdStateSignals>;
  priorGlobalPrice: Map<CommodityType, number>;
  priorGlobalSupply: Map<CommodityType, number>;
} {
  const metricsByState = new Map<string, HouseholdStateSignals>();
  for (const m of inputs.allStateMetrics) {
    const econ = m.economic;
    if (!econ) continue;
    metricsByState.set(String(m._id), {
      medianIncome: econ.medianIncome?.value,
      unemploymentRate: econ.unemploymentRate?.value,
      consumerConfidence: econ.consumerConfidence?.value,
    });
  }
  const priorGlobalPrice = new Map<CommodityType, number>();
  const priorGlobalSupply = new Map<CommodityType, number>();
  for (const p of inputs.existingPrices) {
    if (typeof p.globalPrice === "number" && p.globalPrice > 0) {
      priorGlobalPrice.set(p.commodity as CommodityType, p.globalPrice);
    }
    if (typeof p.globalSupply === "number" && p.globalSupply > 0) {
      priorGlobalSupply.set(p.commodity as CommodityType, p.globalSupply);
    }
  }
  return { metricsByState, priorGlobalPrice, priorGlobalSupply };
}

export interface HouseholdDemandInputs {
  eraUnitScale: number;
  plantsUnitScale: number;
  priorGlobalSupply?: Map<CommodityType, number>;
  states: { stateId: string; countryId: string; gdp: number; population: number }[];
  metricsByState: Map<string, HouseholdStateSignals>;
  priorGlobalPrice: Map<CommodityType, number>;
  perCapita?: number;
}

/**
 * Income-driven final consumer demand: turns per-state household signals
 * into consumer-basket demand with a bounded price-elasticity response.
 * When on, retail's SECTOR_DEMAND input proxy is suppressed upstream (the
 * basket owns those legs); the retail OUTPUT self-loop stays. Supersedes the
 * demographics uplift — do not run both.
 */
export function applyHouseholdDemand(
  inputs: HouseholdDemandInputs,
  global: GlobalLedger,
  byState: StateLedger,
  demandTruncated: Map<CommodityType, number>
): void {
  const household = computeHouseholdConsumption({
    eraUnitScale: inputs.eraUnitScale,
    // Plants worlds: re-anchor household demand onto the physical unit basis
    // plants supply uses, clamped per commodity against prior supply. Legacy
    // worlds pass 1/undefined and are byte-identical (ticket #1027).
    plantsUnitScale: inputs.plantsUnitScale,
    priorGlobalSupply: inputs.priorGlobalSupply,
    states: inputs.states,
    metricsByState: inputs.metricsByState,
    priorGlobalPrice: inputs.priorGlobalPrice,
    perCapita: inputs.perCapita,
  });
  for (const [commodity, units] of household.global) {
    const g = global.get(commodity);
    if (g) g.demand += units;
  }
  for (const [commodity, units] of household.truncated) {
    demandTruncated.set(commodity, (demandTruncated.get(commodity) ?? 0) + units);
  }
  for (const [stateId, contrib] of household.byState) {
    const stateMap = ensureStateLedger(byState, stateId);
    for (const [commodity, units] of contrib) {
      const bal = stateMap.get(commodity);
      if (bal) bal.demand += units;
    }
  }
}

/**
 * countryId -> (stateId -> gdp). Shared by latent financial demand
 * (sovereign issuance allocation) and government regional distribution.
 * Built once per turn from the same states snapshot.
 */
export function buildStatesByCountry(
  allStates: Pick<State, "_id" | "countryId" | "gdp">[]
): Map<string, Map<string, number>> {
  const statesByCountry = new Map<string, Map<string, number>>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    if (!state.gdp || state.gdp <= 0) continue;
    const countryId = state.countryId;
    if (!statesByCountry.has(countryId)) {
      statesByCountry.set(countryId, new Map());
    }
    statesByCountry.get(countryId)!.set(state._id, state.gdp);
  }
  return statesByCountry;
}

export interface LatentFinancialDemandInputs {
  statesByCountry: Map<string, Map<string, number>>;
  allCorporations: Corporation[];
  recentBonds: Bond[];
  centralBankByCountry: Map<string, number>;
}

/**
 * Latent financial services demand from rate environment + debt issuance.
 * Financial demand follows bond-market activity instead of raw GDP: sovereign
 * issuance is allocated pro-rata by state GDP, corporate issuance books to
 * the issuer's HQ state.
 */
export function applyLatentFinancialDemand(
  inputs: LatentFinancialDemandInputs,
  global: GlobalLedger,
  byState: StateLedger
): void {
  const { statesByCountry, allCorporations, recentBonds, centralBankByCountry } = inputs;

  const corporateHqById = new Map(
    allCorporations.map((corporation: Corporation) => [
      corporation._id.toString(),
      corporation.headquartersState,
    ])
  );
  const corporateCountryById = new Map(
    allCorporations.map((corporation: Corporation) => [
      corporation._id.toString(),
      corporation.countryId,
    ])
  );
  const stateDebtIssuanceByCountry = new Map<string, Map<string, number>>();

  for (const bond of recentBonds) {
    if (bond.issuerType === "sovereign" && bond.countryId) {
      const stateGdp = statesByCountry.get(bond.countryId);
      if (!stateGdp || stateGdp.size === 0) continue;
      const countryTotalGdp = [...stateGdp.values()].reduce((sum, value) => sum + value, 0);
      if (countryTotalGdp <= 0) continue;

      if (!stateDebtIssuanceByCountry.has(bond.countryId)) {
        stateDebtIssuanceByCountry.set(bond.countryId, new Map());
      }
      const issuanceByState = stateDebtIssuanceByCountry.get(bond.countryId)!;
      for (const [stateId, gdp] of stateGdp) {
        const allocation = bond.totalIssued * (gdp / countryTotalGdp);
        issuanceByState.set(stateId, (issuanceByState.get(stateId) ?? 0) + allocation);
      }
      continue;
    }

    const hqState = corporateHqById.get(bond.corporationId.toString());
    if (!hqState) continue;
    const countryId = corporateCountryById.get(bond.corporationId.toString());
    if (!countryId) continue;
    if (!stateDebtIssuanceByCountry.has(countryId)) {
      stateDebtIssuanceByCountry.set(countryId, new Map());
    }
    const issuanceByState = stateDebtIssuanceByCountry.get(countryId)!;
    issuanceByState.set(hqState, (issuanceByState.get(hqState) ?? 0) + bond.totalIssued);
  }

  for (const [countryId, stateDebtIssuance] of stateDebtIssuanceByCountry) {
    const primeRate = centralBankByCountry.get(countryId);
    if (primeRate === undefined) continue;

    const latentDemand = computeLatentFinancialDemand({
      primeRate,
      stateDebtIssuance,
    });

    for (const [stateId, units] of latentDemand) {
      // Add to global financial_services demand
      const g = global.get("financial_services")!;
      g.demand += units;

      // Add to state-level financial_services demand
      ensureStateLedger(byState, stateId).get("financial_services")!.demand += units;
    }
  }
}

export interface RateSensitiveDemandInputs {
  allStateBudgets: StateBudget[];
  stateToCountry: Map<string, string>;
  fxRateForCountry: (countryId: string | undefined) => number;
  centralBankByCountry: Map<string, number>;
  ledgerBasePrices: Record<CommodityType, number>;
}

/**
 * Rate-sensitive signed delta demand: food, vehicles, financial_services.
 * delta = anchorGdp x fraction x (neutral - primeRate) / basePrice. Positive
 * at low rates; floored at zero at high rates instead of subtracting demand
 * (a demand generator must never un-buy goods).
 */
export function applyRateSensitiveDemand(
  inputs: RateSensitiveDemandInputs,
  global: GlobalLedger,
  byState: StateLedger
): void {
  const {
    allStateBudgets,
    stateToCountry,
    fxRateForCountry,
    centralBankByCountry,
    ledgerBasePrices,
  } = inputs;
  const anchorGdpByState = new Map<string, number>();
  for (const sb of allStateBudgets) {
    if (!sb.stateGdp || sb.stateGdp <= 0) continue;
    const countryId = stateToCountry.get(sb.stateId);
    if (!countryId) continue;
    const fxRate = fxRateForCountry(countryId);
    anchorGdpByState.set(sb.stateId, sb.stateGdp / fxRate);
  }

  const rateDemandCommodities: Array<{ commodity: CommodityType; fraction: number }> = [
    { commodity: "food", fraction: FOOD_RATE_GDP_FRACTION },
    { commodity: "vehicles", fraction: VEHICLE_RATE_GDP_FRACTION },
    { commodity: "financial_services", fraction: FINANCIAL_RATE_GDP_FRACTION },
  ];

  for (const { commodity, fraction } of rateDemandCommodities) {
    const basePrice = ledgerBasePrices[commodity];
    const globalBal = global.get(commodity)!;

    for (const [stateId, anchorGdp] of anchorGdpByState) {
      const countryId = stateToCountry.get(stateId);
      if (!countryId) continue;
      const primeRate = centralBankByCountry.get(countryId) ?? FINANCIAL_NEUTRAL_RATE;
      const neutralRate =
        MONETARY_BASELINES[countryId as CountryId]?.neutralPrimeRate ?? FINANCIAL_NEUTRAL_RATE;
      const delta = Math.max(0, (anchorGdp * fraction * (neutralRate - primeRate)) / basePrice);
      if (delta === 0) continue;

      globalBal.demand += delta;
      ensureStateLedger(byState, stateId).get(commodity)!.demand += delta;
    }
  }
}

/**
 * National (country-aggregate) commodity balances from the state books.
 * Sector-allocated S/D (including advertising, latent financial). Healthcare
 * govt demand is applied after this block so it can be attributed per
 * country. Aggregated national balances feed inflationRecalc as a cost-push
 * signal.
 */
export function aggregateByCountry(
  byState: StateLedger,
  stateToCountry: Map<string, string>
): CountryLedger {
  const byCountry: CountryLedger = new Map();
  for (const [stateId, stateMap] of byState) {
    const countryId = stateToCountry.get(stateId);
    if (!countryId) continue;
    if (!byCountry.has(countryId)) {
      const countryBals = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of COMMODITY_TYPES) countryBals.set(c, { supply: 0, demand: 0 });
      byCountry.set(countryId, countryBals);
    }
    const countryBals = byCountry.get(countryId)!;
    for (const c of COMMODITY_TYPES) {
      const stateBal = stateMap.get(c)!;
      const countryBal = countryBals.get(c)!;
      countryBal.supply += stateBal.supply;
      // Per-country national demand uplift for command economies whose seeded
      // downstream capacity has no reachable buyer (ticket-1072). Pure lookup
      // defaulting to 1, applied ONLY to this national leg — the global book
      // is untouched — so market economies and unlisted (country, commodity)
      // pairs are byte-identical.
      countryBal.demand += stateBal.demand * countryCommodityDemandMultiplier(countryId, c);
    }
  }
  return byCountry;
}

export interface GovernmentDemandInputs {
  federalBudgets: FederalBudget[];
  ledgerBasePrices: Record<CommodityType, number>;
  fxRateForCountry: (countryId: string | undefined) => number;
  ledgerCurrentYear: number | null;
  ledgerCommandEconomyEnabled: boolean;
  statesByCountry: Map<string, Map<string, number>>;
  stateToCountry: Map<string, string>;
  turnsPerYear?: number;
}

/**
 * Government spending -> commodity demand. National budgets add demand
 * globally and per country so national S/D matches macro for state price
 * regional legs and nationalPrices. Spending is stored in local currency and
 * normalized to ₳ before computing units. The same units also reach the
 * REGIONAL books (pro-rata by state GDP), so the 25% state price leg stops
 * understating exactly the goods governments support.
 */
export function applyGovernmentDemand(
  inputs: GovernmentDemandInputs,
  global: GlobalLedger,
  byCountry: CountryLedger,
  byState: StateLedger
): void {
  const {
    federalBudgets,
    ledgerBasePrices,
    fxRateForCountry,
    ledgerCurrentYear,
    ledgerCommandEconomyEnabled,
    statesByCountry,
    stateToCountry,
  } = inputs;
  const turnsPerYear = inputs.turnsPerYear ?? 48;
  for (const { category, commodity, rate, plannedOnly, regional } of GOVERNMENT_COMMODITY_DEMAND) {
    const basePrice = ledgerBasePrices[commodity];
    const aliases = GOVT_SPEND_CATEGORY_ALIASES[category] ?? [category];
    for (const budget of federalBudgets) {
      if (
        plannedOnly &&
        !isPlannedEconomy(budget.countryId, ledgerCurrentYear, ledgerCommandEconomyEnabled)
      ) {
        continue;
      }
      const annualSpendLocal = govtSpendForCategory(budget.spending?.byCategory, aliases);
      if (annualSpendLocal <= 0) continue;
      const cid = budget.countryId;
      const annualSpendAnchor = annualSpendLocal / fxRateForCountry(cid);
      const units = (annualSpendAnchor / turnsPerYear / basePrice) * rate;
      if (units <= 0) continue;
      global.get(commodity)!.demand += units;
      if (!cid) continue;
      if (!byCountry.has(cid)) {
        const countryBals = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) countryBals.set(c, { supply: 0, demand: 0 });
        byCountry.set(cid, countryBals);
      }
      byCountry.get(cid)!.get(commodity)!.demand += units;
      if (regional) {
        distributeDemandToStates({
          countryId: cid,
          commodity,
          units,
          statesByCountry,
          stateToCountry,
          byState,
        });
      }
    }
  }
}

export interface DemandCalibrationInputs {
  activePreset: string;
}

/**
 * Era-aware demand calibration, applied once after every demand generator
 * has contributed and before any price is computed, so the global, national
 * and regional legs and the commodityFlows record all see the same corrected
 * figure. Inert (1.0) for every era except 1953.
 */
export function applyDemandCalibration(
  inputs: DemandCalibrationInputs,
  global: GlobalLedger,
  byCountry: CountryLedger,
  byState: StateLedger
): void {
  const calibrationEra = eraForPreset(inputs.activePreset);
  for (const commodity of COMMODITY_TYPES) {
    const mult = commodityDemandCalibration(calibrationEra, commodity);
    if (mult === 1) continue;
    const g = global.get(commodity);
    if (g) g.demand *= mult;
    for (const byCommodity of byCountry.values()) {
      const bal = byCommodity.get(commodity);
      if (bal) bal.demand *= mult;
    }
    for (const byCommodity of byState.values()) {
      const bal = byCommodity.get(commodity);
      if (bal) bal.demand *= mult;
    }
  }
}
