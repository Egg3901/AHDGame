import { ObjectId, type Db } from "mongodb";
import type { Corporation, IndexFund, ShareOrder } from "@/lib/db/types";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import {
  cancelFundShareOrder,
  placeFundShareBuyOrder,
  placeFundShareSellOrder,
} from "@/lib/indexFunds/fundShareOrders";

export const EQUITY_LIQUIDITY_HALF_SPREAD = 0.02;
export const EQUITY_LIQUIDITY_MAX_LISTING_SHARE = 0.4;
export const EQUITY_LIQUIDITY_MAX_LISTINGS = 256;
export const EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND = 24;
export const EQUITY_LIQUIDITY_MAX_HOLDING_SHARE = 0.1;
export const EQUITY_LIQUIDITY_MAX_ISSUED_SHARE = 0.001;
export const EQUITY_LIQUIDITY_MAX_CASH_SHARE = 0.15;
export const EQUITY_LIQUIDITY_STRESS_HAIRCUT = 0.1;
export const EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE = 0.005;
export const EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR = 100;

export const EQUITY_LIQUIDITY_SNAPSHOTS_COLLECTION = "equityLiquidityFacilitySnapshots";

export interface EquityLiquidityListing {
  corporationId: ObjectId;
  referencePriceLocal: number;
  referencePriceAnchor: number;
  totalShares: number;
  fxRate: number;
  corporation: Pick<Corporation, "_id" | "countryId" | "liquidCurrencyCode">;
}

export interface EquityLiquidityQuotePlan {
  fundId: ObjectId;
  corporationId: ObjectId;
  shares: number;
  bidPriceLocal: number;
  askPriceLocal: number;
  referencePriceLocal: number;
  referencePriceAnchor: number;
  bidNotionalAnchor: number;
  stressLossAnchor: number;
}

export interface EquityLiquidityFacilitySnapshot {
  _id: ObjectId;
  turn: number;
  enabled: boolean;
  generatedAt: Date;
  priorQuotesCancelled: number;
  listingsEligible: number;
  quotePairsPlanned: number;
  quotePairsPlaced: number;
  quotePairsFailed: number;
  bidDepthAnchor: number;
  askDepthAnchor: number;
  stressLossAtRiskAnchor: number;
  participatingFunds: number;
}

function positive(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : 0;
}

/**
 * Allocate one provider to each quoted listing. Cash-at-risk is capped by both
 * 15 percent of live cash and a 0.5 percent AUM loss under a 10 percent price
 * shock. Inventory is capped at 10 percent of a holding and 0.1 percent of the
 * issuer. No fund can quote more than 24 listings at once.
 */
export function planEquityLiquidityQuotes(input: {
  funds: IndexFund[];
  listings: EquityLiquidityListing[];
  totalListings: number;
  turn: number;
}): EquityLiquidityQuotePlan[] {
  const fundById = new Map(input.funds.map((fund) => [fund._id.toString(), fund]));
  const slotsByFund = new Map<string, number>();
  const remainingCashRisk = new Map<string, number>();
  for (const fund of input.funds) {
    const holdingValue = computeHoldingsValueAnchor(fund);
    const observedBacking = positive(fund.cashAnchor) + holdingValue;
    const quotedBacking = positive(fund.quotedNav) * positive(fund.unitSupply);
    const aum = Math.max(observedBacking, quotedBacking);
    const stressBoundNotional =
      aum > 0
        ? (aum * EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE) / EQUITY_LIQUIDITY_STRESS_HAIRCUT
        : 0;
    remainingCashRisk.set(
      fund._id.toString(),
      Math.min(positive(fund.cashAnchor) * EQUITY_LIQUIDITY_MAX_CASH_SHARE, stressBoundNotional)
    );
  }

  const maxListings = Math.min(
    EQUITY_LIQUIDITY_MAX_LISTINGS,
    Math.floor(Math.max(0, input.totalListings) * EQUITY_LIQUIDITY_MAX_LISTING_SHARE)
  );
  if (maxListings <= 0) return [];

  const sortedListings = [...input.listings].sort((a, b) =>
    a.corporationId.toString().localeCompare(b.corporationId.toString())
  );
  const rotationOffset = sortedListings.length > 0 ? input.turn % sortedListings.length : 0;
  const rotated = [
    ...sortedListings.slice(rotationOffset),
    ...sortedListings.slice(0, rotationOffset),
  ];
  const plans: EquityLiquidityQuotePlan[] = [];

  for (const listing of rotated) {
    if (plans.length >= maxListings) break;
    if (
      listing.referencePriceLocal <= 0 ||
      listing.referencePriceAnchor <= 0 ||
      listing.totalShares <= 0
    ) {
      continue;
    }

    const providers = input.funds
      .flatMap((fund) => {
        const holding = fund.holdings.find(
          (row) => row.corporationId.toString() === listing.corporationId.toString()
        );
        return holding && holding.shares > 0 ? [{ fund, shares: holding.shares }] : [];
      })
      .sort(
        (a, b) => b.shares - a.shares || a.fund._id.toString().localeCompare(b.fund._id.toString())
      );

    for (const provider of providers) {
      const fundId = provider.fund._id.toString();
      if (!fundById.has(fundId)) continue;
      if ((slotsByFund.get(fundId) ?? 0) >= EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND) continue;
      const cashRisk = remainingCashRisk.get(fundId) ?? 0;
      if (cashRisk < EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR) continue;

      const inventoryShares = Math.floor(
        Math.min(
          provider.shares * EQUITY_LIQUIDITY_MAX_HOLDING_SHARE,
          listing.totalShares * EQUITY_LIQUIDITY_MAX_ISSUED_SHARE,
          cashRisk / listing.referencePriceAnchor
        )
      );
      if (inventoryShares <= 0) continue;
      const bidNotionalAnchor = inventoryShares * listing.referencePriceAnchor;
      if (bidNotionalAnchor < EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR) continue;

      plans.push({
        fundId: provider.fund._id,
        corporationId: listing.corporationId,
        shares: inventoryShares,
        bidPriceLocal: listing.referencePriceLocal * (1 - EQUITY_LIQUIDITY_HALF_SPREAD),
        askPriceLocal: listing.referencePriceLocal * (1 + EQUITY_LIQUIDITY_HALF_SPREAD),
        referencePriceLocal: listing.referencePriceLocal,
        referencePriceAnchor: listing.referencePriceAnchor,
        bidNotionalAnchor,
        stressLossAnchor: bidNotionalAnchor * EQUITY_LIQUIDITY_STRESS_HAIRCUT,
      });
      slotsByFund.set(fundId, (slotsByFund.get(fundId) ?? 0) + 1);
      remainingCashRisk.set(fundId, cashRisk - bidNotionalAnchor);
      break;
    }
  }

  return plans;
}

export async function refreshEquityLiquidityFacility(input: {
  db: Db;
  turn: number;
  enabled: boolean;
  funds: IndexFund[];
  listings: EquityLiquidityListing[];
  totalListings: number;
}): Promise<EquityLiquidityFacilitySnapshot> {
  const { db, turn } = input;
  const priorQuotes = await db
    .collection<ShareOrder>("shareOrders")
    .find({ liquidityProvider: true, status: "open" })
    .toArray();
  for (const order of priorQuotes) {
    await cancelFundShareOrder(db, order._id);
  }

  const snapshot: EquityLiquidityFacilitySnapshot = {
    _id: new ObjectId(),
    turn,
    enabled: input.enabled,
    generatedAt: new Date(),
    priorQuotesCancelled: priorQuotes.length,
    listingsEligible: input.listings.length,
    quotePairsPlanned: 0,
    quotePairsPlaced: 0,
    quotePairsFailed: 0,
    bidDepthAnchor: 0,
    askDepthAnchor: 0,
    stressLossAtRiskAnchor: 0,
    participatingFunds: 0,
  };

  if (input.enabled) {
    const plans = planEquityLiquidityQuotes(input);
    snapshot.quotePairsPlanned = plans.length;
    const fundById = new Map(input.funds.map((fund) => [fund._id.toString(), fund]));
    const listingById = new Map(
      input.listings.map((listing) => [listing.corporationId.toString(), listing])
    );
    const participatingFunds = new Set<string>();

    for (const plan of plans) {
      const fund = fundById.get(plan.fundId.toString());
      const listing = listingById.get(plan.corporationId.toString());
      if (!fund || !listing) {
        snapshot.quotePairsFailed++;
        continue;
      }
      const liquidityQuote = { turn, referencePrice: plan.referencePriceLocal };
      const bid = await placeFundShareBuyOrder(db, {
        fund,
        corp: listing.corporation,
        shares: plan.shares,
        limitPriceLocal: plan.bidPriceLocal,
        fxRate: listing.fxRate,
        liquidityQuote,
      });
      if (!bid.ok || !bid.orderId) {
        snapshot.quotePairsFailed++;
        continue;
      }
      const ask = await placeFundShareSellOrder(db, {
        fund,
        corp: listing.corporation,
        shares: plan.shares,
        limitPriceLocal: plan.askPriceLocal,
        liquidityQuote,
      });
      if (!ask.ok) {
        await cancelFundShareOrder(db, bid.orderId);
        snapshot.quotePairsFailed++;
        continue;
      }

      snapshot.quotePairsPlaced++;
      snapshot.bidDepthAnchor += (plan.shares * plan.bidPriceLocal) / listing.fxRate;
      snapshot.askDepthAnchor += (plan.shares * plan.askPriceLocal) / listing.fxRate;
      snapshot.stressLossAtRiskAnchor += plan.stressLossAnchor;
      participatingFunds.add(plan.fundId.toString());
    }
    snapshot.participatingFunds = participatingFunds.size;
  }

  await db
    .collection<EquityLiquidityFacilitySnapshot>(EQUITY_LIQUIDITY_SNAPSHOTS_COLLECTION)
    .replaceOne({ turn }, snapshot, { upsert: true });
  return snapshot;
}
