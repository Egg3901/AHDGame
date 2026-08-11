// src/lib/indexFunds/fundTargetRebalance.test.ts
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { planFundTargetRebalance } from "./fundTargetRebalance";

const corpId = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

function fund(over: Partial<Parameters<typeof planFundTargetRebalance>[0]["fund"]> = {}) {
  return {
    _id: new ObjectId(),
    anchorCurrencyCode: "USD" as const,
    cashAnchor: 1_000_000,
    holdings: [],
    targetConstituents: [],
    ...over,
  };
}

describe("planFundTargetRebalance", () => {
  it("buys an underweight constituent up to the deficit, capped by per-turn cap and float", () => {
    const c = corpId(1);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 1_000_000,
        holdings: [],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 50_000,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    // target value = 1 * 0.75 * 1,000,000 = 750,000 -> 75,000 target shares.
    // capped by per-turn cap floor(1,000,000/100)=10,000 and float 50,000 -> 10,000 shares.
    expect(plan.sells).toHaveLength(0);
    expect(plan.buys).toHaveLength(1);
    expect(plan.buys[0].shares).toBe(10_000);
    expect(plan.buys[0].sharePriceAnchor).toBe(10);
  });

  it("sells an overweight constituent back toward target, capped per turn", () => {
    const c = corpId(2);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 100_000,
        holdings: [
          {
            corporationId: c,
            shares: 500_000,
            avgCostPerShareAnchor: 10,
            lastValueAnchor: 5_000_000,
          },
        ],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 0,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    // backing = 100,000 + 5,000,000 = 5,100,000; equity max = 3,825,000;
    // target shares = floor(3,825,000/10) = 382,500; drift = 117,500;
    // sell cap = floor(1,000,000/100) = 10,000 -> sell 10,000 shares.
    expect(plan.buys).toHaveLength(0);
    expect(plan.sells).toHaveLength(1);
    expect(plan.sells[0].shares).toBe(10_000);
  });

  it("fully sells a holding that is no longer a target constituent (drift = current)", () => {
    const c = corpId(3);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 0,
        holdings: [
          { corporationId: c, shares: 5_000, avgCostPerShareAnchor: 10, lastValueAnchor: 50_000 },
        ],
        targetConstituents: [],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 0,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    // target weight 0 -> target shares 0 -> drift 5,000; sell cap floor(1e6/100)=10,000 -> sell all 5,000.
    expect(plan.sells).toHaveLength(1);
    expect(plan.sells[0].shares).toBe(5_000);
  });

  it("targets the 75% equity bucket, not all cash (reserve stays uninvested)", () => {
    const c = corpId(4);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 30_000,
        holdings: [],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 50_000,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    // backing = 30,000; equity target = 1 * 0.75 * 30,000 = 22,500 -> floor(22,500/10) = 2,250 shares.
    // (NOT 3,000 = all cash — the 25% reserve stays in cash.) Cap floor(1e6/100)=10,000 and float 50,000 don't bind.
    expect(plan.buys[0].shares).toBe(2_250);
  });

  it("emits bids[] empty array when not underweight", () => {
    const c = corpId(5);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 100_000,
        holdings: [
          {
            corporationId: c,
            shares: 500_000,
            avgCostPerShareAnchor: 10,
            lastValueAnchor: 5_000_000,
          },
        ],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 0,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    expect(plan.bids).toHaveLength(0);
  });

  it("emits no bid when float fully covers the deficit", () => {
    // deficit = 10,000 shares; float = 50,000 (more than enough); no bid needed
    const c = corpId(6);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 1_000_000,
        holdings: [],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 50_000, // float=50k, cap=10k, deficit=75k → float covers capped 10k fully
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    // cap = floor(1e6/100)=10,000; float=50,000 > cap=10,000 so float covers fully → no bid
    expect(plan.buys).toHaveLength(1);
    expect(plan.buys[0].shares).toBe(10_000);
    expect(plan.bids).toHaveLength(0);
  });

  it("emits a bid for the residual when float < deficit (float partially covers)", () => {
    // deficit=75,000, cap=10,000, float=3,000 → float covers 3,000, bid for 7,000
    const c = corpId(7);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 1_000_000,
        holdings: [],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 3_000, // float=3k < cap=10k
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    expect(plan.buys).toHaveLength(1);
    expect(plan.buys[0].shares).toBe(3_000); // capped by float
    expect(plan.bids).toHaveLength(1);
    // residual = cappedDeficit(10k) - floatBuyable(3k) = 7k, bounded by remaining cash budget
    expect(plan.bids[0].corporationId).toEqual(c);
    expect(plan.bids[0].shares).toBeGreaterThan(0);
    // Specifically: stockBudget=750k; buy consumes 3k*10=30k; remaining=720k;
    // bid = min(7k, floor(720k/10)=72k) = 7k
    expect(plan.bids[0].shares).toBe(7_000);
  });

  it("emits a bid for the full deficit when float is zero", () => {
    // float=0, so no float buy; bid for the full deficit bounded by cash budget
    const c = corpId(8);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 1_000_000,
        holdings: [],
        targetConstituents: [{ corporationId: c, targetWeight: 1, marketCapAnchor: 0 }],
      }),
      corps: [
        {
          _id: c,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 0,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    expect(plan.buys).toHaveLength(0);
    expect(plan.bids).toHaveLength(1);
    // deficit=75k, rawRateCap=floor(1M/100)=10k, cappedDeficit=10k
    // floatBuyable=0 (no float), residual=10k, bounded by budget 750k → bid=10k
    expect(plan.bids[0].shares).toBe(10_000);
  });

  it("bid shares are bounded by remaining cash budget after float buys", () => {
    // Two corps underweight; first eats most of the budget leaving little for second's bid
    const c1 = corpId(9);
    const c2 = corpId(10);
    const plan = planFundTargetRebalance({
      fund: fund({
        cashAnchor: 100_000, // tight budget
        holdings: [],
        targetConstituents: [
          { corporationId: c1, targetWeight: 0.5, marketCapAnchor: 0 },
          { corporationId: c2, targetWeight: 0.5, marketCapAnchor: 0 },
        ],
      }),
      corps: [
        {
          _id: c1,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 2_000,
          liquidCurrencyCode: "USD",
        },
        {
          _id: c2,
          sharePrice: 10,
          totalShares: 1_000_000,
          publicFloat: 0,
          liquidCurrencyCode: "USD",
        },
      ],
      exchangeRates: { USD: 1 },
      bondPrincipalAnchor: 0,
    });
    // stockBudget = min(0.75*100k, 100k) = 75k
    // c1: deficit=floor(0.5*0.75*100k/10)=3750; cap=floor(1M/100)=10k; cappedDeficit=min(3750,10k)=3750
    //     floatBuyable=min(3750,2000)=2000; buy 2k; residual=1750 bid
    // c2: deficit=3750; cap=0 (float=0); cappedDeficit=3750; bid=3750
    // buys total=20k; bids: 1750*10=17500 + 3750*10=37500 = 55k
    // total = 20k + 55k = 75k → within budget
    const totalBidValue = plan.bids.reduce((s, b) => s + b.valueAnchor, 0);
    const totalBuyValue = plan.buys.reduce((s, b) => s + b.valueAnchor, 0);
    expect(totalBuyValue + totalBidValue).toBeLessThanOrEqual(75_000);
  });
});
