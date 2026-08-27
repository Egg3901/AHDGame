import type { Db } from "mongodb";
import type {
  Bond,
  CommodityPrice,
  CorporateSector,
  EconomicMetric,
  EconomicVitalSigns,
  GameHealthSnapshot,
  MoneySupplySnapshot,
  ShareTradeHistory,
  StockExchangeSnapshot,
  WealthListSnapshot,
} from "@/lib/db/types";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { LedgerReconciliation } from "@/lib/ledger/types";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";

export const ECONOMIC_VITAL_SIGNS_COLLECTION = "economicVitalSigns";
export const ECONOMIC_VITAL_SIGNS_WINDOW_TURNS = 48 as const;

type Inputs = {
  turn: number;
  now: Date;
  currentFlows: CommodityFlow[];
  flowHistory: CommodityFlow[];
  prices: CommodityPrice[];
  sourcing: CommoditySourcingDoc[];
  sectors: CorporateSector[];
  globalExchange: StockExchangeSnapshot | null;
  trades: ShareTradeHistory[];
  bonds: Bond[];
  globalWealth: WealthListSnapshot | null;
  money: MoneySupplySnapshot[];
  health: GameHealthSnapshot | null;
  reconciliation: LedgerReconciliation | null;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function metric(value: number | null, observations: number, basis: string): EconomicMetric {
  return { value: value == null || !Number.isFinite(value) ? null : value, observations, basis };
}

function median(values: number[]): number | null {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index]! - meanX;
    const dy = ys[index]! - meanY;
    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }
  const denominator = Math.sqrt(sumX * sumY);
  return denominator > 0 ? numerator / denominator : null;
}

function gini(values: number[]): number | null {
  const sorted = values.filter((value) => finite(value) && value >= 0).sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (sorted.length === 0 || total <= 0) return null;
  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    weighted += (index + 1) * sorted[index]!;
  }
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

function concentration(values: number[]): { hhi: number | null; topFourShare: number | null } {
  const positive = values.filter((value) => finite(value) && value > 0).sort((a, b) => b - a);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { hhi: null, topFourShare: null };
  return {
    hhi: positive.reduce((sum, value) => sum + Math.pow((value / total) * 100, 2), 0),
    topFourShare: positive.slice(0, 4).reduce((sum, value) => sum + value, 0) / total,
  };
}

function fillByTurn(flows: CommodityFlow[]): Map<number, number> {
  const totals = new Map<number, { demand: number; cleared: number }>();
  for (const flow of flows) {
    const row = totals.get(flow.turn) ?? { demand: 0, cleared: 0 };
    row.demand += flow.demandUnitsLedger ?? flow.demandUnits;
    row.cleared += flow.clearedUnitsPooled ?? flow.clearedUnits;
    totals.set(flow.turn, row);
  }
  return new Map(
    [...totals.entries()].flatMap(([turn, row]) => {
      const fill = ratio(row.cleared, row.demand);
      return fill == null ? [] : [[turn, fill] as const];
    })
  );
}

export function computeEconomicVitalSigns(input: Inputs): EconomicVitalSigns {
  const pooledDemand = input.currentFlows.reduce(
    (sum, flow) => sum + (flow.demandUnitsLedger ?? flow.demandUnits),
    0
  );
  const pooledCleared = input.currentFlows.reduce(
    (sum, flow) => sum + (flow.clearedUnitsPooled ?? flow.clearedUnits),
    0
  );
  let scopedDemand = 0;
  let scopedCleared = 0;
  for (const flow of input.currentFlows) {
    for (const row of Object.values(flow.byCountry)) {
      scopedDemand += row.demand;
      scopedCleared += row.clearedUnitsScoped ?? row.cleared;
    }
  }

  const basePrice = new Map(input.prices.map((price) => [price.commodity, price.basePrice]));
  const priceMultiples: number[] = [];
  const scarcity: number[] = [];
  for (const flow of input.currentFlows) {
    const base = basePrice.get(flow.commodity);
    const demand = flow.demandUnitsLedger ?? flow.demandUnits;
    if (!base || base <= 0 || demand <= 0) continue;
    priceMultiples.push(flow.price / base);
    scarcity.push(Math.max(0, 1 - (flow.clearedUnitsPooled ?? flow.clearedUnits) / demand));
  }
  const windowFill = fillByTurn(input.flowHistory);
  const windowValues = [...windowFill.values()];
  const recent12Values = [...windowFill.entries()]
    .filter(([turn]) => turn >= input.turn - 11)
    .map(([, value]) => value);

  const intent = input.sourcing.reduce((sum, row) => sum + row.demandUnitsIntent, 0);
  const local = input.sourcing.reduce((sum, row) => sum + row.intraStateUnits, 0);
  const interstate = input.sourcing.reduce((sum, row) => sum + row.interStateUnits, 0);
  const imported = input.sourcing.reduce((sum, row) => sum + row.importUnits, 0);
  const unmet = input.sourcing.reduce((sum, row) => sum + row.unmetUnits, 0);
  const toleranceBound = input.sourcing.reduce((sum, row) => sum + row.toleranceBoundUnits, 0);
  const capacityBound = input.sourcing.reduce((sum, row) => sum + row.capacityBoundUnits, 0);
  const shortageResponsive = input.sourcing.reduce(
    (sum, row) => sum + (row.shortageResponsiveUnits ?? 0),
    0
  );
  const fulfilled = local + interstate + imported;

  const throughputObserved = input.sectors.filter((sector) => finite(sector.throughputFactor));
  const productionWeight = input.sectors.reduce(
    (sum, sector) => sum + Math.max(0, sector.producedUnits ?? 0),
    0
  );
  const soldWeight = input.sectors.reduce(
    (sum, sector) => sum + Math.max(0, sector.soldUnits ?? 0),
    0
  );
  const desiredWorkers = input.sectors.reduce(
    (sum, sector) => sum + Math.max(0, sector.workersDesired ?? sector.workers ?? 0),
    0
  );
  const staffedWorkers = input.sectors.reduce(
    (sum, sector) => sum + Math.max(0, sector.workers ?? 0),
    0
  );

  const listings = input.globalExchange?.listings ?? [];
  const marketCaps = listings.map((listing) => listing.marketCapAnchor ?? listing.marketCap ?? 0);
  const firmConcentration = concentration(marketCaps);
  const marketCapTotal = marketCaps.reduce((sum, value) => sum + Math.max(0, value), 0);
  const revenueTotal = listings.reduce(
    (sum, listing) => sum + (listing.totalRevenueAnchor ?? listing.totalRevenue ?? 0),
    0
  );
  const incomeTotal = listings.reduce(
    (sum, listing) => sum + (listing.incomeAnchor ?? listing.income ?? 0),
    0
  );

  const economicTradeKinds = new Set<ShareTradeHistory["kind"]>([
    "market_buy",
    "market_sell",
    "limit_fill",
    "peer_fill",
    "listing_fill",
    "takeover_buyout",
  ]);
  const economicTrades = input.trades.filter((trade) => economicTradeKinds.has(trade.kind));
  const tradedCorporations = new Set(economicTrades.map((trade) => trade.corporationId.toString()));
  const activeBonds = input.bonds.filter((bond) => !bond.matured);
  const bondHolderCounts = activeBonds.map(
    (bond) => bond.holders.filter((holder) => holder.units > 0).length
  );

  const wealth = input.globalWealth?.entries.map((entry) => Math.max(0, entry.totalWealth)) ?? [];
  const aggregateWealth = wealth.reduce((sum, value) => sum + value, 0);
  const topTenWealth = [...wealth]
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, value) => sum + value, 0);

  const moneyGrowth = input.money.flatMap((row) =>
    finite(row.annualizedM2GrowthPct) ? [row.annualizedM2GrowthPct] : []
  );
  const inflationByCountry = new Map(
    Object.entries(input.health?.economy.byCountry ?? {}).flatMap(([countryId, row]) =>
      row && finite(row.inflation) ? [[countryId, row.inflation] as const] : []
    )
  );
  const pairedGrowth: number[] = [];
  const pairedInflation: number[] = [];
  for (const row of input.money) {
    const inflation = inflationByCountry.get(row.countryId);
    if (!finite(row.annualizedM2GrowthPct) || !finite(inflation)) continue;
    pairedGrowth.push(row.annualizedM2GrowthPct);
    pairedInflation.push(inflation);
  }
  const totalM2 = input.money.reduce((sum, row) => sum + Math.max(0, row.m2), 0);
  const totalCredit = input.money.reduce((sum, row) => sum + Math.max(0, row.creditOutstanding), 0);

  return {
    _id: `turn:${input.turn}`,
    schemaVersion: 1,
    turn: input.turn,
    windowTurns: ECONOMIC_VITAL_SIGNS_WINDOW_TURNS,
    generatedAt: input.now,
    goods: {
      pooledFillRate: metric(
        ratio(pooledCleared, pooledDemand),
        input.currentFlows.length,
        "ledger_aggregate"
      ),
      countryScopedFillRate: metric(
        ratio(scopedCleared, scopedDemand),
        input.currentFlows.length,
        "country_scoped_ledger"
      ),
      medianPriceMultiple: metric(
        median(priceMultiples),
        priceMultiples.length,
        "global_price_to_seed_base"
      ),
      priceScarcityCorrelation: metric(
        correlation(priceMultiples, scarcity),
        priceMultiples.length,
        "commodity_cross_section"
      ),
      pooledFillRateWindowMedian: metric(
        median(windowValues),
        windowValues.length,
        "per_turn_pooled_fill"
      ),
      pooledFillRateRecent12Median: metric(
        median(recent12Values),
        recent12Values.length,
        "per_turn_pooled_fill"
      ),
    },
    trade: {
      intentFulfillmentRate: metric(
        ratio(fulfilled, intent),
        input.sourcing.length,
        "buyer_intent_sourcing"
      ),
      localShare: metric(ratio(local, fulfilled), input.sourcing.length, "fulfilled_buyer_intent"),
      interstateShare: metric(
        ratio(interstate, fulfilled),
        input.sourcing.length,
        "fulfilled_buyer_intent"
      ),
      importShare: metric(
        ratio(imported, fulfilled),
        input.sourcing.length,
        "fulfilled_buyer_intent"
      ),
      toleranceBoundShareOfUnmet: metric(
        ratio(toleranceBound, unmet),
        input.sourcing.length,
        "unmet_buyer_intent"
      ),
      capacityBoundShareOfUnmet: metric(
        ratio(capacityBound, unmet),
        input.sourcing.length,
        "unmet_buyer_intent"
      ),
      shortageResponsiveShareOfFulfillment: metric(
        ratio(shortageResponsive, fulfilled),
        input.sourcing.length,
        "fulfilled_buyer_intent"
      ),
    },
    production: {
      sectorsObserved: input.sectors.length,
      throughputFloorShare: metric(
        ratio(
          throughputObserved.filter((sector) => sector.throughputFactor! <= 0.500001).length,
          throughputObserved.length
        ),
        throughputObserved.length,
        "sector_count"
      ),
      physicalSellThrough: metric(
        ratio(soldWeight, productionWeight),
        input.sectors.length,
        "produced_units_weighted"
      ),
      labourStaffingRate: metric(
        ratio(staffedWorkers, desiredWorkers),
        input.sectors.length,
        "desired_workers_weighted"
      ),
      chronicLowFillShare: metric(
        ratio(
          input.sectors.filter((sector) => (sector.lowFillTurns ?? 0) >= 12).length,
          input.sectors.length
        ),
        input.sectors.length,
        "sector_count_low_fill_12_turns"
      ),
      stockpilingShare: metric(
        ratio(
          input.sectors.filter((sector) => sector.stockpileUnsold === true).length,
          input.sectors.length
        ),
        input.sectors.length,
        "sector_count"
      ),
    },
    firms: {
      listings: listings.length,
      marketCapitalizationAnchor: marketCapTotal,
      revenueAnchor: revenueTotal,
      incomeAnchor: incomeTotal,
      lossMakingShare: metric(
        ratio(
          listings.filter((listing) => (listing.incomeAnchor ?? listing.income) < 0).length,
          listings.length
        ),
        listings.length,
        "listed_firm_count"
      ),
      marketCapHhi: metric(firmConcentration.hhi, listings.length, "market_cap_anchor"),
      topFourMarketCapShare: metric(
        firmConcentration.topFourShare,
        listings.length,
        "market_cap_anchor"
      ),
    },
    securities: {
      equityTrades48Turns: economicTrades.length,
      equityNotionalAnchor48Turns: economicTrades.reduce(
        (sum, trade) => sum + Math.max(0, trade.totalAnchor),
        0
      ),
      activeTradedListingShare: metric(
        ratio(tradedCorporations.size, listings.length),
        listings.length,
        "listed_firm_count_48_turns"
      ),
      activeBonds: activeBonds.length,
      noHolderBondShare: metric(
        ratio(bondHolderCounts.filter((count) => count === 0).length, activeBonds.length),
        activeBonds.length,
        "unmatured_bond_count"
      ),
      medianBondHolders: metric(
        median(bondHolderCounts),
        activeBonds.length,
        "unmatured_bond_count"
      ),
    },
    households: {
      householdsObserved: wealth.length,
      aggregateWealthAnchor: aggregateWealth,
      medianWealthAnchor: metric(median(wealth), wealth.length, "global_wealth_list_entries"),
      wealthGini: metric(gini(wealth), wealth.length, "nonnegative_net_wealth"),
      topTenWealthShare: metric(
        ratio(topTenWealth, aggregateWealth),
        wealth.length,
        "global_wealth_list_entries"
      ),
    },
    money: {
      currenciesObserved: input.money.length,
      medianAnnualizedM2GrowthPct: metric(
        median(moneyGrowth),
        moneyGrowth.length,
        "currency_equal_weight"
      ),
      medianInflationPct: metric(
        median([...inflationByCountry.values()]),
        inflationByCountry.size,
        "country_equal_weight"
      ),
      moneyGrowthInflationCorrelation: metric(
        correlation(pairedGrowth, pairedInflation),
        pairedGrowth.length,
        "country_cross_section"
      ),
      creditToM2: metric(ratio(totalCredit, totalM2), input.money.length, "currency_stock_sum"),
    },
    reconciliation: {
      status: input.reconciliation?.status ?? "unavailable",
      trialBalanceUnbalancedCount: input.reconciliation?.trialBalance.unbalancedCount ?? null,
      stockVsFlowDivergentCount: input.reconciliation?.stockVsFlow.divergentCount ?? null,
      moneySupplyFindingCount: input.reconciliation?.moneySupply.findings.length ?? null,
    },
  };
}

export async function snapshotEconomicVitalSigns(
  db: Db,
  turn: number
): Promise<EconomicVitalSigns> {
  const windowStart = Math.max(0, turn - ECONOMIC_VITAL_SIGNS_WINDOW_TURNS + 1);
  const [
    currentFlows,
    flowHistory,
    prices,
    sourcing,
    sectors,
    globalExchange,
    trades,
    bonds,
    globalWealth,
    money,
    health,
    reconciliation,
  ] = await Promise.all([
    db.collection<CommodityFlow>("commodityFlows").find({ turn }).toArray(),
    db
      .collection<CommodityFlow>("commodityFlows")
      .find({ turn: { $gte: windowStart, $lte: turn } })
      .toArray(),
    db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
    db.collection<CommoditySourcingDoc>("commoditySourcingFlows").find({ turn }).toArray(),
    db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
    db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "global" }),
    db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find({ turn: { $gte: windowStart, $lte: turn } })
      .toArray(),
    db.collection<Bond>("bonds").find({ matured: false }).toArray(),
    db.collection<WealthListSnapshot>("wealthListSnapshots").findOne({ _id: "global" }),
    db.collection<MoneySupplySnapshot>("moneySupplySnapshots").find({ turn }).toArray(),
    db.collection<GameHealthSnapshot>("gameHealthSnapshots").findOne({ turn }),
    db.collection<LedgerReconciliation>("ledgerReconciliations").findOne({ turn }),
  ]);
  const snapshot = computeEconomicVitalSigns({
    turn,
    now: new Date(),
    currentFlows,
    flowHistory,
    prices,
    sourcing,
    sectors,
    globalExchange,
    trades,
    bonds,
    globalWealth,
    money,
    health,
    reconciliation,
  });
  await db
    .collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
    .replaceOne({ _id: snapshot._id }, snapshot, { upsert: true });
  return snapshot;
}
