import type { Db } from "mongodb";
import type {
  Bond,
  CommodityPrice,
  CorporateSector,
  EconomicMetric,
  EconomicVitalSigns,
  ExchangeRate,
  GameHealthSnapshot,
  MoneySupplySnapshot,
  ShareOrder,
  ShareTradeHistory,
  StockExchangeSnapshot,
  WealthListSnapshot,
} from "@/lib/db/types";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { LedgerReconciliation } from "@/lib/ledger/types";
import type { BalanceSnapshot, LedgerEntry } from "@/lib/ledger/types";
import { accountKind, isRealAccount } from "@/lib/ledger/accounts";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";
import { computeSectorCommodityUnits } from "@/lib/corporations/corpCommodityFlows";
import { resolveFormalizedGroups } from "@/lib/corporations/groups/groupMembership";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CommodityType } from "@/lib/constants/commodities";

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
  shareOrders: ShareOrder[];
  bonds: Bond[];
  globalWealth: WealthListSnapshot | null;
  money: MoneySupplySnapshot[];
  health: GameHealthSnapshot | null;
  reconciliation: LedgerReconciliation | null;
  balanceSnapshot: BalanceSnapshot | null;
  ledgerEntries: LedgerEntry[];
  commodityParticipants: CommodityParticipant[];
};

type CommodityParticipant = {
  commodity: CommodityType;
  corporationId: string;
  ownershipRootId: string;
  sellerUnits: number;
  buyerUnits: number;
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

function nonnegative(value: unknown): number {
  return finite(value) && value > 0 ? value : 0;
}

function marketQuality(
  listings: NonNullable<Inputs["globalExchange"]>["listings"],
  orders: ShareOrder[],
  trades: ShareTradeHistory[]
) {
  const listingById = new Map(listings.map((listing) => [listing._id.toString(), listing]));
  const open = orders.filter((order) => order.status === "open" && order.sharesRemaining > 0);
  const byCorporation = new Map<string, ShareOrder[]>();
  for (const order of open) {
    const key = order.corporationId.toString();
    const list = byCorporation.get(key) ?? [];
    list.push(order);
    byCorporation.set(key, list);
  }

  const spreads: number[] = [];
  let twoSidedListings = 0;
  let depthAnchor = 0;
  for (const [corporationId, book] of byCorporation) {
    const listing = listingById.get(corporationId);
    if (!listing) continue;
    const buys = book.filter((order) => order.type === "buy");
    const sells = book.filter((order) => order.type === "sell");
    if (buys.length > 0 && sells.length > 0) {
      const bestBid = Math.max(...buys.map((order) => order.pricePerShare));
      const bestAsk = Math.min(...sells.map((order) => order.pricePerShare));
      const midpoint = (bestBid + bestAsk) / 2;
      if (bestAsk >= bestBid && midpoint > 0) spreads.push(((bestAsk - bestBid) / midpoint) * 100);
      twoSidedListings += 1;
    }
    const anchorPerLocal =
      nonnegative(listing.sharePriceAnchor) > 0 && nonnegative(listing.sharePrice) > 0
        ? listing.sharePriceAnchor! / listing.sharePrice
        : 1;
    depthAnchor += book.reduce(
      (sum, order) => sum + order.sharesRemaining * order.pricePerShare * anchorPerLocal,
      0
    );
  }

  const executionHours = orders.flatMap((order) => {
    if (order.status !== "filled") return [];
    const created = new Date(order.createdAt).getTime();
    const updated = new Date(order.updatedAt).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(updated) || updated < created) return [];
    return [(updated - created) / 3_600_000];
  });

  const notionalByCorporation = new Map<string, number>();
  for (const trade of trades) {
    const key = trade.corporationId.toString();
    notionalByCorporation.set(
      key,
      (notionalByCorporation.get(key) ?? 0) + nonnegative(trade.totalAnchor)
    );
  }
  const amihud = listings.flatMap((listing) => {
    const notional = notionalByCorporation.get(listing._id.toString()) ?? 0;
    if (notional <= 0 || !finite(listing.priceChange48h)) return [];
    return [Math.abs(listing.priceChange48h) / (notional / 1_000_000)];
  });

  return {
    openBuyOrders: open.filter((order) => order.type === "buy").length,
    openSellOrders: open.filter((order) => order.type === "sell").length,
    twoSidedListings,
    spreads,
    depthAnchor,
    executionHours,
    amihud,
  };
}

function relevantMarketDiagnostics(
  participants: CommodityParticipant[],
  flows: CommodityFlow[]
): EconomicVitalSigns["competition"] {
  const fillByCommodity = new Map(
    flows.map((flow) => {
      const demand = flow.demandUnitsLedger ?? flow.demandUnits;
      return [
        flow.commodity,
        {
          fill: ratio(flow.clearedUnitsPooled ?? flow.clearedUnits, demand),
          supply: flow.supplyUnits,
          demand,
          price: finite(flow.price) && flow.price >= 0 ? flow.price : null,
        },
      ] as const;
    })
  );
  const byCommodity = new Map<CommodityType, CommodityParticipant[]>();
  for (const participant of participants) {
    const rows = byCommodity.get(participant.commodity) ?? [];
    rows.push(participant);
    byCommodity.set(participant.commodity, rows);
  }

  const hhiFor = (
    rows: CommodityParticipant[],
    side: "sellerUnits" | "buyerUnits",
    ownershipAdjusted: boolean
  ): {
    hhi: number | null;
    count: number;
    largestShare: number | null;
    largestUnits: number | null;
  } => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const value = nonnegative(row[side]);
      if (value <= 0) continue;
      const key = ownershipAdjusted ? row.ownershipRootId : row.corporationId;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    const values = [...totals.values()];
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      hhi: concentration(values).hhi,
      count: totals.size,
      largestShare: total > 0 ? Math.max(...values) / total : null,
      largestUnits: total > 0 ? Math.max(...values) : null,
    };
  };

  const markets = [...byCommodity.entries()]
    .map(([commodity, rows]) => {
      const sellers = hhiFor(rows, "sellerUnits", false);
      const buyers = hhiFor(rows, "buyerUnits", false);
      const ownershipSellers = hhiFor(rows, "sellerUnits", true);
      const ownershipBuyers = hhiFor(rows, "buyerUnits", true);
      const flow = fillByCommodity.get(commodity);
      const pooledFillRate = flow?.fill ?? null;
      return {
        commodity,
        pooledFillRate,
        supplyUnits:
          flow?.supply ?? rows.reduce((sum, row) => sum + nonnegative(row.sellerUnits), 0),
        demandUnits:
          flow?.demand ?? rows.reduce((sum, row) => sum + nonnegative(row.buyerUnits), 0),
        priceAnchorPerUnit: flow?.price ?? null,
        participantSellerUnits: rows.reduce((sum, row) => sum + nonnegative(row.sellerUnits), 0),
        sellerCount: sellers.count,
        buyerCount: buyers.count,
        sellerHhi: sellers.hhi,
        buyerHhi: buyers.hhi,
        ownershipAdjustedSellerHhi: ownershipSellers.hhi,
        ownershipAdjustedBuyerHhi: ownershipBuyers.hhi,
        largestOwnershipAdjustedSellerShare: ownershipSellers.largestShare,
        largestOwnershipAdjustedSellerUnits: ownershipSellers.largestUnits,
        highConcentrationLowFill:
          pooledFillRate != null &&
          pooledFillRate < 0.8 &&
          (ownershipSellers.hhi ?? sellers.hhi ?? 0) >= 2_500,
      };
    })
    .sort((a, b) => a.commodity.localeCompare(b.commodity));

  const sellerHhi = markets.flatMap((market) =>
    market.sellerHhi == null ? [] : [market.sellerHhi]
  );
  const buyerHhi = markets.flatMap((market) => (market.buyerHhi == null ? [] : [market.buyerHhi]));
  const ownershipSellerHhi = markets.flatMap((market) =>
    market.ownershipAdjustedSellerHhi == null ? [] : [market.ownershipAdjustedSellerHhi]
  );
  const ownershipBuyerHhi = markets.flatMap((market) =>
    market.ownershipAdjustedBuyerHhi == null ? [] : [market.ownershipAdjustedBuyerHhi]
  );
  const marketsWithFill = markets.filter((market) => market.pooledFillRate != null);
  return {
    markets,
    medianSellerHhi: metric(median(sellerHhi), sellerHhi.length, "commodity_corporation_output"),
    medianBuyerHhi: metric(median(buyerHhi), buyerHhi.length, "commodity_corporation_input"),
    medianOwnershipAdjustedSellerHhi: metric(
      median(ownershipSellerHhi),
      ownershipSellerHhi.length,
      "commodity_formalized_group_output"
    ),
    medianOwnershipAdjustedBuyerHhi: metric(
      median(ownershipBuyerHhi),
      ownershipBuyerHhi.length,
      "commodity_formalized_group_input"
    ),
    highConcentrationLowFillShare: metric(
      ratio(
        marketsWithFill.filter((market) => market.highConcentrationLowFill).length,
        marketsWithFill.length
      ),
      marketsWithFill.length,
      "commodity_markets_with_pooled_fill"
    ),
  };
}

function monetaryActivity(balanceSnapshot: BalanceSnapshot | null, entries: LedgerEntry[]) {
  const balances = balanceSnapshot?.balances ?? {};
  const activeAccounts = new Set<string>();
  const turnoverByKind = new Map<string, number>();
  let grossTurnover = 0;
  for (const entry of entries) {
    for (const leg of entry.legs) {
      if (leg.role !== "primary" || !isRealAccount(leg.account)) continue;
      const turnover = Math.abs(leg.anchorAmount);
      activeAccounts.add(leg.account);
      grossTurnover += turnover;
      const kind = accountKind(leg.account);
      turnoverByKind.set(kind, (turnoverByKind.get(kind) ?? 0) + turnover);
    }
  }

  let total = 0;
  let active = 0;
  const balanceByKind = new Map<string, number>();
  for (const [account, rawBalance] of Object.entries(balances)) {
    if (!isRealAccount(account)) continue;
    const balance = nonnegative(rawBalance);
    total += balance;
    if (activeAccounts.has(account)) active += balance;
    const kind = accountKind(account);
    balanceByKind.set(kind, (balanceByKind.get(kind) ?? 0) + balance);
  }

  const velocity = (kinds: readonly string[]): number | null => {
    const stock = kinds.reduce((sum, kind) => sum + (balanceByKind.get(kind) ?? 0), 0);
    const flow = kinds.reduce((sum, kind) => sum + (turnoverByKind.get(kind) ?? 0), 0);
    return ratio(flow, stock);
  };
  return {
    total,
    active,
    dormant: Math.max(0, total - active),
    activeAccounts: activeAccounts.size,
    accountCount: Object.keys(balances).filter((account) => isRealAccount(account)).length,
    grossVelocity: ratio(grossTurnover, total),
    householdVelocity: velocity(["character", "character_savings"]),
    corporateVelocity: velocity(["corporation"]),
    partyVelocity: velocity(["party"]),
    governmentVelocity: velocity(["government"]),
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
  const quality = marketQuality(listings, input.shareOrders, economicTrades);
  const competition = relevantMarketDiagnostics(input.commodityParticipants, input.currentFlows);
  const tradedCorporations = new Set(economicTrades.map((trade) => trade.corporationId.toString()));
  const activeBonds = input.bonds.filter((bond) => !bond.matured);
  const bondHolderCounts = activeBonds.map(
    (bond) => bond.holders.filter((holder) => holder.units > 0).length
  );
  const bondHeldUnits = activeBonds.reduce(
    (sum, bond) =>
      sum + bond.holders.reduce((holderSum, holder) => holderSum + nonnegative(holder.units), 0),
    0
  );
  const bondFloatUnits = activeBonds.reduce((sum, bond) => sum + nonnegative(bond.publicFloat), 0);

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
  const totalM1 = input.money.reduce((sum, row) => sum + Math.max(0, row.m1), 0);
  const totalExternalBroadMoney = input.money.reduce(
    (sum, row) => sum + Math.max(0, row.externalBroadMoney),
    0
  );
  const totalBankDeposits = input.money.reduce(
    (sum, row) => sum + Math.max(0, row.bankDeposits),
    0
  );
  const totalCredit = input.money.reduce((sum, row) => sum + Math.max(0, row.creditOutstanding), 0);
  const activity = monetaryActivity(input.balanceSnapshot, input.ledgerEntries);
  const measurementReasons: string[] = [];
  if (!input.reconciliation) measurementReasons.push("current_turn_reconciliation_unavailable");
  else if (input.reconciliation.status !== "green") {
    measurementReasons.push(`reconciliation_${input.reconciliation.status}`);
  }
  if (!input.balanceSnapshot) measurementReasons.push("balance_snapshot_unavailable");
  if (quality.spreads.length < 5) measurementReasons.push("fewer_than_five_two_sided_books");
  if (input.currentFlows.length === 0) measurementReasons.push("commodity_flow_sample_empty");
  if (input.commodityParticipants.length === 0) {
    measurementReasons.push("commodity_participant_sample_empty");
  }
  const measurementConfidence: EconomicVitalSigns["measurement"]["confidence"] =
    measurementReasons.length === 0
      ? "high"
      : input.reconciliation?.status === "red" || !input.reconciliation
        ? "low"
        : "medium";

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
    competition,
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
      bondSubscriptionRate: metric(
        ratio(bondHeldUnits, bondHeldUnits + bondFloatUnits),
        activeBonds.length,
        "unmatured_bond_units"
      ),
      openBuyOrders: quality.openBuyOrders,
      openSellOrders: quality.openSellOrders,
      twoSidedListingShare: metric(
        ratio(quality.twoSidedListings, listings.length),
        listings.length,
        "listed_firm_count_open_order_books"
      ),
      medianQuotedSpreadPct: metric(
        median(quality.spreads),
        quality.spreads.length,
        "two_sided_non_crossed_books"
      ),
      openOrderDepthAnchor: quality.depthAnchor,
      depthToMarketCap: metric(
        ratio(quality.depthAnchor, marketCapTotal),
        input.shareOrders.filter((order) => order.status === "open").length,
        "open_order_notional_to_listed_market_cap"
      ),
      medianFilledOrderExecutionHours: metric(
        median(quality.executionHours),
        quality.executionHours.length,
        "retained_filled_orders_wall_clock"
      ),
      medianAmihudIlliquidity48: metric(
        median(quality.amihud),
        quality.amihud.length,
        "absolute_48h_return_pct_per_million_anchor_notional"
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
      transactionalMoneyShare: metric(
        ratio(totalM1, totalM2),
        input.money.length,
        "currency_stock_sum"
      ),
      externalBroadMoneyShare: metric(
        ratio(totalExternalBroadMoney, totalM2),
        input.money.length,
        "currency_stock_sum"
      ),
      bankDepositShare: metric(
        ratio(totalBankDeposits, totalM2),
        input.money.length,
        "currency_stock_sum"
      ),
      activeModeledBalanceShare48: metric(
        ratio(activity.active, activity.total),
        activity.accountCount,
        "ledger_backed_accounts_active_in_48_turns"
      ),
      dormantModeledBalanceShare48: metric(
        ratio(activity.dormant, activity.total),
        activity.accountCount,
        "ledger_backed_accounts_inactive_in_48_turns"
      ),
      modeledGrossVelocity48: metric(
        activity.grossVelocity,
        input.ledgerEntries.length,
        "absolute_primary_ledger_flow_to_closing_balance"
      ),
      householdGrossVelocity48: metric(
        activity.householdVelocity,
        activity.activeAccounts,
        "character_primary_ledger_flow_to_closing_balance"
      ),
      corporateGrossVelocity48: metric(
        activity.corporateVelocity,
        activity.activeAccounts,
        "corporation_primary_ledger_flow_to_closing_balance"
      ),
      partyGrossVelocity48: metric(
        activity.partyVelocity,
        activity.activeAccounts,
        "party_primary_ledger_flow_to_closing_balance"
      ),
      governmentGrossVelocity48: metric(
        activity.governmentVelocity,
        activity.activeAccounts,
        "government_primary_ledger_flow_to_closing_balance"
      ),
    },
    measurement: { confidence: measurementConfidence, reasons: measurementReasons },
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
  const shareOrdersPromise = Promise.all([
    db.collection<ShareOrder>("shareOrders").find({ status: "open" }).toArray(),
    db
      .collection<ShareOrder>("shareOrders")
      .find({ status: "filled" })
      .sort({ updatedAt: -1 })
      .limit(5_000)
      .toArray(),
  ]).then(([open, filled]) => [...open, ...filled]);
  const [
    currentFlows,
    flowHistory,
    prices,
    sourcing,
    sectors,
    globalExchange,
    trades,
    shareOrders,
    bonds,
    globalWealth,
    money,
    health,
    reconciliation,
    balanceSnapshot,
    ledgerEntries,
    groupMembership,
    exchangeRates,
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
    shareOrdersPromise,
    db.collection<Bond>("bonds").find({ matured: false }).toArray(),
    db.collection<WealthListSnapshot>("wealthListSnapshots").findOne({ _id: "global" }),
    db.collection<MoneySupplySnapshot>("moneySupplySnapshots").find({ turn }).toArray(),
    db.collection<GameHealthSnapshot>("gameHealthSnapshots").findOne({ turn }),
    db.collection<LedgerReconciliation>("ledgerReconciliations").findOne({ turn }),
    db.collection<BalanceSnapshot>("balanceSnapshots").findOne({ turn }),
    db
      .collection<LedgerEntry>("ledgerEntries")
      .find({ turn: { $gte: windowStart, $lte: turn } })
      .toArray(),
    resolveFormalizedGroups(db),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
  ]);
  const fxByCurrency = new Map(exchangeRates.map((row) => [row.currencyCode, row.rate]));
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1);
  const commodityParticipants: CommodityParticipant[] = [];
  for (const sector of sectors) {
    const corporationId = sector.corporationId.toString();
    const currencyCode = COUNTRY_CURRENCY_MAP[sector.countryId];
    const fxRate = fxByCurrency.get(currencyCode) ?? 1;
    const { supply, demand } = computeSectorCommodityUnits(
      {
        ...sector,
        revenueAnchor: fxRate > 0 ? sector.revenue / fxRate : sector.revenue,
        capacityUnits: sector.capitalStock,
      },
      turn,
      { plantsEnabled: true }
    );
    const commodities = new Set([...supply.keys(), ...demand.keys()]);
    for (const commodity of commodities) {
      commodityParticipants.push({
        commodity,
        corporationId,
        ownershipRootId: groupMembership.rootByCorpId.get(corporationId) ?? corporationId,
        sellerUnits: supply.get(commodity) ?? 0,
        buyerUnits: demand.get(commodity) ?? 0,
      });
    }
  }
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
    shareOrders,
    bonds,
    globalWealth,
    money,
    health,
    reconciliation,
    balanceSnapshot,
    ledgerEntries,
    commodityParticipants,
  });
  await db
    .collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
    .replaceOne({ _id: snapshot._id }, snapshot, { upsert: true });
  return snapshot;
}
