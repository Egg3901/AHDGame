import { ObjectId, type Db } from "mongodb";
import type { Corporation, IndexFund, ShareOrder } from "@/lib/db/types";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import {
  cancelFundShareOrder,
  placeFundShareBuyOrder,
  placeFundShareSellOrder,
} from "@/lib/indexFunds/fundShareOrders";
import {
  planEquityLiquidityQuoteRules,
  type EquityLiquidityRuleQuotePlan,
} from "@/lib/indexFunds/equityLiquidity/rules";

export {
  EQUITY_LIQUIDITY_HALF_SPREAD,
  EQUITY_LIQUIDITY_MAX_LISTING_SHARE,
  EQUITY_LIQUIDITY_MAX_LISTINGS,
  EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND,
  EQUITY_LIQUIDITY_MAX_HOLDING_SHARE,
  EQUITY_LIQUIDITY_MAX_ISSUED_SHARE,
  EQUITY_LIQUIDITY_MAX_CASH_SHARE,
  EQUITY_LIQUIDITY_STRESS_HAIRCUT,
  EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE,
  EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR,
  EQUITY_LIQUIDITY_TARGET_NOTIONAL_ANCHOR,
  EQUITY_LIQUIDITY_TARGET_MARKET_CAP_SHARE,
} from "@/lib/indexFunds/equityLiquidity/rules";

export const EQUITY_LIQUIDITY_SNAPSHOTS_COLLECTION = "equityLiquidityFacilitySnapshots";

export interface EquityLiquidityListing {
  corporationId: ObjectId;
  referencePriceLocal: number;
  referencePriceAnchor: number;
  totalShares: number;
  fxRate: number;
  type?: Corporation["type"];
  secondaryType?: Corporation["secondaryType"];
  corporation: Pick<Corporation, "_id" | "countryId" | "liquidCurrencyCode">;
}

export interface EquityLiquidityQuotePlan {
  fundId: ObjectId;
  corporationId: ObjectId;
  bidShares: number;
  askShares: number;
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
  bidQuotesPlanned: number;
  bidQuotesPlaced: number;
  askQuotesPlanned: number;
  askQuotesPlaced: number;
  bidDepthAnchor: number;
  askDepthAnchor: number;
  stressLossAtRiskAnchor: number;
  participatingFunds: number;
}

/**
 * Allocate one provider to each quoted listing. Cash-at-risk is capped by both
 * 15 percent of live cash and a 0.5 percent AUM loss under a 10 percent price
 * shock. Bids may establish bounded inventory inside a fund's mandate; asks
 * remain capped by inventory. No synthetic cash or short inventory is used.
 */
export function planEquityLiquidityQuotes(input: {
  funds: IndexFund[];
  listings: EquityLiquidityListing[];
  totalListings: number;
  turn: number;
}): EquityLiquidityQuotePlan[] {
  const plans: EquityLiquidityRuleQuotePlan[] = planEquityLiquidityQuoteRules({
    turn: input.turn,
    totalListings: input.totalListings,
    funds: input.funds.map((fund) => ({
      id: fund._id.toString(),
      scope: fund.scope,
      kind: fund.kind,
      countryId: fund.countryId,
      sectorType: fund.sectorType,
      cashAnchor: fund.cashAnchor,
      quotedNav: fund.quotedNav,
      unitSupply: fund.unitSupply,
      holdingValueAnchor: computeHoldingsValueAnchor(fund),
      holdings: fund.holdings.map((holding) => ({
        corporationId: holding.corporationId.toString(),
        shares: holding.shares,
      })),
      targetCorporationIds: fund.targetConstituents.map((target) =>
        target.corporationId.toString()
      ),
    })),
    listings: input.listings.map((listing) => ({
      corporationId: listing.corporationId.toString(),
      countryId: listing.corporation.countryId,
      type: listing.type,
      secondaryType: listing.secondaryType ?? undefined,
      referencePriceLocal: listing.referencePriceLocal,
      referencePriceAnchor: listing.referencePriceAnchor,
      totalShares: listing.totalShares,
    })),
  });
  return plans.map((plan) => ({
    ...plan,
    fundId: new ObjectId(plan.fundId),
    corporationId: new ObjectId(plan.corporationId),
  }));
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
    bidQuotesPlanned: 0,
    bidQuotesPlaced: 0,
    askQuotesPlanned: 0,
    askQuotesPlaced: 0,
    bidDepthAnchor: 0,
    askDepthAnchor: 0,
    stressLossAtRiskAnchor: 0,
    participatingFunds: 0,
  };

  if (input.enabled) {
    const plans = planEquityLiquidityQuotes(input);
    snapshot.bidQuotesPlanned = plans.length;
    snapshot.askQuotesPlanned = plans.filter((plan) => plan.askShares > 0).length;
    snapshot.quotePairsPlanned = snapshot.askQuotesPlanned;
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
        shares: plan.bidShares,
        limitPriceLocal: plan.bidPriceLocal,
        fxRate: listing.fxRate,
        liquidityQuote,
      });
      if (!bid.ok || !bid.orderId) {
        snapshot.quotePairsFailed++;
        continue;
      }
      snapshot.bidQuotesPlaced++;
      snapshot.bidDepthAnchor += (plan.bidShares * plan.bidPriceLocal) / listing.fxRate;

      if (plan.askShares > 0) {
        const ask = await placeFundShareSellOrder(db, {
          fund,
          corp: listing.corporation,
          shares: plan.askShares,
          limitPriceLocal: plan.askPriceLocal,
          liquidityQuote,
        });
        if (!ask.ok) {
          snapshot.quotePairsFailed++;
        } else {
          snapshot.quotePairsPlaced++;
          snapshot.askQuotesPlaced++;
          snapshot.askDepthAnchor += (plan.askShares * plan.askPriceLocal) / listing.fxRate;
        }
      }

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
