/**
 * Deterministic balance report for the finite-cash equity liquidity facility.
 *
 * Run with:
 *   npx tsx scripts/sim/indexFundLiquidity2026-09-03.ts
 */
import {
  EQUITY_LIQUIDITY_MAX_CASH_SHARE,
  EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE,
  EQUITY_LIQUIDITY_STRESS_HAIRCUT,
  planEquityLiquidityQuoteRules,
  type EquityLiquidityRuleFund,
  type EquityLiquidityRuleListing,
} from "../../src/lib/indexFunds/equityLiquidity/rules";

const LISTING_COUNT = 368;
const FUND_COUNT = 18;
const SHARES_PER_ISSUER = 143_333;
const OLD_LISTING_SHARE = 0.4;
const OLD_QUOTES_PER_FUND = 24;
const OLD_ISSUED_SHARE = 0.001;
const OLD_HOLDING_SHARE = 0.1;

interface BaselinePlan {
  fundId: string;
  corporationId: string;
  bidShares: number;
  askShares: number;
  referencePriceAnchor: number;
  bidNotionalAnchor: number;
  stressLossAnchor: number;
}

function listings(): EquityLiquidityRuleListing[] {
  return Array.from({ length: LISTING_COUNT }, (_, index) => ({
    corporationId: `corp-${index.toString().padStart(3, "0")}`,
    countryId: `country-${index % 12}`,
    type: `sector-${index % 9}`,
    referencePriceLocal: 10 * 1.08 ** (index % 72),
    referencePriceAnchor: 10 * 1.08 ** (index % 72),
    totalShares: SHARES_PER_ISSUER,
  }));
}

function funds(rows: EquityLiquidityRuleListing[]): EquityLiquidityRuleFund[] {
  return Array.from({ length: FUND_COUNT }, (_, index) => {
    const held = rows.filter((_, listingIndex) => listingIndex % FUND_COUNT === index);
    return {
      id: `fund-${index.toString().padStart(2, "0")}`,
      scope: "global",
      kind: "broad",
      cashAnchor: 10_000_000,
      quotedNav: 100,
      unitSupply: 1_000_000,
      holdingValueAnchor: 90_000_000,
      holdings: held.map((listing) => ({
        corporationId: listing.corporationId,
        shares: 14_333,
      })),
      targetCorporationIds: held.map((listing) => listing.corporationId),
    };
  });
}

function oldPlans(
  fundRows: EquityLiquidityRuleFund[],
  listingRows: EquityLiquidityRuleListing[]
): BaselinePlan[] {
  const slots = new Map<string, number>();
  const remainingCash = new Map(
    fundRows.map((fund) => [
      fund.id,
      Math.min(
        fund.cashAnchor * EQUITY_LIQUIDITY_MAX_CASH_SHARE,
        ((fund.cashAnchor + fund.holdingValueAnchor) * EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE) /
          EQUITY_LIQUIDITY_STRESS_HAIRCUT
      ),
    ])
  );
  const maxListings = Math.floor(LISTING_COUNT * OLD_LISTING_SHARE);
  const plans: BaselinePlan[] = [];

  for (const listing of listingRows.slice(0, maxListings)) {
    const provider = fundRows.find(
      (fund) =>
        (slots.get(fund.id) ?? 0) < OLD_QUOTES_PER_FUND &&
        fund.holdings.some((holding) => holding.corporationId === listing.corporationId)
    );
    if (!provider) continue;
    const holding = provider.holdings.find((row) => row.corporationId === listing.corporationId)!;
    const cashRisk = remainingCash.get(provider.id) ?? 0;
    const shares = Math.floor(
      Math.min(
        holding.shares * OLD_HOLDING_SHARE,
        listing.totalShares * OLD_ISSUED_SHARE,
        cashRisk / listing.referencePriceAnchor
      )
    );
    if (shares <= 0) continue;
    const bidNotionalAnchor = shares * listing.referencePriceAnchor;
    if (bidNotionalAnchor < 100) continue;
    plans.push({
      fundId: provider.id,
      corporationId: listing.corporationId,
      bidShares: shares,
      askShares: shares,
      referencePriceAnchor: listing.referencePriceAnchor,
      bidNotionalAnchor,
      stressLossAnchor: bidNotionalAnchor * EQUITY_LIQUIDITY_STRESS_HAIRCUT,
    });
    slots.set(provider.id, (slots.get(provider.id) ?? 0) + 1);
    remainingCash.set(provider.id, cashRisk - bidNotionalAnchor);
  }
  return plans;
}

function metrics(plans: BaselinePlan[]) {
  const bidDepth = plans.reduce((sum, plan) => sum + plan.bidNotionalAnchor * 0.98, 0);
  const askDepth = plans.reduce(
    (sum, plan) => sum + plan.askShares * plan.referencePriceAnchor * 1.02,
    0
  );
  return {
    listingsQuoted: new Set(plans.map((plan) => plan.corporationId)).size,
    bidDepth,
    askDepth,
    stressLoss: plans.reduce((sum, plan) => sum + plan.stressLossAnchor, 0),
    maxBidShares: Math.max(0, ...plans.map((plan) => plan.bidShares)),
    medianBidShares: [...plans].map((plan) => plan.bidShares).sort((a, b) => a - b)[
      Math.floor(plans.length / 2)
    ],
  };
}

const listingRows = listings();
const fundRows = funds(listingRows);
const before = oldPlans(fundRows, listingRows);
const after = planEquityLiquidityQuoteRules({
  funds: fundRows,
  listings: listingRows,
  totalListings: listingRows.length,
  turn: 0,
});

const beforeMetrics = metrics(before);
const afterMetrics = metrics(after);
const totalFundCash = fundRows.reduce((sum, fund) => sum + fund.cashAnchor, 0);
const escrowShare = afterMetrics.bidDepth / totalFundCash;

console.log("Index fund liquidity balance report");
console.table([
  { arm: "before", ...beforeMetrics },
  { arm: "after", ...afterMetrics },
]);
console.log({
  listingCoverageBefore: beforeMetrics.listingsQuoted / LISTING_COUNT,
  listingCoverageAfter: afterMetrics.listingsQuoted / LISTING_COUNT,
  bidDepthMultiple: afterMetrics.bidDepth / beforeMetrics.bidDepth,
  afterEscrowShareOfFundCash: escrowShare,
  allAsksInventoryBacked: after.every((plan) => {
    const fund = fundRows.find((row) => row.id === plan.fundId)!;
    const held = fund.holdings.find((row) => row.corporationId === plan.corporationId)?.shares ?? 0;
    return plan.askShares <= held;
  }),
  allBidsCashBacked: afterMetrics.bidDepth <= totalFundCash,
});
