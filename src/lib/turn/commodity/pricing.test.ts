import { describe, expect, it } from "vitest";
import {
  COMMODITY_TYPES,
  COMMODITY_PRICE_DRIFT_RATE,
  type CommodityType,
} from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types";
import {
  buildLaggedRatios,
  buildNudgeMap,
  buildPriceHistoryDocs,
  priceCommodity,
  type CommodityPricingContext,
} from "./pricing";
import type { CountryLedger, GlobalLedger, StateLedger } from "./ledgerTypes";

const BASE = Object.fromEntries(COMMODITY_TYPES.map((c) => [c, 100])) as Record<
  CommodityType,
  number
>;

function balanceMaps(food: { supply: number; demand: number }): {
  global: GlobalLedger;
  byState: StateLedger;
  byCountry: CountryLedger;
} {
  const one = () => ({ supply: 0, demand: 0 });
  const global: GlobalLedger = new Map(COMMODITY_TYPES.map((c) => [c, one()]));
  const byState: StateLedger = new Map([
    ["s1", new Map(COMMODITY_TYPES.map((c) => [c, c === "food" ? { ...food } : one()]))],
  ]);
  const byCountry: CountryLedger = new Map([
    ["US", new Map(COMMODITY_TYPES.map((c) => [c, c === "food" ? { ...food } : one()]))],
  ]);
  global.set("food", { ...food });
  return { global, byState, byCountry };
}

function pricingContext(
  food: { supply: number; demand: number },
  overrides?: Partial<CommodityPricingContext>
): CommodityPricingContext {
  const { global, byState, byCountry } = balanceMaps(food);
  return {
    ledgerBasePrices: BASE,
    commodityNominalPriceIndex: 1,
    scarcityDriftEnabled: false,
    commandEconomyEnabled: false,
    priceCurrentYear: null,
    freightSettlementActive: false,
    freightRampFraction: 1,
    freightSettlement: null,
    existingPriceMap: new Map(),
    nudgeMap: new Map(),
    laggedRatios: new Map(),
    reachableBooks: new Map(),
    global,
    byCountry,
    byState,
    allStates: [{ _id: "s1" }],
    stateToCountry: new Map([["s1", "US"]]),
    demandTruncated: new Map(),
    scarcityMultByCommodity: new Map(),
    appliedGlobalPrices: new Map(),
    appliedStatePrices: new Map(),
    appliedNationalPrices: new Map(),
    turn: 1,
    now: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("buildNudgeMap", () => {
  it("keeps only docs carrying a nudge price", () => {
    const out = buildNudgeMap([
      { commodity: "food", nudgePrice: 70 },
      { commodity: "vehicles", nudgePrice: null },
    ] as Pick<CommodityPrice, "commodity" | "nudgePrice">[]);
    expect(out.get("food")).toBe(70);
    expect(out.has("vehicles")).toBe(false);
  });
});

describe("buildLaggedRatios", () => {
  it("ratios prior price against the nominal-scaled base", () => {
    const out = buildLaggedRatios(
      BASE,
      new Map([["food", { commodity: "food", globalPrice: 200 } as CommodityPrice]]),
      1
    );
    expect(out.get("food")).toBe(2);
    expect(out.has("vehicles")).toBe(false);
  });
});

describe("priceCommodity", () => {
  it("writes a full price op and records applied prices", () => {
    const ctx = pricingContext({ supply: 100, demand: 120 });
    const seen = new Set<string>();
    const { commodity, priceOp } = priceCommodity(ctx, "food", seen);
    expect(commodity).toBe("food");
    const set = priceOp.updateOne.update.$set;
    expect(set.globalPrice).toBeGreaterThan(0);
    expect(set.statePrices["s1"]).toBeGreaterThan(0);
    expect(set.nationalPrices["US"]).toBeGreaterThan(0);
    expect(set.nudgePrice).toBeNull();
    expect(set.stateNudges).toEqual({});
    expect(priceOp.updateOne.upsert).toBe(true);
    expect(seen.has("s1")).toBe(true);
    expect(ctx.appliedGlobalPrices.get("food")).toBe(set.globalPrice);
    expect(ctx.appliedNationalPrices.get("food")!["US"]).toBe(set.nationalPrices["US"]);
  });

  it("drifts the state price toward target at the drift rate", () => {
    const bal = { supply: 100, demand: 200 };
    const first = pricingContext(bal);
    const { priceOp: op1 } = priceCommodity(first, "food", new Set());
    const target = op1.updateOne.update.$set.statePrices["s1"];
    const globalG = op1.updateOne.update.$set.globalPrice;

    const start = target * 2;
    const second = pricingContext(bal, {
      existingPriceMap: new Map([
        ["food", { commodity: "food", globalPrice: globalG, statePrices: { s1: start } }],
      ]) as Map<string, CommodityPrice>,
      appliedGlobalPrices: new Map(),
      appliedStatePrices: new Map(),
      appliedNationalPrices: new Map(),
    });
    const { priceOp: op2 } = priceCommodity(second, "food", new Set());
    const next = op2.updateOne.update.$set.statePrices["s1"];
    // Same balances and same lagged global ⇒ same target; one drift step.
    expect(next).toBeCloseTo(start + COMMODITY_PRICE_DRIFT_RATE * (target - start), 2);
  });

  it("applies peg precedence: state peg > global peg", () => {
    const ctx = pricingContext(
      { supply: 100, demand: 120 },
      {
        existingPriceMap: new Map([
          ["food", { commodity: "food", hardPeg: 50, stateHardPegs: { s1: 60 } }],
        ]) as Map<string, CommodityPrice>,
      }
    );
    const { priceOp } = priceCommodity(ctx, "food", new Set());
    expect(priceOp.updateOne.update.$set.globalPrice).toBe(50);
    expect(priceOp.updateOne.update.$set.statePrices["s1"]).toBe(60);
  });

  it("applies a global nudge over the drifted price", () => {
    const ctx = pricingContext({ supply: 100, demand: 120 }, { nudgeMap: new Map([["food", 70]]) });
    const { priceOp } = priceCommodity(ctx, "food", new Set());
    expect(priceOp.updateOne.update.$set.globalPrice).toBe(70);
    expect(priceOp.updateOne.update.$set.statePrices["s1"]).toBe(70);
  });
});

describe("buildPriceHistoryDocs", () => {
  it("snapshots applied prices per commodity", () => {
    const { global } = balanceMaps({ supply: 100, demand: 120 });
    const docs = buildPriceHistoryDocs({
      global,
      demandTruncated: new Map(),
      appliedGlobalPrices: new Map([["food", 111]]),
      appliedStatePrices: new Map([["food", { s1: 112 }]]),
      appliedNationalPrices: new Map([["food", { US: 113 }]]),
      scarcityMultByCommodity: new Map([["food", 1]]),
      ledgerBasePrices: BASE,
      commodityNominalPriceIndex: 1,
      turn: 7,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(docs).toHaveLength(COMMODITY_TYPES.length);
    const food = docs.find((d) => d.commodity === "food")!;
    expect(food.globalPrice).toBe(111);
    expect(food.statePrices).toEqual({ s1: 112 });
    expect(food.turn).toBe(7);
  });
});
