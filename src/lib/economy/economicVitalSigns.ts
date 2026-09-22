import { currentMoneyGrowth } from "@/lib/moneySupply/rules/growthSignal";
import { MONEY_ACCOUNTING_VERSION } from "@/lib/moneySupply/calculate";
import type { Db } from "mongodb";
import type {
  Bond,
  CommodityPrice,
  CorporateSector,
  Corporation,
  EconomicMetric,
  EconomicVitalSigns,
  ExchangeRate,
  GameConfig,
  GameHealthSnapshot,
  IndexFund,
  MoneySupplySnapshot,
  ShareOrder,
  ShareTradeHistory,
  StockExchangeSnapshot,
  NppMarketEntryFunnel,
  UnownedSector,
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
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { computeMarketFormationSnapshot } from "@/lib/economy/marketFormation";
import {
  classifySovereignDemandGap,
  summarizeSovereignIssuanceByCountry,
} from "@/lib/bonds/sovereignIssueDiagnostics";
import type {
  SovereignDemandGapFund,
  SovereignDiagnosticBond,
} from "@/lib/bonds/sovereignIssueDiagnostics";
import {
  computeFundAllocationBreakdown,
  INDEX_FUND_RESERVE_CASH_BUFFER_FRACTION,
} from "@/lib/indexFunds/fundAllocation";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  clampShare,
  isTradableListing,
  tradableListingIds,
} from "@/lib/stockExchange/listingEligibility";
import { NPP_MARKET_ENTRY_FUNNEL_COLLECTION } from "@/lib/turn/npp/entryDiagnostics";

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
  /** Realized same-turn corporation results used for firm profitability. */
  firmIncome?: Array<{ corporationId: string; income: number }>;
  trades: ShareTradeHistory[];
  shareOrders: ShareOrder[];
  bonds: Bond[];
  globalWealth: WealthListSnapshot | null;
  money: MoneySupplySnapshot[];
  health: GameHealthSnapshot | null;
  reconciliation: LedgerReconciliation | null;
  balanceSnapshot: BalanceSnapshot | null;
  /** Per-account primary-leg turnover over the window (see summarizeLedgerTurnover). */
  ledgerTurnover: LedgerTurnoverRow[];
  /** How many ledger entries the window covered; a sample-size input only. */
  ledgerEntryCount: number;
  /** One row per corporation carrying ring-fenced money (see summarizeRingFencedCash). */
  ringFenced?: RingFencedCashRow[];
  /** Anchor rates by currency code; unknown currencies convert 1:1. */
  anchorRates?: Record<string, number>;
  commodityParticipants: CommodityParticipant[];
  unownedSectors?: UnownedSector[];
  entryFunnel?: NppMarketEntryFunnel | null;
  eraUnitScale?: number;
  history?: VitalSignsHistoryRow[];
  /**
   * Fund demand snapshot for the #1001 sovereign demand-gap cross-section.
   * Assembled by `snapshotEconomicVitalSigns` from projected reads; absent in
   * unit tests and older callers, in which case the per-country rows carry no
   * `demandGapByReason` and read exactly as before.
   */
  sovereignDemand?: SovereignFundDemandInput;
};

/**
 * Everything `classifySovereignDemandGap` needs beyond the bonds themselves:
 * plain data, resolved by the caller from projected `indexFunds`,
 * `federalBudget`, `exchangeRates`, and `gameConfig` reads.
 */
export type SovereignFundDemandInput = {
  funds: SovereignDemandGapFund[];
  /** Bond holder `fundId` (string) to classifier fund key (slug). */
  fundIdToKey: ReadonlyMap<string, string>;
  tradableCurrencies: readonly string[];
  controlledCurrencies: readonly string[];
  ratingByCountry: ReadonlyMap<string, string | undefined>;
  /** `indexFundBondLiquidityEnabled`: the cross-border equity demand flag. */
  crossBorderEnabled: boolean;
};

/**
 * One prior turn's persisted securities readings, loaded with a narrow projection.
 * The full snapshot document carries per-cell arrays, so never load it whole here.
 */
export type VitalSignsHistoryRow = {
  turn: number;
  depthToMarketCap: number | null;
  twoSidedListingShare: number | null;
  activeTradedListingShare: number | null;
  sovereignNoHolderBondShare: number | null;
  corporateNoHolderBondShare: number | null;
};

type ProjectedMetric = { value: number | null } | undefined;

type HistoryProjection = {
  turn: number;
  securities?: {
    depthToMarketCap?: ProjectedMetric;
    twoSidedListingShare?: ProjectedMetric;
    activeTradedListingShare?: ProjectedMetric;
    sovereignNoHolderBondShare?: ProjectedMetric;
    corporateNoHolderBondShare?: ProjectedMetric;
  };
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

/**
 * Per-issue holder-cap input for the demand-gap classifier: whole units each
 * candidate fund already holds, keyed by fund slug. Holder rows without a
 * fund id (characters, corps, NPPs) do not consume fund cap.
 */
function fundUnitsByKey(
  holders: Bond["holders"],
  fundIdToKey: ReadonlyMap<string, string>
): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const holder of holders ?? []) {
    const fundId = holder.fundId?.toString();
    if (!fundId) continue;
    const key = fundIdToKey.get(fundId);
    if (!key) continue;
    const units =
      typeof holder.units === "number" && Number.isFinite(holder.units)
        ? Math.max(0, Math.floor(holder.units))
        : 0;
    if (units <= 0) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + units);
  }
  return byKey;
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

/**
 * Turns that produced no snapshot are invisible in a raw series, so a gap reads as
 * a flat line. Record what the window should hold and which turns are absent.
 *
 * Coverage starts at the earliest turn in the window that actually has a snapshot,
 * not at the start of the window. Turns before the series began never had one and
 * are not gaps; counting them would bury the turns that genuinely died.
 */
function computeCoverage(
  turn: number,
  history: VitalSignsHistoryRow[]
): EconomicVitalSigns["coverage"] {
  const windowStart = Math.max(1, turn - ECONOMIC_VITAL_SIGNS_WINDOW_TURNS + 1);
  const observed = new Set<number>([turn]);
  for (const row of history) {
    if (row.turn >= windowStart && row.turn <= turn) observed.add(row.turn);
  }
  const coverageStartTurn = Math.min(...observed);
  const windowTurnsExpected = turn - coverageStartTurn + 1;
  const missingTurns: number[] = [];
  for (let candidate = coverageStartTurn; candidate <= turn; candidate += 1) {
    if (observed.has(candidate)) continue;
    missingTurns.push(candidate);
    if (missingTurns.length >= ECONOMIC_VITAL_SIGNS_WINDOW_TURNS) break;
  }
  return {
    coverageStartTurn,
    windowTurnsExpected,
    windowTurnsObserved: observed.size,
    windowCoverageShare: ratio(observed.size, windowTurnsExpected),
    missingTurns,
  };
}

/**
 * A single turn's securities reading is spiky enough that a frozen one-turn baseline
 * can manufacture a regression later. Carry the rolling median beside the point value.
 */
function recent12Median(
  turn: number,
  history: VitalSignsHistoryRow[],
  current: number | null,
  pick: (row: VitalSignsHistoryRow) => number | null,
  basis: string
): EconomicMetric {
  const values: number[] = [];
  if (current != null && Number.isFinite(current)) values.push(current);
  for (const row of history) {
    if (row.turn < turn - 11 || row.turn >= turn) continue;
    const value = pick(row);
    if (value != null && Number.isFinite(value)) values.push(value);
  }
  return metric(median(values), values.length, basis);
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
  // The liquidity facility posts both sides itself, so it satisfies the plain two-sided
  // metric by construction. The organic counters are the ones that show participation.
  let organicTwoSidedListings = 0;
  let facilityQuotedListings = 0;
  let organicDepthAnchor = 0;
  for (const [corporationId, book] of byCorporation) {
    const listing = listingById.get(corporationId);
    if (!listing) continue;
    const buys = book.filter((order) => order.type === "buy");
    const sells = book.filter((order) => order.type === "sell");
    const organicBuys = buys.filter((order) => order.liquidityProvider !== true);
    const organicSells = sells.filter((order) => order.liquidityProvider !== true);
    if (organicBuys.length > 0 && organicSells.length > 0) organicTwoSidedListings += 1;
    if (book.some((order) => order.liquidityProvider === true)) facilityQuotedListings += 1;
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
    organicDepthAnchor += book
      .filter((order) => order.liquidityProvider !== true)
      .reduce(
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

  // Per-listing inventory concentration: each economic trade's notional is
  // split evenly across its distinct named counterparties, so a float-only
  // leg attributes fully to the trader on the other side. Rows with no named
  // party are unattributable and narrow the sample instead of diluting it.
  const notionalByListingParty = new Map<string, Map<string, number>>();
  for (const trade of trades) {
    const notional = nonnegative(trade.totalAnchor);
    if (notional <= 0) continue;
    const parties = new Set(
      [trade.from, trade.to].map(tradePartyKey).filter((key): key is string => key != null)
    );
    if (parties.size === 0) continue;
    const share = notional / parties.size;
    const key = trade.corporationId.toString();
    let byParty = notionalByListingParty.get(key);
    if (!byParty) {
      byParty = new Map();
      notionalByListingParty.set(key, byParty);
    }
    for (const party of parties) byParty.set(party, (byParty.get(party) ?? 0) + share);
  }
  const topTraderShares: number[] = [];
  for (const [listingId, byParty] of notionalByListingParty) {
    if (!listingById.has(listingId)) continue;
    const total = [...byParty.values()].reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue;
    topTraderShares.push(Math.max(...byParty.values()) / total);
  }

  return {
    openBuyOrders: open.filter((order) => order.type === "buy").length,
    openSellOrders: open.filter((order) => order.type === "sell").length,
    twoSidedListings,
    organicTwoSidedListings,
    facilityQuotedListings,
    spreads,
    depthAnchor,
    organicDepthAnchor,
    executionHours,
    amihud,
    topTraderShares,
  };
}

function tradePartyKey(party: ShareTradeHistory["from"]): string | null {
  if (!party) return null;
  if (party.characterId) return `character:${party.characterId.toString()}`;
  if (party.imperialCharacterId) return `imperial:${party.imperialCharacterId.toString()}`;
  if (party.corporationId) return `corporation:${party.corporationId.toString()}`;
  return party.name ? `name:${party.name}` : null;
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

/**
 * Absolute primary-leg turnover for one account over the measurement window.
 *
 * This is all `monetaryActivity` ever needed from the ledger, and collapsing to
 * it in the database instead of in Node is the difference between loading
 * 61,398 documents (23.5MB) and 1,389 rows (88KB) on a measured world.
 */
export interface LedgerTurnoverRow {
  account: string;
  turnover: number;
}

/**
 * Roll raw ledger entries into per-account turnover.
 *
 * Production does not call this: it runs the equivalent `$group` in Mongo (see
 * loadLedgerTurnover) rather than shipping every entry over the wire. It exists
 * so callers that already hold entries in memory — tests asserting velocity
 * maths from real legs, offline analysis — can produce the same input without
 * duplicating the rule about which legs count.
 */
export function summarizeLedgerTurnover(entries: LedgerEntry[]): LedgerTurnoverRow[] {
  const byAccount = new Map<string, number>();
  for (const entry of entries) {
    for (const leg of entry.legs) {
      if (leg.role !== "primary") continue;
      byAccount.set(leg.account, (byAccount.get(leg.account) ?? 0) + Math.abs(leg.anchorAmount));
    }
  }
  return [...byAccount.entries()].map(([account, turnover]) => ({ account, turnover }));
}

/**
 * One corporation's ring-fenced money: bank cash reserves plus share escrow.
 *
 * Both sit outside the shadow ledger. The bank's `cashReserves` are
 * ring-fenced from the parent's `liquidCapital` (see `banking/bankCash.ts`),
 * so the corporation ledger account never sees them; `shareEscrowBalance`
 * settles float trades in escrow mode and likewise emits no ledger legs.
 * Only active charters count as banks: revoked or failed charters hold no
 * spendable bank money, and their cash is in recovery or already returned.
 */
export interface RingFencedCashRow {
  charterActive: boolean;
  charterCurrency: string;
  /** Absent on charters written before the ring-fence: unclassified, not zero. */
  cashReserves: number | undefined;
  liquidCurrency: string;
  /** Absent in instant settlement mode, which holds no escrow: zero, not unknown. */
  escrowBalance: number | undefined;
}

export interface RingFencedCashSummary {
  banksTotal: number;
  banksReported: number;
  bankCashAnchor: number;
  escrowAnchor: number;
  escrowContributors: number;
}

/**
 * Aggregate ring-fenced money into anchor stocks.
 *
 * Conversion mirrors the balance snapshot's `toAnchor`: a missing or
 * non-positive rate converts 1:1 rather than dropping the row. Negative
 * escrow rows are buyback debt, not money, and floor per row exactly like the
 * modeled balance stocks in `monetaryActivity`.
 */
export function summarizeRingFencedCash(
  rows: RingFencedCashRow[],
  rates: Record<string, number>
): RingFencedCashSummary {
  const toAnchor = (local: number, currency: string): number => {
    const rate = rates[currency];
    return rate && rate > 0 ? local / rate : local;
  };
  let banksTotal = 0;
  let banksReported = 0;
  let bankCashAnchor = 0;
  let escrowAnchor = 0;
  let escrowContributors = 0;
  for (const row of rows) {
    if (row.charterActive) {
      banksTotal += 1;
      if (typeof row.cashReserves === "number" && Number.isFinite(row.cashReserves)) {
        banksReported += 1;
        bankCashAnchor += toAnchor(nonnegative(row.cashReserves), row.charterCurrency);
      }
    }
    if (typeof row.escrowBalance === "number" && Number.isFinite(row.escrowBalance)) {
      const anchor = toAnchor(nonnegative(row.escrowBalance), row.liquidCurrency);
      if (anchor > 0) {
        escrowAnchor += anchor;
        escrowContributors += 1;
      }
    }
  }
  return { banksTotal, banksReported, bankCashAnchor, escrowAnchor, escrowContributors };
}

function monetaryActivity(
  balanceSnapshot: BalanceSnapshot | null,
  turnoverRows: LedgerTurnoverRow[]
) {
  const balances = balanceSnapshot?.balances ?? {};
  const activeAccounts = new Set<string>();
  const turnoverByKind = new Map<string, number>();
  let grossTurnover = 0;
  // `isRealAccount` / `accountKind` stay here rather than moving into the
  // aggregation: the pipeline groups by account, and applying the
  // classification to ~1.4k grouped rows costs nothing while keeping the one
  // definition of a "real account" in one place.
  for (const row of turnoverRows) {
    if (!isRealAccount(row.account)) continue;
    activeAccounts.add(row.account);
    grossTurnover += row.turnover;
    const kind = accountKind(row.account);
    turnoverByKind.set(kind, (turnoverByKind.get(kind) ?? 0) + row.turnover);
  }

  let total = 0;
  let active = 0;
  const balanceByKind = new Map<string, number>();
  const accountCountByKind = new Map<string, number>();
  for (const [account, rawBalance] of Object.entries(balances)) {
    if (!isRealAccount(account)) continue;
    const balance = nonnegative(rawBalance);
    total += balance;
    if (activeAccounts.has(account)) active += balance;
    const kind = accountKind(account);
    balanceByKind.set(kind, (balanceByKind.get(kind) ?? 0) + balance);
    accountCountByKind.set(kind, (accountCountByKind.get(kind) ?? 0) + 1);
  }

  const velocity = (kinds: readonly string[]): number | null => {
    const stock = kinds.reduce((sum, kind) => sum + (balanceByKind.get(kind) ?? 0), 0);
    const flow = kinds.reduce((sum, kind) => sum + (turnoverByKind.get(kind) ?? 0), 0);
    return ratio(flow, stock);
  };
  const householdStock =
    (balanceByKind.get("character") ?? 0) + (balanceByKind.get("character_savings") ?? 0);
  const householdAccountCount =
    (accountCountByKind.get("character") ?? 0) + (accountCountByKind.get("character_savings") ?? 0);
  // An absent savings class is unmeasured, not zero: a 0/600 share would claim
  // the economy holds no savings when savings accounts simply do not exist.
  const savingsShare =
    (accountCountByKind.get("character_savings") ?? 0) === 0
      ? null
      : ratio(balanceByKind.get("character_savings") ?? 0, householdStock);
  return {
    total,
    active,
    dormant: Math.max(0, total - active),
    activeAccounts: activeAccounts.size,
    accountCount: Object.keys(balances).filter((account) => isRealAccount(account)).length,
    grossVelocity: ratio(grossTurnover, total),
    householdVelocity: velocity(["character", "character_savings"]),
    transactionalVelocity: velocity(["character"]),
    savingsVelocity: velocity(["character_savings"]),
    savingsShare,
    householdAccountCount,
    corporateVelocity: velocity(["corporation"]),
    partyVelocity: velocity(["party"]),
    governmentVelocity: velocity(["government"]),
    // Pooled vehicles hold modeled balances (fund/org cash legs, NPP investment
    // cash) but had no holder-class velocity: their flow dissolved into gross.
    intermediatedVelocity: velocity(["fund", "org", "npp"]),
  };
}

/**
 * Per-account primary-leg turnover over the window, grouped in Mongo.
 *
 * The previous version pulled every ledger entry in the window into Node and
 * summed the legs there. On a measured world that was 61,398 documents and
 * 23.5MB for a result of 1,389 rows and 88KB — a 273x difference in what
 * crosses the wire and gets deserialized, and BSON deserialization is the
 * single largest consumer of turn CPU.
 *
 * Grouping by the full account string rather than by kind is deliberate: it
 * keeps `isRealAccount` / `accountKind` as the one definition in TypeScript
 * instead of restating those rules as pipeline expressions that could drift.
 *
 * Uses only $match/$unwind/$group/$abs, so it stays within the aggregation
 * surface the rest of the app relies on.
 */
async function loadLedgerTurnover(
  db: Db,
  windowStart: number,
  turn: number
): Promise<LedgerTurnoverRow[]> {
  const rows = await db
    .collection<LedgerEntry>("ledgerEntries")
    .aggregate<{ _id: string; turnover: number }>([
      { $match: { turn: { $gte: windowStart, $lte: turn } } },
      { $unwind: "$legs" },
      { $match: { "legs.role": "primary" } },
      { $group: { _id: "$legs.account", turnover: { $sum: { $abs: "$legs.anchorAmount" } } } },
    ])
    .toArray();
  return rows.map((row) => ({ account: row._id, turnover: row.turnover }));
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
  const marketFormation = computeMarketFormationSnapshot({
    sectors: input.sectors,
    unownedSectors: input.unownedSectors ?? [],
    prices: input.prices,
    entryFunnel: input.entryFunnel,
    eraUnitScale: input.eraUnitScale ?? 1,
  });
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
  const listedCorporationIds = new Set(listings.map((listing) => listing._id.toString()));
  const listedFirmIncome = (input.firmIncome ?? []).filter((row) =>
    listedCorporationIds.has(row.corporationId)
  );
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
  // The eligible tradable set (#2033): zero-share / zero-float rows stay
  // visible as firms but leave every breadth denominator, and the retained
  // 48-turn window is intersected with it so dissolved/delisted corporations
  // cannot linger in a numerator after leaving the current listings.
  const tradable = listings.filter(isTradableListing);
  const tradableIds = tradableListingIds(listings);
  const quality = marketQuality(tradable, input.shareOrders, economicTrades);
  const competition = relevantMarketDiagnostics(input.commodityParticipants, input.currentFlows);
  const tradedCorporations = new Set(
    economicTrades
      .map((trade) => trade.corporationId.toString())
      .filter((id) => tradableIds.has(id))
  );
  const tradableCount = tradable.length;
  const activeBonds = input.bonds.filter((bond) => !bond.matured);
  const sovereignBonds = activeBonds.filter((bond) => bond.issuerType === "sovereign");
  const corporateBonds = activeBonds.filter((bond) => bond.issuerType !== "sovereign");
  const noHolderShare = (bonds: Bond[]) =>
    metric(
      ratio(
        bonds.filter((bond) => bond.holders.filter((holder) => holder.units > 0).length === 0)
          .length,
        bonds.length
      ),
      bonds.length,
      "unmatured_bond_count"
    );
  const bondHolderCounts = activeBonds.map(
    (bond) => bond.holders.filter((holder) => holder.units > 0).length
  );
  const bondHeldUnits = activeBonds.reduce(
    (sum, bond) =>
      sum + bond.holders.reduce((holderSum, holder) => holderSum + nonnegative(holder.units), 0),
    0
  );
  const bondFloatUnits = activeBonds.reduce((sum, bond) => sum + nonnegative(bond.publicFloat), 0);
  const sovereignHolderCounts = sovereignBonds.map(
    (bond) => bond.holders.filter((holder) => holder.units > 0).length
  );
  const corporateHolderCounts = corporateBonds.map(
    (bond) => bond.holders.filter((holder) => holder.units > 0).length
  );
  const corporateHeldUnits = corporateBonds.reduce(
    (sum, bond) =>
      sum + bond.holders.reduce((holderSum, holder) => holderSum + nonnegative(holder.units), 0),
    0
  );
  const corporateFloatUnits = corporateBonds.reduce(
    (sum, bond) => sum + nonnegative(bond.publicFloat),
    0
  );
  const sovereignHeldUnits = sovereignBonds.reduce(
    (sum, bond) =>
      sum + bond.holders.reduce((holderSum, holder) => holderSum + nonnegative(holder.units), 0),
    0
  );
  const sovereignFloatUnits = sovereignBonds.reduce(
    (sum, bond) => sum + nonnegative(bond.publicFloat),
    0
  );
  const sovereignFaceByMaturity = new Map<number, number>();
  for (const bond of sovereignBonds) {
    sovereignFaceByMaturity.set(
      bond.maturityTurn,
      (sovereignFaceByMaturity.get(bond.maturityTurn) ?? 0) + nonnegative(bond.totalIssued)
    );
  }
  const sovereignMaturityValues = [...sovereignFaceByMaturity.values()];
  const sovereignMaturityConcentration = concentration(sovereignMaturityValues);
  const corporateFaceByMaturity = new Map<number, number>();
  for (const bond of corporateBonds) {
    corporateFaceByMaturity.set(
      bond.maturityTurn,
      (corporateFaceByMaturity.get(bond.maturityTurn) ?? 0) + nonnegative(bond.totalIssued)
    );
  }
  const corporateMaturityValues = [...corporateFaceByMaturity.values()];
  const corporateMaturityConcentration = concentration(corporateMaturityValues);

  const wealth = input.globalWealth?.entries.map((entry) => Math.max(0, entry.totalWealth)) ?? [];
  const aggregateWealth = wealth.reduce((sum, value) => sum + value, 0);
  const topTenWealth = [...wealth]
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, value) => sum + value, 0);

  const moneyGrowth = input.money.flatMap((row) => {
    const growth = currentMoneyGrowth(row);
    return growth == null ? [] : [growth];
  });
  const inflationByCountry = new Map(
    Object.entries(input.health?.economy.byCountry ?? {}).flatMap(([countryId, row]) =>
      row && finite(row.inflation) ? [[countryId, row.inflation] as const] : []
    )
  );
  const pairedGrowth: number[] = [];
  const pairedInflation: number[] = [];
  for (const row of input.money) {
    const inflation = inflationByCountry.get(row.countryId);
    const growth = currentMoneyGrowth(row);
    if (growth == null || !finite(inflation)) continue;
    pairedGrowth.push(growth);
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
  // Bond-pool settlement inventory excluded from observed M2 under the v3
  // boundary (#2021). Legacy rows predate the field and contribute zero, so a
  // mixed-version window under-reports rather than inventing history.
  const totalExcludedBondPoolCash = input.money.reduce(
    (sum, row) => sum + Math.max(0, row.excludedBondPoolCash ?? 0),
    0
  );
  const currentAccountingRows = input.money.filter(
    (row) => row.accountingVersion === MONEY_ACCOUNTING_VERSION
  );
  const observationVersions: Record<string, number | null> = {};
  const observationConfidence: Record<string, "high" | "medium" | "low"> = {};
  for (const row of input.money) {
    observationVersions[row.currencyCode] = row.accountingVersion ?? null;
    observationConfidence[row.currencyCode] =
      currentMoneyGrowth(row) != null
        ? "high"
        : row.accountingVersion === MONEY_ACCOUNTING_VERSION
          ? "medium"
          : "low";
  }
  const activity = monetaryActivity(input.balanceSnapshot, input.ledgerTurnover);
  const ring = summarizeRingFencedCash(input.ringFenced ?? [], input.anchorRates ?? {});
  const ringBankIncomplete = ring.banksTotal > ring.banksReported;
  const ringTotal = ring.bankCashAnchor + ring.escrowAnchor;
  const history = input.history ?? [];
  const coverage = computeCoverage(input.turn, history);
  const measurementReasons: string[] = [];
  if (ringBankIncomplete) {
    measurementReasons.push(
      `bank_cash_incomplete_${ring.banksReported}_of_${ring.banksTotal}_reporting`
    );
  }
  if (coverage.missingTurns.length > 0) {
    measurementReasons.push(`window_missing_${coverage.missingTurns.length}_turns`);
  }
  if (!input.reconciliation) measurementReasons.push("current_turn_reconciliation_unavailable");
  else if (input.reconciliation.status !== "green") {
    measurementReasons.push(`reconciliation_${input.reconciliation.status}`);
  }
  if (input.reconciliation?.stockVsFlow.skipped) {
    measurementReasons.push("stock_vs_flow_skipped");
  }
  if (!input.balanceSnapshot) measurementReasons.push("balance_snapshot_unavailable");
  if (quality.spreads.length < 5) measurementReasons.push("fewer_than_five_two_sided_books");
  if (input.currentFlows.length === 0) measurementReasons.push("commodity_flow_sample_empty");
  if (input.commodityParticipants.length === 0) {
    measurementReasons.push("commodity_participant_sample_empty");
  }
  if (!input.entryFunnel) measurementReasons.push("npp_entry_funnel_unavailable");
  if (currentAccountingRows.length < input.money.length) {
    measurementReasons.push("money_observation_version_transition");
  }
  if (moneyGrowth.length < currentAccountingRows.length) {
    measurementReasons.push("money_growth_awaiting_comparable_window");
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
      // Commodities whose recorded demand was cut by the 1.5x caps this turn,
      // and the worst latent shortage among them (#1460). Every unmet-share
      // figure elsewhere in this report is measured AFTER those caps.
      demandTruncatedCommodities: metric(
        input.prices.filter((p) => (p.demandTruncatedUnits ?? 0) > 0).length,
        input.prices.length,
        "commodity_count"
      ),
      maxLatentShortageMultiple: metric(
        input.prices.reduce((max, p) => Math.max(max, p.latentShortageMultiple ?? 0), 0),
        input.prices.length,
        "commodity_count"
      ),
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
        ratio(listedFirmIncome.filter((row) => row.income < 0).length, listedFirmIncome.length),
        listedFirmIncome.length,
        "same_turn_listed_corporation_history_income"
      ),
      marketCapHhi: metric(firmConcentration.hhi, listings.length, "market_cap_anchor"),
      topFourMarketCapShare: metric(
        firmConcentration.topFourShare,
        listings.length,
        "market_cap_anchor"
      ),
    },
    competition,
    marketFormation,
    securities: {
      equityTrades48Turns: economicTrades.length,
      equityNotionalAnchor48Turns: economicTrades.reduce(
        (sum, trade) => sum + Math.max(0, trade.totalAnchor),
        0
      ),
      activeTradedListingShare: metric(
        clampShare(ratio(tradedCorporations.size, tradableCount)),
        tradableCount,
        "tradable_listing_count_48_turns"
      ),
      activeBonds: activeBonds.length,
      noHolderBondShare: metric(
        ratio(bondHolderCounts.filter((count) => count === 0).length, activeBonds.length),
        activeBonds.length,
        "unmatured_bond_count"
      ),
      sovereignNoHolderBondShare: noHolderShare(sovereignBonds),
      corporateNoHolderBondShare: noHolderShare(corporateBonds),
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
      sovereignMedianHolders: metric(
        median(sovereignHolderCounts),
        sovereignBonds.length,
        "unmatured_sovereign_issue_count"
      ),
      sovereignSubscriptionRate: metric(
        ratio(sovereignHeldUnits, sovereignHeldUnits + sovereignFloatUnits),
        sovereignBonds.length,
        "unmatured_sovereign_units"
      ),
      corporateMedianHolders: metric(
        median(corporateHolderCounts),
        corporateBonds.length,
        "unmatured_corporate_issue_count"
      ),
      corporateSubscriptionRate: metric(
        ratio(corporateHeldUnits, corporateHeldUnits + corporateFloatUnits),
        corporateBonds.length,
        "unmatured_corporate_units"
      ),
      sovereignMaturityHhi: metric(
        sovereignMaturityConcentration.hhi,
        sovereignMaturityValues.length,
        "sovereign_face_by_maturity_turn"
      ),
      corporateMaturityHhi: metric(
        corporateMaturityConcentration.hhi,
        corporateMaturityValues.length,
        "corporate_face_by_maturity_turn"
      ),
      sovereignMedianPriceToParSpreadPct: metric(
        median(sovereignBonds.map((bond) => (1 - bond.marketPrice) * 100)),
        sovereignBonds.length,
        "unmatured_sovereign_issue_count"
      ),
      sovereignIssuanceByCountry: summarizeSovereignIssuanceByCountry(
        activeBonds,
        input.sovereignDemand
          ? (issue: SovereignDiagnosticBond) =>
              classifySovereignDemandGap(
                {
                  countryId: issue.countryId ?? null,
                  currencyCode: issue.currencyCode ?? null,
                  totalIssued: issue.totalIssued,
                  faceValue: issue.faceValue,
                  publicFloat: issue.publicFloat,
                  heldUnitsByFundKey: fundUnitsByKey(
                    issue.holders,
                    input.sovereignDemand!.fundIdToKey
                  ),
                },
                input.sovereignDemand!.funds,
                {
                  tradableCurrencies: input.sovereignDemand!.tradableCurrencies,
                  controlledCurrencies: input.sovereignDemand!.controlledCurrencies,
                },
                input.sovereignDemand!.ratingByCountry,
                input.sovereignDemand!.crossBorderEnabled
              )
          : undefined
      ),
      corporateMedianPriceToParSpreadPct: metric(
        median(corporateBonds.map((bond) => (1 - bond.marketPrice) * 100)),
        corporateBonds.length,
        "unmatured_corporate_issue_count"
      ),
      openBuyOrders: quality.openBuyOrders,
      openSellOrders: quality.openSellOrders,
      twoSidedListingShare: metric(
        clampShare(ratio(quality.twoSidedListings, tradableCount)),
        tradableCount,
        "tradable_listing_count_open_order_books"
      ),
      facilityQuotedListings: quality.facilityQuotedListings,
      organicTwoSidedListingShare: metric(
        clampShare(ratio(quality.organicTwoSidedListings, tradableCount)),
        tradableCount,
        "tradable_listing_count_open_order_books_excluding_liquidity_facility"
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
      organicDepthToMarketCap: metric(
        ratio(quality.organicDepthAnchor, marketCapTotal),
        input.shareOrders.filter(
          (order) => order.status === "open" && order.liquidityProvider !== true
        ).length,
        "open_order_notional_to_listed_market_cap_excluding_liquidity_facility"
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
      medianTopTraderNotionalShare48: metric(
        median(quality.topTraderShares),
        quality.topTraderShares.length,
        "named_counterparty_share_of_listing_notional_48_turns"
      ),
    },
    coverage,
    securitiesRecent12: {
      depthToMarketCapMedian: recent12Median(
        input.turn,
        history,
        ratio(quality.depthAnchor, marketCapTotal),
        (row) => row.depthToMarketCap,
        "open_order_notional_to_listed_market_cap_median_12"
      ),
      twoSidedListingShareMedian: recent12Median(
        input.turn,
        history,
        clampShare(ratio(quality.twoSidedListings, tradableCount)),
        (row) => row.twoSidedListingShare,
        "tradable_listing_count_open_order_books_median_12"
      ),
      activeTradedListingShareMedian: recent12Median(
        input.turn,
        history,
        clampShare(ratio(tradedCorporations.size, tradableCount)),
        (row) => row.activeTradedListingShare,
        "tradable_listing_count_48_turns_median_12"
      ),
      sovereignNoHolderBondShareMedian: recent12Median(
        input.turn,
        history,
        noHolderShare(sovereignBonds).value,
        (row) => row.sovereignNoHolderBondShare,
        "unmatured_sovereign_issue_count_median_12"
      ),
      corporateNoHolderBondShareMedian: recent12Median(
        input.turn,
        history,
        noHolderShare(corporateBonds).value,
        (row) => row.corporateNoHolderBondShare,
        "unmatured_corporate_issue_count_median_12"
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
      currentAccountingCurrencies: currentAccountingRows.length,
      comparableGrowthCurrencies: moneyGrowth.length,
      /** Per-currency observation contract version; null on legacy observations. */
      observationVersions,
      /** Per-currency growth comparability: high = comparable, medium = current method but warming, low = legacy. */
      observationConfidence,
      /** Bond-pool settlement inventory excluded from observed M2 (#2021). */
      excludedBondPoolCash: metric(
        totalExcludedBondPoolCash,
        input.money.length,
        "currency_stock_sum"
      ),
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
        input.ledgerEntryCount,
        "absolute_primary_ledger_flow_to_closing_balance"
      ),
      householdGrossVelocity48: metric(
        activity.householdVelocity,
        activity.activeAccounts,
        "character_primary_ledger_flow_to_closing_balance"
      ),
      householdTransactionalVelocity48: metric(
        activity.transactionalVelocity,
        activity.activeAccounts,
        "character_primary_ledger_flow_to_closing_balance"
      ),
      householdSavingsVelocity48: metric(
        activity.savingsVelocity,
        activity.activeAccounts,
        "character_savings_primary_ledger_flow_to_closing_balance"
      ),
      savingsShareOfHouseholdBalances: metric(
        activity.savingsShare,
        activity.householdAccountCount,
        "character_savings_share_of_household_closing_balance"
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
      intermediatedGrossVelocity48: metric(
        activity.intermediatedVelocity,
        activity.activeAccounts,
        "fund_org_npp_primary_ledger_flow_to_closing_balance"
      ),
      bankCashReservesAnchor: metric(
        ring.banksTotal === 0 || ring.banksReported > 0 ? ring.bankCashAnchor : null,
        ring.banksReported,
        "active_chartered_bank_cash_reserves_anchor"
      ),
      escrowCashAnchor: metric(
        ring.escrowAnchor,
        ring.escrowContributors,
        "corporation_share_escrow_nonnegative_anchor"
      ),
      ringFencedShareOfLiquid: metric(
        !input.balanceSnapshot || ringBankIncomplete || activity.total + ringTotal <= 0
          ? null
          : ratio(ringTotal, activity.total + ringTotal),
        ring.banksReported + ring.escrowContributors,
        "ring_fenced_to_ledger_backed_plus_ring_fenced_closing_stock"
      ),
      bankGrossVelocity48: metric(null, 0, "bank_turnover_not_in_ledger"),
    },
    measurement: { confidence: measurementConfidence, reasons: measurementReasons },
    reconciliation: {
      status: input.reconciliation?.status ?? "unavailable",
      trialBalanceUnbalancedCount: input.reconciliation?.trialBalance.unbalancedCount ?? null,
      stockVsFlowDivergentCount: input.reconciliation?.stockVsFlow.divergentCount ?? null,
      stockVsFlowSkipped: input.reconciliation?.stockVsFlow.skipped ?? null,
      moneySupplyFindingCount: input.reconciliation?.moneySupply.findings.length ?? null,
      stockVsFlowByKind:
        input.reconciliation && !input.reconciliation.stockVsFlow.skipped
          ? (input.reconciliation.stockVsFlow.byKind ?? null)
          : null,
    },
  };
}

/**
 * Mirror of `resolveFundBondCountryId` (fundBondReserve): the country whose
 * paper a fund buys when restricted to home paper. Kept local so the
 * diagnostics path does not import the deploy shell.
 */
function resolveGapFundHome(fund: Pick<IndexFund, "countryId" | "anchorCurrencyCode">): string {
  if (fund.countryId) return fund.countryId;
  const byCurrency = (Object.entries(COUNTRY_CURRENCY_MAP) as [string, string][]).find(
    ([, currency]) => currency === fund.anchorCurrencyCode
  );
  if (byCurrency) return byCurrency[0]!;
  return "US";
}

/**
 * Assemble the #1001 demand-gap input from the loader's projected reads plus
 * the already-loaded bonds. All reads are batched; the per-fund bond
 * principal is valued in memory from the `bonds` read the securities section
 * already performs, so this adds no per-row query.
 */
function assembleSovereignFundDemand(
  bonds: Bond[],
  funds: IndexFund[],
  ratings: { _id: string; creditRating?: string }[],
  fxRows: ExchangeRate[],
  crossBorderEnabled: boolean
): SovereignFundDemandInput {
  const rateByCurrency = new Map(fxRows.map((row) => [row.currencyCode, row.rate]));
  const tradableCurrencies = fxRows.flatMap((row) =>
    row.currencyCode && typeof row.rate === "number" && row.rate > 0 ? [row.currencyCode] : []
  );
  const controlledCurrencies = fxRows.flatMap((row) =>
    row.currencyCode && row.capitalControls === true ? [row.currencyCode] : []
  );
  const ratingByCountry = new Map<string, string | undefined>();
  for (const row of ratings) {
    ratingByCountry.set(row._id === "federal" ? "US" : row._id, row.creditRating);
  }
  const universeBySlug = new Map(
    getAllFundDefinitions().flatMap((def) =>
      def.bondUniverse ? [[def.slug, def.bondUniverse] as const] : []
    )
  );
  // A position in a currency with no live rate contributes nothing instead of
  // failing the snapshot; the issue itself then classifies as
  // `currency_mismatch`, which is the actionable reading.
  const principalByFundId = new Map<string, number>();
  for (const bond of bonds) {
    const currencyCode =
      bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : "USD");
    const rate = rateByCurrency.get(currencyCode) ?? 0;
    if (!(rate > 0)) continue;
    const price = Number.isFinite(bond.marketPrice) ? bond.marketPrice : 1;
    for (const holder of bond.holders ?? []) {
      const fundId = holder.fundId?.toString();
      const units =
        typeof holder.units === "number" && Number.isFinite(holder.units)
          ? Math.floor(holder.units)
          : 0;
      if (!fundId || units <= 0) continue;
      const local = units * BOND_UNIT_FACE_VALUE * price;
      principalByFundId.set(
        fundId,
        (principalByFundId.get(fundId) ?? 0) + corpCapitalToAnchor(local, currencyCode, rate)
      );
    }
  }
  const gapFunds: SovereignDemandGapFund[] = [];
  const fundIdToKey = new Map<string, string>();
  for (const fund of funds) {
    const id = fund._id.toString();
    fundIdToKey.set(id, fund.slug);
    // Same serviceability as the deploy pass (`listServiceableFunds`).
    const serviceable =
      fund.status === "active" ||
      (fund.status === "paused" && fund.pauseReason === "backing_ratio");
    const breakdown = computeFundAllocationBreakdown(
      {
        cashAnchor: fund.cashAnchor ?? 0,
        holdings: fund.holdings ?? [],
        bondAllocations: [],
        kind: fund.kind,
      },
      { bondPrincipalAnchor: principalByFundId.get(id) ?? 0 }
    );
    gapFunds.push({
      key: fund.slug,
      homeCountryId: resolveGapFundHome(fund),
      scope: fund.scope,
      kind: fund.kind,
      active: serviceable,
      deployableCashAnchor: breakdown.cashAvailableForBondDeployAnchor,
      cashAboveBufferAnchor: Math.max(
        0,
        breakdown.cashAnchor -
          Math.min(
            breakdown.cashAnchor,
            INDEX_FUND_RESERVE_CASH_BUFFER_FRACTION * breakdown.totalBackingAnchor
          )
      ),
      // Coverage funds ensured under the #1001 domestic gate carry no standing
      // definition entry; like the deploy path (`deployBondReserveFromCash`),
      // a country bond fund with a home country means its home-sovereign
      // mandate. Without this the classifier skips the fund and reports its
      // home issues as `no_domestic_fund` after coverage ensured it.
      bondUniverse:
        fund.kind === "bond"
          ? (universeBySlug.get(fund.slug) ??
            (fund.countryId ? ({ issuerType: "sovereign", homeOnly: true } as const) : undefined))
          : undefined,
    });
  }
  return {
    funds: gapFunds,
    fundIdToKey,
    tradableCurrencies,
    controlledCurrencies,
    ratingByCountry,
    crossBorderEnabled,
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
    firmIncome,
    trades,
    shareOrders,
    bonds,
    globalWealth,
    money,
    health,
    reconciliation,
    balanceSnapshot,
    ledgerTurnover,
    ledgerEntryCount,
    groupMembership,
    exchangeRates,
    ringFencedCorps,
    unownedSectors,
    entryFunnel,
    eraUnitScale,
    historyDocs,
    demandFunds,
    demandRatings,
    demandLiquidity,
  ] = await Promise.all([
    db.collection<CommodityFlow>("commodityFlows").find({ turn }).toArray(),
    db
      .collection<CommodityFlow>("commodityFlows")
      // Historical fill-rate medians only need these pooled totals. In
      // particular, do not decode each turn's large `byCountry` diagnostic
      // object for the entire 48-turn window.
      .find(
        { turn: { $gte: windowStart, $lte: turn } },
        {
          projection: {
            turn: 1,
            demandUnitsLedger: 1,
            demandUnits: 1,
            clearedUnitsPooled: 1,
            clearedUnits: 1,
          },
        }
      )
      .toArray(),
    db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
    db.collection<CommoditySourcingDoc>("commoditySourcingFlows").find({ turn }).toArray(),
    // This diagnostics pass needs only commodity-flow inputs, production-health
    // readings, and the market-formation identity fields below. An exclusion
    // projection still decoded every other scalar on ~4,500 sectors; this
    // explicit read contract cuts the local payload from ~6.6MB to ~1.8MB.
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {},
        {
          projection: {
            _id: 1,
            corporationId: 1,
            countryId: 1,
            stateId: 1,
            sectorType: 1,
            revenue: 1,
            strategyId: 1,
            transitionFromStrategyId: 1,
            transitionStartTurn: 1,
            capitalStock: 1,
            operatingCapacityUnits: 1,
            producedUnits: 1,
            mothballed: 1,
            productionPolicyLevel: 1,
            embargoSuspended: 1,
            embargoExportExposure: 1,
            militaryDivertedFraction: 1,
            militaryDivertedTurn: 1,
            throughputFactor: 1,
            soldUnits: 1,
            workersDesired: 1,
            workers: 1,
            lowFillTurns: 1,
            stockpileUnsold: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        }
      )
      .toArray(),
    db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "global" }),
    db
      .collection<{ corporationId: { toString(): string }; income: number }>("corporationHistory")
      .find({ turn }, { projection: { corporationId: 1, income: 1 } })
      .toArray(),
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
    loadLedgerTurnover(db, windowStart, turn),
    db
      .collection<LedgerEntry>("ledgerEntries")
      .countDocuments({ turn: { $gte: windowStart, $lte: turn } }),
    resolveFormalizedGroups(db),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    // Ring-fenced money lives on corporations, outside the ledger: active bank
    // charter reserves plus share-escrow balances. Narrow projection on
    // purpose: only the classification and balance fields below are read.
    db
      .collection<Corporation>("corporations")
      .find(
        { $or: [{ bankCharter: { $exists: true } }, { shareEscrowBalance: { $exists: true } }] },
        {
          projection: {
            "bankCharter.status": 1,
            "bankCharter.currency": 1,
            "bankCharter.cashReserves": 1,
            liquidCurrencyCode: 1,
            shareEscrowBalance: 1,
          },
        }
      )
      .toArray(),
    db.collection<UnownedSector>("unownedSectors").find({}).toArray(),
    db
      .collection<NppMarketEntryFunnel>(NPP_MARKET_ENTRY_FUNNEL_COLLECTION)
      .findOne({ _id: `turn:${turn}` }),
    loadWorldEraUnitScale(db),
    // Narrow projection on purpose: the full snapshot carries per-cell arrays.
    db
      .collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
      .find({ turn: { $gte: windowStart, $lt: turn } })
      .project<HistoryProjection>({
        turn: 1,
        "securities.depthToMarketCap.value": 1,
        "securities.twoSidedListingShare.value": 1,
        "securities.activeTradedListingShare.value": 1,
        "securities.sovereignNoHolderBondShare.value": 1,
        "securities.corporateNoHolderBondShare.value": 1,
      })
      .sort({ turn: 1 })
      .toArray(),
    // #1001 demand-gap inputs: three batched projected reads, no per-row
    // loop. Fund holdings arrays stay out of the projection; the bond
    // principal comes from the `bonds` read above, computed in memory below.
    db
      .collection<IndexFund>("indexFunds")
      .find(
        {},
        {
          projection: {
            slug: 1,
            countryId: 1,
            scope: 1,
            kind: 1,
            status: 1,
            pauseReason: 1,
            anchorCurrencyCode: 1,
            cashAnchor: 1,
            "holdings.shares": 1,
            "holdings.avgCostPerShareAnchor": 1,
            "holdings.lastValueAnchor": 1,
          },
        }
      )
      .toArray(),
    db
      .collection<{ _id: string; creditRating?: string }>("federalBudget")
      .find({}, { projection: { creditRating: 1 } })
      .toArray(),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { indexFundBondLiquidityEnabled: 1 } }),
  ]);
  const fxByCurrency = new Map(exchangeRates.map((row) => [row.currencyCode, row.rate]));
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1);
  const ringFenced: RingFencedCashRow[] = ringFencedCorps.map((corp) => ({
    charterActive: corp.bankCharter?.status === "active",
    charterCurrency: corp.bankCharter?.currency ?? "USD",
    cashReserves: corp.bankCharter?.cashReserves,
    // Absent on pre-forex corps: home currency, same fallback the
    // corporation type documents for liquidCapital.
    liquidCurrency: corp.liquidCurrencyCode ?? "USD",
    escrowBalance: corp.shareEscrowBalance,
  }));
  const commodityParticipants: CommodityParticipant[] = [];
  for (const sector of sectors) {
    const corporationId = sector.corporationId.toString();
    const currencyCode = COUNTRY_CURRENCY_MAP[sector.countryId];
    const fxRate = fxByCurrency.get(currencyCode) ?? 1;
    const { supply, demand } = computeSectorCommodityUnits(
      {
        ...sector,
        revenueAnchor: fxRate > 0 ? sector.revenue / fxRate : sector.revenue,
        capacityUnits: sector.operatingCapacityUnits ?? sector.capitalStock,
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
  const history: VitalSignsHistoryRow[] = historyDocs.map((doc) => ({
    turn: doc.turn,
    depthToMarketCap: doc.securities?.depthToMarketCap?.value ?? null,
    twoSidedListingShare: doc.securities?.twoSidedListingShare?.value ?? null,
    activeTradedListingShare: doc.securities?.activeTradedListingShare?.value ?? null,
    sovereignNoHolderBondShare: doc.securities?.sovereignNoHolderBondShare?.value ?? null,
    corporateNoHolderBondShare: doc.securities?.corporateNoHolderBondShare?.value ?? null,
  }));
  const sovereignDemand = assembleSovereignFundDemand(
    bonds,
    demandFunds,
    demandRatings,
    exchangeRates,
    demandLiquidity?.indexFundBondLiquidityEnabled === true
  );
  const snapshot = computeEconomicVitalSigns({
    turn,
    now: new Date(),
    history,
    currentFlows,
    flowHistory,
    prices,
    sourcing,
    sectors,
    globalExchange,
    firmIncome: firmIncome.map((row) => ({
      corporationId: row.corporationId.toString(),
      income: row.income,
    })),
    trades,
    shareOrders,
    bonds,
    globalWealth,
    money,
    health,
    reconciliation,
    balanceSnapshot,
    ledgerTurnover,
    ledgerEntryCount,
    ringFenced,
    anchorRates: Object.fromEntries(fxByCurrency),
    commodityParticipants,
    unownedSectors,
    entryFunnel,
    eraUnitScale,
    sovereignDemand,
  });
  await db
    .collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
    .replaceOne({ _id: snapshot._id }, snapshot, { upsert: true });
  return snapshot;
}
