/**
 * Controlled new-sovereign-coupon and auction-demand sensitivity for issue #2322.
 * Principal and rating scenarios are fixed inputs; this is not a debt-spiral world simulation.
 */

import { CREDIT_RATINGS, getEffectiveRate } from "@/lib/db/types/centralBank";
import { calculateCreditRating } from "@/lib/budget/debt";
import { sovereignCreditSpreadPp } from "@/lib/bonds/rules/sovereignCreditSpread";
import { getSovereignCouponRate } from "@/lib/bonds/sovereign";
import { computeMarketDemand } from "@/lib/sovereignDefault/marketDemand";

const PRIME_RATE = 5;
const FACE = 1_000_000_000;
const MATURITY = 48 as const;
const cases = [
  { name: "healthy", debtToGdp: 0.5, turnsSinceLastDefault: null },
  { name: "stressed", debtToGdp: 1.1, turnsSinceLastDefault: null },
  { name: "post-default", debtToGdp: 2.6, turnsSinceLastDefault: 0 },
  { name: "recovered", debtToGdp: 0.5, turnsSinceLastDefault: 100 },
] as const;

const results = cases.map((scenario) => {
  const rating = calculateCreditRating(scenario.debtToGdp);
  const spread = sovereignCreditSpreadPp(rating);
  const newCoupon = getSovereignCouponRate(PRIME_RATE, MATURITY, 0, spread);
  const marketCoupon = getEffectiveRate(PRIME_RATE, rating);
  const demand = computeMarketDemand({
    countryCode: "TEST",
    currentTurn: 200,
    debtToGdp: scenario.debtToGdp,
    inflationRate: 0.03,
    trust: 0.5,
    sovereignCouponRate: marketCoupon,
    fxDepreciationRate10t: 0,
    turnsSinceLastDefault: scenario.turnsSinceLastDefault,
    entityHoldings: 0,
    requiredIssuance: FACE,
  });

  return {
    name: scenario.name,
    debtToGdp: scenario.debtToGdp,
    rating,
    spreadPp: spread,
    marketCouponRatePct: marketCoupon,
    newFortyEightTurnCouponRatePct: newCoupon,
    annualCouponCostOnOneBillion: (newCoupon / 100) * FACE,
    marketDemandRatio: demand.demandRatio,
    couponDemandContribution: demand.components.find((part) => part.id === "couponPremium")
      ?.contribution,
  };
});

const legacyCoupon = getSovereignCouponRate(PRIME_RATE, MATURITY);
const rollovers = [
  { turn: 0, rating: "AAA" as const },
  { turn: 48, rating: "CCC" as const },
  { turn: 96, rating: "AAA" as const },
  { turn: 144, rating: "BBB" as const },
  { turn: 192, rating: "CCC" as const },
  { turn: 240, rating: "AAA" as const },
].map(({ turn, rating }) => {
  const coupon = getSovereignCouponRate(PRIME_RATE, MATURITY, 0, sovereignCreditSpreadPp(rating));
  return {
    turn,
    rating,
    newCouponRatePct: coupon,
    annualCouponCostOnOneBillion: (coupon * FACE) / 100,
  };
});

for (const result of results) {
  if (result.rating !== calculateCreditRating(result.debtToGdp)) {
    throw new Error(`rating ladder mismatch in ${result.name}`);
  }
  if (result.newFortyEightTurnCouponRatePct !== result.marketCouponRatePct) {
    throw new Error(`new coupon diverged from the rating-only auction rate in ${result.name}`);
  }
}

if (
  legacyCoupon !== 5 ||
  rollovers[0].newCouponRatePct !== 5 ||
  rollovers[1].newCouponRatePct !== 17 ||
  rollovers[2].newCouponRatePct !== 5
) {
  throw new Error("coupon or rollover calibration changed unexpectedly");
}

console.log(
  JSON.stringify(
    {
      source:
        "Baseline 9461ef2e34abe44a91893615cef1b20074a21ae5 with candidate issuer-risk correction",
      model: "Deterministic coupon and auction-demand sensitivity; not a world simulation",
      assumptions: {
        primeRatePct: PRIME_RATE,
        faceValue: FACE,
        maturityTurns: MATURITY,
        maturityTermPremiumPp: 0,
        chairSpreadPp: 0,
        democracySpreadPp: 0,
        householdOrGdpFeedback: "not modeled",
        debtStockAndRatingPath: "externally fixed scenario path; no endogenous compounding",
      },
      ratingSchedule: CREDIT_RATINGS,
      cases: results,
      refiPath: rollovers,
      oldContractCouponAfterRatingChangePct: 5,
      legacyNewCouponAtAnyRatingPct: legacyCoupon,
      limitation:
        "A pinned sandbox world is still required to assess macro debt-spiral consequences.",
    },
    null,
    2
  )
);
