import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  planFundCrossRebalancing,
  updateHoldingAfterPurchase,
  updateHoldingAfterSale,
} from "./fundCrossRebalancing";
import type { CrossRebalanceCorp, CrossRebalanceFund } from "./fundCrossRebalancing";

function makeCorp(overrides?: Partial<CrossRebalanceCorp>): CrossRebalanceCorp {
  return {
    _id: new ObjectId(),
    sharePrice: 100,
    fundamentalSharePrice: 100,
    totalShares: 1_000_000,
    publicFloat: 100_000,
    liquidCurrencyCode: "USD",
    ...overrides,
  };
}

function makeFund(overrides?: Partial<CrossRebalanceFund>): CrossRebalanceFund {
  return {
    _id: new ObjectId(),
    name: "Test Fund",
    anchorCurrencyCode: "USD",
    status: "active",
    cashAnchor: 1_000_000,
    holdings: [],
    targetConstituents: [],
    bondAllocations: [],
    ...overrides,
  };
}

describe("planFundCrossRebalancing", () => {
  it("matches an overweight seller with an underweight buyer", () => {
    const corp = makeCorp();
    const corpId = corp._id;

    const seller = makeFund({
      name: "Seller",
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 1_000, avgCostPerShareAnchor: 100 }],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      ],
    });

    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 1_000_000,
      holdings: [],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      ],
    });

    // The 10% constituent weight applies to each fund's 75% equity bucket.
    // Seller target = 75 shares, buyer target = 750 shares, so the buyer's
    // deficit caps this transfer at 750 shares.
    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].sellerFundId.toString()).toBe(seller._id.toString());
    expect(plans[0].buyerFundId.toString()).toBe(buyer._id.toString());
    expect(plans[0].shares).toBe(750);
    expect(plans[0].valueAnchor).toBeCloseTo(75_000, 0);
  });

  it("limits transfer by buyer cash", () => {
    const corp = makeCorp();
    const corpId = corp._id;

    const seller = makeFund({
      name: "Seller",
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 500, avgCostPerShareAnchor: 100 }],
      targetConstituents: [{ corporationId: corpId, targetWeight: 0, marketCapAnchor: 0 }],
    });

    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 10_000,
      holdings: [],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].shares).toBe(7); // 10% of the buyer's $7.5k equity bucket
  });

  it("sells holdings above the equity-bucket target into an underweight fund", () => {
    const corp = makeCorp();
    const seller = makeFund({
      name: "Seller",
      cashAnchor: 60_000,
      holdings: [{ corporationId: corp._id, shares: 400, avgCostPerShareAnchor: 100 }],
      targetConstituents: [
        { corporationId: corp._id, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
    });
    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 100_000,
      targetConstituents: [
        { corporationId: corp._id, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
    });

    // The seller has $100k backing and $40k in this stock. The ordinary
    // rebalance target is 50% of its $75k equity bucket, or $37.5k.
    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].shares).toBe(25);
    expect(plans[0].valueAnchor).toBe(2_500);
  });

  it("limits transfer by buyer equity headroom", () => {
    const corp = makeCorp();
    const corpId = corp._id;

    const seller = makeFund({
      name: "Seller",
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 500, avgCostPerShareAnchor: 100 }],
      targetConstituents: [{ corporationId: corpId, targetWeight: 0, marketCapAnchor: 0 }],
    });

    // Buyer has plenty of cash but is already at the 75% equity cap.
    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 250_000,
      holdings: [
        {
          corporationId: new ObjectId(),
          shares: 7_500,
          avgCostPerShareAnchor: 100,
          lastValueAnchor: 750_000,
        },
      ],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(0);
  });

  it("caps a buyer's cumulative equity spend across multiple corps in one pass", () => {
    // Buyer is underweight in two distinct corps. Each 50% constituent target
    // is 37.5 shares of its $7.5k equity bucket, rounded down to 37 shares.
    // Another $1k holding leaves only $6.5k of equity headroom, so the
    // combined 74-share deficit must stop at 65 shares.
    const corpA = makeCorp();
    const corpB = makeCorp();

    const sellerA = makeFund({
      name: "Seller A",
      cashAnchor: 0,
      holdings: [{ corporationId: corpA._id, shares: 1_000, avgCostPerShareAnchor: 100 }],
      targetConstituents: [{ corporationId: corpA._id, targetWeight: 0, marketCapAnchor: 0 }],
    });
    const sellerB = makeFund({
      name: "Seller B",
      cashAnchor: 0,
      holdings: [{ corporationId: corpB._id, shares: 1_000, avgCostPerShareAnchor: 100 }],
      targetConstituents: [{ corporationId: corpB._id, targetWeight: 0, marketCapAnchor: 0 }],
    });

    // $9k cash + $1k existing holdings → backing $10k, headroom $6.5k.
    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 9_000,
      holdings: [
        {
          corporationId: new ObjectId(),
          shares: 10,
          avgCostPerShareAnchor: 100,
          lastValueAnchor: 1_000,
        },
      ],
      targetConstituents: [
        { corporationId: corpA._id, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
        { corporationId: corpB._id, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [sellerA, sellerB, buyer],
      corps: [corpA, corpB],
      exchangeRates: {},
    });

    const buyerShares = plans
      .filter((p) => p.buyerFundId.toString() === buyer._id.toString())
      .reduce((sum, p) => sum + p.shares, 0);
    const buyerSpend = plans
      .filter((p) => p.buyerFundId.toString() === buyer._id.toString())
      .reduce((sum, p) => sum + p.valueAnchor, 0);

    expect(buyerShares).toBe(65);
    expect(buyerSpend).toBeCloseTo(6_500, 0);
  });

  it("does not match funds with different anchor currencies", () => {
    const corp = makeCorp();
    const corpId = corp._id;

    const seller = makeFund({
      name: "Seller",
      anchorCurrencyCode: "USD",
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 1_000, avgCostPerShareAnchor: 100 }],
      targetConstituents: [{ corporationId: corpId, targetWeight: 0, marketCapAnchor: 0 }],
    });

    const buyer = makeFund({
      name: "Buyer",
      anchorCurrencyCode: "EUR",
      cashAnchor: 1_000_000,
      holdings: [],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: { USD: 1, EUR: 0.9 },
    });

    expect(plans).toHaveLength(0);
  });

  it("sells removed constituents (zero target weight) to funds that target them", () => {
    const corp = makeCorp();
    const corpId = corp._id;

    const seller = makeFund({
      name: "Seller",
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 500, avgCostPerShareAnchor: 100 }],
      targetConstituents: [],
    });

    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 1_000_000,
      holdings: [],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].shares).toBe(500);
  });

  it("processes each corporation independently", () => {
    const corpA = makeCorp();
    const corpB = makeCorp();

    const seller = makeFund({
      cashAnchor: 0,
      holdings: [
        { corporationId: corpA._id, shares: 500, avgCostPerShareAnchor: 100 },
        { corporationId: corpB._id, shares: 500, avgCostPerShareAnchor: 100 },
      ],
      targetConstituents: [],
    });

    const buyer = makeFund({
      cashAnchor: 2_000_000,
      holdings: [],
      targetConstituents: [
        { corporationId: corpA._id, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
        { corporationId: corpB._id, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corpA, corpB],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(2);
    expect(plans.reduce((sum, p) => sum + p.shares, 0)).toBe(1_000);
  });

  it("ignores inactive funds", () => {
    const corp = makeCorp();
    const corpId = corp._id;

    const seller = makeFund({
      name: "Seller",
      status: "paused",
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 1_000, avgCostPerShareAnchor: 100 }],
      targetConstituents: [{ corporationId: corpId, targetWeight: 0, marketCapAnchor: 0 }],
    });

    const buyer = makeFund({
      name: "Buyer",
      cashAnchor: 1_000_000,
      holdings: [],
      targetConstituents: [
        { corporationId: corpId, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
    });

    const plans = planFundCrossRebalancing({
      funds: [seller, buyer],
      corps: [corp],
      exchangeRates: {},
    });

    expect(plans).toHaveLength(0);
  });
});

describe("updateHoldingAfterPurchase", () => {
  it("adds a new holding when none exists", () => {
    const corpId = new ObjectId();
    const holdings = updateHoldingAfterPurchase([], corpId, 100, 50);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      corporationId: corpId,
      shares: 100,
      avgCostPerShareAnchor: 50,
      lastValueAnchor: 5_000,
    });
  });

  it("blends average cost for an existing holding", () => {
    const corpId = new ObjectId();
    const holdings = updateHoldingAfterPurchase(
      [{ corporationId: corpId, shares: 100, avgCostPerShareAnchor: 40, lastValueAnchor: 4_000 }],
      corpId,
      100,
      60
    );
    expect(holdings[0].shares).toBe(200);
    expect(holdings[0].avgCostPerShareAnchor).toBe(50);
    expect(holdings[0].lastValueAnchor).toBe(12_000);
  });
});

describe("updateHoldingAfterSale", () => {
  it("reduces shares and last value", () => {
    const corpId = new ObjectId();
    const holdings = updateHoldingAfterSale(
      [
        {
          corporationId: corpId,
          shares: 1_000,
          avgCostPerShareAnchor: 50,
          lastValueAnchor: 50_000,
        },
      ],
      corpId,
      400,
      100
    );
    expect(holdings[0].shares).toBe(600);
    expect(holdings[0].lastValueAnchor).toBe(60_000);
  });

  it("removes a holding when all shares are sold", () => {
    const corpId = new ObjectId();
    const holdings = updateHoldingAfterSale(
      [{ corporationId: corpId, shares: 100, avgCostPerShareAnchor: 50, lastValueAnchor: 5_000 }],
      corpId,
      100,
      100
    );
    expect(holdings).toHaveLength(0);
  });
});
