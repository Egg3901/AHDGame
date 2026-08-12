/**
 * Commodity supply/demand rows and market-system panel sections for the
 * sector detail query. Extracted verbatim from sectorDetail.ts (pure code
 * motion; no behavior change).
 */
import { buildMarketContext } from "@/lib/market/marketContext";
import { getMarketSystemMode } from "@/lib/market/featureFlag";
import { computeThroughput, inputAvailability } from "@/lib/market/throughput";
import { CAPITAL_DEPRECIATION_PER_TURN, impliedOutputUnits } from "@/lib/market/capital";
import { computePriceRealization, priceRealizationFactor } from "@/lib/market/priceRealization";
import type { CommodityPrice, CorporateSector, Corporation } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  COMMODITY_LABELS,
  COMMODITY_ICONS,
  COMMODITY_COLORS,
  COMMODITY_BASE_PRICES,
  COMMODITY_UNITS,
  COMMODITY_LOG_K,
  COMMODITY_PER_ITEM_CAP,
  RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR,
  dollarsToUnits,
  computeCommodityPressureRatio,
  computeEffectiveCommodityPressureRatio,
  STATE_COMMODITY_SUPPLY_DEMAND,
  EXTRACTABLE_RESOURCES,
} from "@/lib/constants/commodities";
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import type { EffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";

type CommodityBalance = { supply: number; demand: number };

export function perUnitAnchorAmount(amountAnchor: number | null, units: number): number | null {
  return amountAnchor != null && units > 0 ? amountAnchor / units : null;
}

export function computeCapitalUsage(
  stock: number | null,
  impliedUnits: number
): { utilization: number | null; capacityUsed: number | null } {
  if (stock == null) return { utilization: null, capacityUsed: null };
  if (stock <= 0) return { utilization: 0, capacityUsed: 0 };
  return {
    utilization: Math.min(1, Math.max(0, impliedUnits) / stock),
    capacityUsed: Math.min(stock, Math.max(0, impliedUnits)),
  };
}

/**
 * Build the supplies/demands rows and the price-realization, pricing,
 * capital, and throughput sections for a sector. Reads the market-system
 * mode (one gameConfig read) at the same point the inline code did.
 */
export async function buildSectorCommoditySections(args: {
  sector: CorporateSector;
  /**
   * The sector's revenue normalized to ₳ at its HOST-state rate. Commodity flows
   * (`* rate`, `impliedOutputUnits`, depreciation) run in ₳ — the unit
   * COMMODITY_BASE_PRICES use — so callers pass the ₳-normalized revenue rather
   * than the raw host-currency `sector.revenue`.
   */
  sectorRevenueAnchor: number;
  /** Persisted daily labour cost normalized to ₳, matching sectorRevenueAnchor. */
  sectorLaborCostAnchor: number | null;
  sectorType: CorporationType;
  sectorCountryId: string;
  /** The world's era unit-basis scale (`getEraUnitScale(preset)`). */
  eraUnitScale: number;
  corporation: Corporation;
  isCeo: boolean;
  commodityPrices: CommodityPrice[];
  globalBalances: Map<CommodityType, CommodityBalance>;
  nationalBalancesByCountry: Map<string, Map<CommodityType, CommodityBalance>>;
  stateBalances: Map<CommodityType, CommodityBalance>;
  tariffBlend: { globalWeight: number; nationalWeight: number; localWeight: number };
  effectiveRates: EffectiveStrategyRates;
  stateResources: Partial<Record<ExtractableResource, number>> | null | undefined;
  thisSectorMultipliers: Partial<Record<ExtractableResource, number>>;
}) {
  const {
    sector,
    sectorRevenueAnchor,
    sectorLaborCostAnchor,
    sectorType,
    sectorCountryId,
    eraUnitScale,
    corporation,
    isCeo,
    commodityPrices,
    globalBalances,
    nationalBalancesByCountry,
    stateBalances,
    tariffBlend,
    effectiveRates,
    stateResources,
    thisSectorMultipliers,
  } = args;
  // Apply extraction resource capacity to zero out supplies for resources
  // with no deposits — mirrors the backend turn processor so the display
  // matches actual production and margin math matches what the backend uses.
  const effectiveSupply =
    sectorType === "extraction"
      ? applyExtractionResourceCapacityToSupply(sectorType, effectiveRates.supply, stateResources)
      : effectiveRates.supply;

  const supplyFlows = Object.entries(effectiveSupply)
    .filter(([, rate]) => (rate as number) > 0)
    .map(([commodity, rate]) => ({
      commodity: commodity as CommodityType,
      rate: rate as number,
    }));
  const demandFlows = Object.entries(effectiveRates.demand).map(([commodity, rate]) => ({
    commodity: commodity as CommodityType,
    rate: rate as number,
  }));
  const totalSupplyRate = supplyFlows.reduce((sum, f) => sum + f.rate, 0);
  const totalDemandRate = demandFlows.reduce((sum, f) => sum + f.rate, 0);

  // Is retail? Affects penalty factor for demand-side impacts
  const isRetail = sectorType === "retail";

  // Per-row impact must use the SAME blend as `computeBlendedMarginModifiers` and
  // SAME per-commodity cap, so rows sum to the "Net commodity modifier" line.
  const PER_ROW_GLOBAL_WEIGHT = tariffBlend.globalWeight;
  const PER_ROW_NATIONAL_WEIGHT = tariffBlend.nationalWeight;
  const PER_ROW_STATE_WEIGHT = tariffBlend.localWeight;
  const nationalBalancesForCountry =
    nationalBalancesByCountry.get(sectorCountryId) ??
    new Map<CommodityType, { supply: number; demand: number }>();

  const cappedLogImpact = (
    rate: number,
    bal: { supply: number; demand: number } | undefined,
    sign: 1 | -1
  ): number => {
    const ratio = bal ? computeEffectiveCommodityPressureRatio(bal.supply, bal.demand) : 1;
    const impact = sign * COMMODITY_LOG_K * rate * Math.log(ratio);
    return Math.max(-COMMODITY_PER_ITEM_CAP, Math.min(COMMODITY_PER_ITEM_CAP, impact));
  };

  const buildPriceFields = (commodity: CommodityType) => {
    const cpData = commodityPrices.find((p) => p.commodity === commodity);
    const basePrice = COMMODITY_BASE_PRICES[commodity];
    const globalPrice = cpData?.globalPrice ?? basePrice;
    const nationalPrice = cpData?.nationalPrices?.[sectorCountryId] ?? globalPrice;
    const regionalPrice = cpData?.statePrices?.[sector.stateId] ?? nationalPrice;
    return {
      basePrice,
      globalPrice,
      nationalPrice,
      regionalPrice,
      marketPrice: regionalPrice,
    };
  };

  // Structural market rework: resolved once for the supply/demand rows +
  // panel summaries below. One gameConfig read; "off" (default) hides the UI.
  const market = buildMarketContext(await getMarketSystemMode());
  // Under clearing, the realization term lives inside the clearing factor —
  // the plain realization rows/footer would double-report the price leg.
  const marketRealizationEnabled = market.realizationEnabled && !market.clearingEnabled;

  // Last turn's per-output clear rates (written by the clearing pass). Absent
  // on sectors that predate the field or when clearing never ran.
  const soldByCommodity: Partial<Record<string, number>> =
    sector.soldByCommodity && typeof sector.soldByCommodity === "object"
      ? sector.soldByCommodity
      : {};

  const supplies = supplyFlows.map((f) => {
    const dollarFlow = sectorRevenueAnchor * f.rate;
    const units = dollarsToUnits(dollarFlow, COMMODITY_BASE_PRICES[f.commodity]);
    const gBal = globalBalances.get(f.commodity);
    const nBal = nationalBalancesForCountry.get(f.commodity);
    const sBalRaw = stateBalances.get(f.commodity);
    const sBal = {
      supply: (sBalRaw?.supply ?? 0) + STATE_COMMODITY_SUPPLY_DEMAND,
      demand: (sBalRaw?.demand ?? 0) + STATE_COMMODITY_SUPPLY_DEMAND,
    };
    // Surplus side: positive sign — selling into shortage rewards the supplier.
    const gImpact = cappedLogImpact(f.rate, gBal, 1);
    const nImpact = cappedLogImpact(f.rate, nBal, 1);
    const sImpact = cappedLogImpact(f.rate, sBal, 1);
    const rawImpact =
      PER_ROW_GLOBAL_WEIGHT * gImpact +
      PER_ROW_NATIONAL_WEIGHT * nImpact +
      PER_ROW_STATE_WEIGHT * sImpact;
    let capacityMultiplier: number | undefined;
    if (
      sectorType === "extraction" &&
      (EXTRACTABLE_RESOURCES as readonly string[]).includes(f.commodity)
    ) {
      const resource = f.commodity as ExtractableResource;
      if (stateResources === undefined) {
        // No cap doc at all — uncapped (legacy state)
        capacityMultiplier = undefined;
      } else if (stateResources === null) {
        // Cap doc exists with no resources field — zero capacity for all
        capacityMultiplier = 0;
      } else {
        capacityMultiplier = thisSectorMultipliers[resource] ?? 1;
      }
    }
    return {
      commodity: f.commodity,
      label: COMMODITY_LABELS[f.commodity],
      icon: COMMODITY_ICONS[f.commodity],
      colors: COMMODITY_COLORS[f.commodity],
      unit: COMMODITY_UNITS[f.commodity],
      units: Math.round(units * 100) / 100,
      rate: f.rate,
      weight: totalSupplyRate > 0 ? Math.round((f.rate / totalSupplyRate) * 1000) / 10 : 0,
      priceImpact: Math.round(rawImpact * 100) / 100,
      ...buildPriceFields(f.commodity),
      ...(marketRealizationEnabled
        ? (() => {
            const cpData = commodityPrices.find((p) => p.commodity === f.commodity);
            const base = COMMODITY_BASE_PRICES[f.commodity];
            // Positive-price guard matches the sector-level ratio map below —
            // a negative/zero price must read as "at base", never NaN.
            const ratio =
              typeof cpData?.globalPrice === "number" && cpData.globalPrice > 0 && base > 0
                ? cpData.globalPrice / base
                : 1;
            return {
              realizationFactor: Math.round(priceRealizationFactor(ratio) * 1000) / 1000,
              realizationPriceOverBase: Math.round(ratio * 100) / 100,
            };
          })()
        : {}),
      // Per-output clear rate from last turn's clearing pass. The Pricing panel
      // shows one rate-weighted headline across every output, which reads as
      // "my short commodity isn't selling" on a multi-output sector where a
      // DIFFERENT output is the one sitting unsold (oil_gas: gas clears out in
      // a 2.7x shortage while oil, in glut, does not).
      ...(market.clearingEnabled && typeof soldByCommodity[f.commodity] === "number"
        ? { soldFraction: soldByCommodity[f.commodity] }
        : {}),
      capacityMultiplier,
    };
  });

  // Price realization (marketSystemMode >= "realization"): projected sector
  // factor from current lagged prices; `applied` is what last turn actually
  // used (persisted by the corp phase).
  let priceRealization: { applied: number | null; projected: number } | undefined;
  if (marketRealizationEnabled) {
    const ratioMap = new Map(
      commodityPrices
        .filter(
          (p) =>
            typeof p.globalPrice === "number" &&
            COMMODITY_BASE_PRICES[p.commodity] > 0 &&
            p.globalPrice > 0
        )
        .map((p) => [p.commodity, p.globalPrice / COMMODITY_BASE_PRICES[p.commodity]])
    );
    const supplyRatesMap: Partial<Record<CommodityType, number>> = {};
    for (const f of supplyFlows) supplyRatesMap[f.commodity] = f.rate;
    priceRealization = {
      applied: typeof sector.priceRealization === "number" ? sector.priceRealization : null,
      projected: Math.round(computePriceRealization(supplyRatesMap, ratioMap) * 1000) / 1000,
    };
  }

  // Posted-price clearing (marketSystemMode >= "clearing"): CEO posture +
  // last turn's clearing telemetry for the Pricing panel.
  let pricing:
    | {
        posture: number | null;
        effectivePosture: number | null;
        soldFraction: number | null;
        clearingFactor: number | null;
        brandPostureNorm?: number | null;
      }
    | undefined;
  if (market.clearingEnabled) {
    pricing = {
      posture: typeof sector.pricingPosture === "number" ? sector.pricingPosture : null,
      effectivePosture:
        typeof sector.effectivePosture === "number" ? sector.effectivePosture : null,
      soldFraction: typeof sector.soldFraction === "number" ? sector.soldFraction : null,
      clearingFactor: typeof sector.clearingFactor === "number" ? sector.clearingFactor : null,
      // Brand loyalty (Package A): the corp's established price-identity norm,
      // exposed only to the CEO so the Pricing panel can warn about gouging
      // jumps. Corp-level (not sector-level); never sent to non-owners.
      brandPostureNorm:
        isCeo && typeof corporation.brandPostureNorm === "number"
          ? corporation.brandPostureNorm
          : undefined,
    };
  }

  // Capital tier (marketSystemMode >= "capital"): capacity + per-unit
  // economics, computed from live data — margin is emergent, never stored.
  let capital:
    | {
        stock: number | null;
        impliedUnits: number;
        utilization: number | null;
        capacityCoverage: number | null;
        capacityUsed: number | null;
        depreciationPerTurn: number;
        unit: {
          price: number | null;
          labour: number | null;
          inputs: number | null;
          capitalCharge: number | null;
          margin: number | null;
        };
      }
    | undefined;
  if (market.capitalEnabled) {
    const supplyRatesMap: Partial<Record<CommodityType, number>> = {};
    for (const f of supplyFlows) supplyRatesMap[f.commodity] = f.rate;
    const units = impliedOutputUnits(
      sectorRevenueAnchor,
      supplyRatesMap,
      COMMODITY_BASE_PRICES,
      eraUnitScale
    );
    // Output-weighted selling price per unit (lagged market prices).
    let priceSum = 0;
    let unitSum = 0;
    for (const f of supplyFlows) {
      const basePrice = COMMODITY_BASE_PRICES[f.commodity];
      if (!(basePrice > 0) || f.rate <= 0) continue;
      const cpData = commodityPrices.find((p) => p.commodity === f.commodity);
      const price =
        typeof cpData?.globalPrice === "number" && cpData.globalPrice > 0
          ? cpData.globalPrice
          : basePrice;
      const u = (sectorRevenueAnchor * f.rate) / basePrice;
      priceSum += u * price;
      unitSum += u;
    }
    const unitPrice = unitSum > 0 ? priceSum / unitSum : null;
    // Input cost per unit of output: what the sector's demand legs cost at
    // lagged market prices, spread over its output.
    let inputCost = 0;
    for (const f of demandFlows) {
      const basePrice = COMMODITY_BASE_PRICES[f.commodity];
      if (!(basePrice > 0) || f.rate <= 0) continue;
      const cpData = commodityPrices.find((p) => p.commodity === f.commodity);
      const price =
        typeof cpData?.globalPrice === "number" && cpData.globalPrice > 0
          ? cpData.globalPrice
          : basePrice;
      inputCost += ((sectorRevenueAnchor * f.rate) / basePrice) * price;
    }
    const unitInputs = units > 0 ? inputCost / units : null;
    // Labour per unit: both numerator and denominator must share the anchor
    // currency basis. sector.laborCost is persisted in host currency, so the
    // caller normalizes it alongside revenue before it reaches this calculator.
    const unitLabour = perUnitAnchorAmount(sectorLaborCostAnchor, units);
    // Capital charge per unit: the revenue share depreciation claims.
    const unitCapitalCharge =
      units > 0
        ? (sectorRevenueAnchor * CAPITAL_DEPRECIATION_PER_TURN * TURNS_PER_DAY) / units
        : null;
    const unitMargin =
      unitPrice != null
        ? unitPrice - (unitLabour ?? 0) - (unitInputs ?? 0) - (unitCapitalCharge ?? 0)
        : null;
    const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
    const stock = typeof sector.capitalStock === "number" ? sector.capitalStock : null;
    const capacityCoverage =
      typeof sector.capitalUtilization === "number" ? sector.capitalUtilization : null;
    const usage = computeCapitalUsage(stock, units);
    capital = {
      stock,
      impliedUnits: Math.round(units * 100) / 100,
      utilization: usage.utilization,
      capacityCoverage,
      capacityUsed: usage.capacityUsed,
      depreciationPerTurn: CAPITAL_DEPRECIATION_PER_TURN,
      unit: {
        price: round2(unitPrice),
        labour: round2(unitLabour),
        inputs: round2(unitInputs),
        capitalCharge: round2(unitCapitalCharge),
        margin: round2(unitMargin),
      },
    };
  }

  // Throughput coupling (marketSystemMode >= "clearing"): projected raw
  // Leontief minimum from current lagged balances; `applied` is last turn's
  // ramped factor (persisted by the corp phase).
  let throughput:
    | { applied: number | null; projected: number; bindingInput: string | null }
    | undefined;
  if (market.throughputEnabled) {
    const demandRatesMap: Partial<Record<CommodityType, number>> = {};
    for (const f of demandFlows) demandRatesMap[f.commodity] = f.rate;
    const t = computeThroughput(demandRatesMap, globalBalances);
    throughput = {
      applied: typeof sector.throughputFactor === "number" ? sector.throughputFactor : null,
      projected: Math.round(t.throughput * 1000) / 1000,
      bindingInput: t.bindingInput,
    };
  }

  const demands = demandFlows.map((f) => {
    const dollarFlow = sectorRevenueAnchor * f.rate;
    const units = dollarsToUnits(dollarFlow, COMMODITY_BASE_PRICES[f.commodity]);
    const gBal = globalBalances.get(f.commodity);
    const nBal = nationalBalancesForCountry.get(f.commodity);
    const sBalRaw = stateBalances.get(f.commodity);
    const sBal = {
      supply: (sBalRaw?.supply ?? 0) + STATE_COMMODITY_SUPPLY_DEMAND,
      demand: (sBalRaw?.demand ?? 0) + STATE_COMMODITY_SUPPLY_DEMAND,
    };
    // Input side: negative sign — shortages raise input costs and hurt margin.
    const gImpact = cappedLogImpact(f.rate, gBal, -1);
    const nImpact = cappedLogImpact(f.rate, nBal, -1);
    const sImpact = cappedLogImpact(f.rate, sBal, -1);
    let rawImpact =
      PER_ROW_GLOBAL_WEIGHT * gImpact +
      PER_ROW_NATIONAL_WEIGHT * nImpact +
      PER_ROW_STATE_WEIGHT * sImpact;
    if (isRetail && rawImpact < 0) {
      rawImpact *= RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR;
    }
    return {
      commodity: f.commodity,
      label: COMMODITY_LABELS[f.commodity],
      icon: COMMODITY_ICONS[f.commodity],
      colors: COMMODITY_COLORS[f.commodity],
      unit: COMMODITY_UNITS[f.commodity],
      units: Math.round(units * 100) / 100,
      rate: f.rate,
      weight: totalDemandRate > 0 ? Math.round((f.rate / totalDemandRate) * 1000) / 10 : 0,
      priceImpact: Math.round(rawImpact * 100) / 100,
      ...buildPriceFields(f.commodity),
      ...(market.throughputEnabled
        ? { inputAvailability: Math.round(inputAvailability(gBal) * 1000) / 1000 }
        : {}),
    };
  });

  // Add shortage info to demand flows
  const demandsWithShortage = demands.map((d) => {
    const balance = globalBalances.get(d.commodity as CommodityType);
    let shortageRatio: number | null = null;
    if (balance && balance.demand > 0) {
      // ratio > 1 means shortage (demand exceeds supply)
      shortageRatio =
        Math.round(computeCommodityPressureRatio(balance.supply, balance.demand) * 100) / 100;
    }
    return {
      ...d,
      shortageRatio,
    };
  });

  return {
    effectiveSupply,
    supplies,
    demandsWithShortage,
    priceRealization,
    pricing,
    capital,
    throughput,
  };
}
