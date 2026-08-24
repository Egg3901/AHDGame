import { describe, it, expect } from "vitest";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import {
  autoPosture,
  clampPricingPosture,
  clearCommodityMarket,
  computeClearingFactors,
  qualityPremiumMultiplier,
  type ClearingBookDiagnostic,
} from "./clearing";

const bals = (entries: Array<[CommodityType, { supply: number; demand: number }]>) =>
  new Map(entries);

describe("clampPricingPosture", () => {
  it("clamps to [-0.2, 0.2] and zeroes garbage", () => {
    expect(clampPricingPosture(0.5)).toBe(0.2);
    expect(clampPricingPosture(-0.9)).toBe(-0.2);
    expect(clampPricingPosture(NaN)).toBe(0);
  });
});

describe("autoPosture", () => {
  it("skims into shortage, undercuts into glut, market when balanced", () => {
    expect(autoPosture(150, 100)).toBe(0.1);
    expect(autoPosture(70, 100)).toBe(-0.1);
    expect(autoPosture(100, 100)).toBe(0);
    expect(autoPosture(0, 0)).toBe(0);
  });
});

describe("autoPosture own-fill feedback", () => {
  it("starved seller undercuts even when the aggregate says shortage", () => {
    expect(autoPosture(150, 100, 0.05)).toBe(-0.1);
  });
  it("mediocre fill caps posture at market in a shortage, keeps undercut in a glut", () => {
    expect(autoPosture(150, 100, 0.5)).toBe(0);
    expect(autoPosture(70, 100, 0.5)).toBe(-0.1);
  });
  it("healthy fill leaves the aggregate heuristic alone", () => {
    expect(autoPosture(150, 100, 0.95)).toBe(0.1);
    expect(autoPosture(70, 100, 0.95)).toBe(-0.1);
  });
  it("missing/garbage fill falls back to the aggregate heuristic", () => {
    expect(autoPosture(150, 100, null)).toBe(0.1);
    expect(autoPosture(150, 100, undefined)).toBe(0.1);
    expect(autoPosture(150, 100, NaN)).toBe(0.1);
  });
});

describe("clearCommodityMarket", () => {
  it("fills cheapest sellers first; premium goes unsold in a glut", () => {
    const sold = clearCommodityMarket(100, [
      { id: "cheap", units: 60, posture: -0.05 },
      { id: "market", units: 60, posture: 0 },
      { id: "premium", units: 60, posture: 0.1 },
    ]);
    expect(sold.get("cheap")).toBe(1);
    expect(sold.get("market")).toBeCloseTo(40 / 60, 10);
    expect(sold.get("premium")).toBe(0);
  });

  it("everyone sells out in a shortage, including premium sellers", () => {
    const sold = clearCommodityMarket(1000, [
      { id: "a", units: 100, posture: 0.2 },
      { id: "b", units: 100, posture: -0.2 },
    ]);
    expect(sold.get("a")).toBe(1);
    expect(sold.get("b")).toBe(1);
  });

  it("splits pro-rata within an equal-posture group", () => {
    const sold = clearCommodityMarket(50, [
      { id: "x", units: 60, posture: 0 },
      { id: "y", units: 40, posture: 0 },
    ]);
    expect(sold.get("x")).toBeCloseTo(0.5, 10);
    expect(sold.get("y")).toBeCloseTo(0.5, 10);
  });
});

describe("qualityPremiumMultiplier", () => {
  it("is 1.0 at neutral quality, rewards above, penalizes below, clamped", () => {
    expect(qualityPremiumMultiplier(50)).toBeCloseTo(1, 10);
    expect(qualityPremiumMultiplier(100)).toBeCloseTo(1.3, 10);
    expect(qualityPremiumMultiplier(0)).toBeCloseTo(0.7, 10);
    expect(qualityPremiumMultiplier(NaN)).toBe(1);
  });
});

describe("computeClearingFactors", () => {
  const basePrices = { steel: 800 } as Record<CommodityType, number>;

  it("undercutting sells out while premium holds unsold stock in a glut", () => {
    const results = computeClearingFactors({
      sectors: [
        { sectorId: "under", revenue: 80_000, supplyRates: { steel: 1 }, posture: -0.05 },
        { sectorId: "prem", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0.1 },
      ],
      // Market glut: aggregate demand covers only 60% of supply (200 units offered).
      balances: bals([["steel", { supply: 200, demand: 120 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    const under = results.get("under")!;
    const prem = results.get("prem")!;
    expect(under.soldFraction).toBe(1);
    expect(under.factor).toBeCloseTo(0.95, 10); // sold out at −5%
    expect(prem.soldFraction).toBeCloseTo(0.2, 10); // residual only
    expect(prem.factor).toBeCloseTo(0.2 * 1.1, 10);
  });

  it("shortage: everyone sells out and premium posture pays", () => {
    const results = computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0.2 }],
      balances: bals([["steel", { supply: 100, demand: 300 }]]),
      priceRatioByCommodity: new Map([["steel", 1.44]]),
      basePrices,
    });
    const r = results.get("s")!;
    expect(r.soldFraction).toBe(1);
    // 1 × 1.2 × √1.44 = 1.44
    expect(r.factor).toBeCloseTo(1.44, 10);
  });

  it("reports per-output clear rates behind the blended headline", () => {
    // The advisor-reported confusion: an oil_gas extraction sector in a state
    // where natural gas is in severe global shortage (clears out) while oil is
    // in glut (does not). The weighted headline lands mid-range and reads as
    // though gas is the output not selling.
    const prices = { oil: 100, natural_gas: 100 } as Record<CommodityType, number>;
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "tx",
          revenue: 10_000,
          supplyRates: { oil: 0.58, natural_gas: 0.32 },
          posture: 0,
        },
      ],
      balances: bals([
        ["oil", { supply: 200, demand: 100 }], // glut → half clears
        ["natural_gas", { supply: 100, demand: 300 }], // shortage → sells out
      ]),
      priceRatioByCommodity: new Map([
        ["oil", 1],
        ["natural_gas", 1],
      ]),
      basePrices: prices,
    });
    const r = results.get("tx")!;
    expect(r.soldByCommodity!.natural_gas).toBeCloseTo(1, 6);
    expect(r.soldByCommodity!.oil).toBeCloseTo(0.5, 6);
    // Blended headline is neither: (0.58×0.5 + 0.32×1) / 0.90 ≈ 0.678.
    expect(r.soldFraction).toBeCloseTo(0.6778, 3);
    expect(r.soldFraction).toBeLessThan(r.soldByCommodity!.natural_gas!);
  });

  it("quality lifts the realized premium for a premium poster (sellout)", () => {
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "s",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0.2,
          outputQuality: 100,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 300 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      qualityPremiumEnabled: true,
    });
    const r = results.get("s")!;
    expect(r.soldFraction).toBe(1); // fills unchanged by quality
    // premium 0.2 × mult 1.3 → 0.26 → factor 1.26
    expect(r.factor).toBeCloseTo(1.26, 10);
  });

  it("low quality shaves the realized premium; undercut/base untouched", () => {
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "prem",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0.2,
          outputQuality: 0,
        },
        {
          sectorId: "under",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: -0.1,
          outputQuality: 0,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 900 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      qualityPremiumEnabled: true,
    });
    // premium 0.2 × mult 0.7 → 0.14 → factor 1.14
    expect(results.get("prem")!.factor).toBeCloseTo(1.14, 10);
    // undercutter is never quality-scaled (quality can't buy a lower price)
    expect(results.get("under")!.factor).toBeCloseTo(0.9, 10);
  });

  it("coupling is inert when qualityPremiumEnabled is off", () => {
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "s",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0.2,
          outputQuality: 100,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 300 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    expect(results.get("s")!.factor).toBeCloseTo(1.2, 10); // plain 1 + posture
  });

  it("null posture auto-positions from the lagged balance", () => {
    const results = computeClearingFactors({
      sectors: [{ sectorId: "npp", revenue: 80_000, supplyRates: { steel: 1 }, posture: null }],
      balances: bals([["steel", { supply: 100, demand: 300 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    expect(results.get("npp")!.effectivePosture).toBe(0.1);
  });

  it("scales pass demand by the sellers' share of aggregate supply", () => {
    // Sellers offer 100 units but the market's total supply is 400 → they see
    // 25% of the 200-unit demand = 50 units → soldFraction 0.5.
    const results = computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 400, demand: 200 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    expect(results.get("s")!.soldFraction).toBeCloseTo(0.5, 10);
  });

  it("own-fill feedback: starved auto seller undercuts even in a shortage", () => {
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "npp",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: null,
          lastSoldFraction: 0.05,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 300 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    expect(results.get("npp")!.effectivePosture).toBe(-0.1);
  });

  it("own-fill feedback never overrides a player-posted posture", () => {
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "player",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0.2,
          lastSoldFraction: 0.01,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 300 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    expect(results.get("player")!.effectivePosture).toBe(0.2);
  });

  it("emits both raw and normalized book diagnostics", () => {
    const seen: ClearingBookDiagnostic[] = [];
    // Revenue 80_000 / basePrice 800 yields 100 raw units. The legacy offer
    // reconciles to the 10 units that exist in lagged supply.
    computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 10, demand: 9 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      onBookDiagnostic: (d) => seen.push(d),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].commodity).toBe("steel");
    expect(seen[0].rawOfferedUnits).toBeCloseTo(100, 10);
    expect(seen[0].normalizedOfferedUnits).toBeCloseTo(10, 10);
    expect(seen[0].offeredUnits).toBeCloseTo(10, 10);
    expect(seen[0].laggedSupply).toBe(10);
  });

  it("normalizes a nameplate book that exceeds supply so fill tracks the true clear rate", () => {
    // Nameplate 100 units (revenue 80_000 / base 800) but the ledger only carries
    // 60 units of supply (scale/haircut). The book is reconciled down to 60, so a
    // shortage market (demand 90 > supply 60) clears everyone: soldFraction 1 — not
    // depressed to 90/100 by the phantom 100-unit nameplate.
    const seen: ClearingBookDiagnostic[] = [];
    const results = computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 60, demand: 90 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      onBookDiagnostic: (d) => seen.push(d),
    });
    // Raw telemetry preserves the 100-unit nameplate, while the actionable
    // total reports the 60-unit book that clearing actually used.
    expect(seen[0].rawOfferedUnits).toBeCloseTo(100, 10);
    expect(seen[0].normalizedOfferedUnits).toBeCloseTo(60, 10);
    expect(seen[0].laggedSupply).toBe(60);
    // But clearing used the reconciled book → sole seller sells out in the shortage.
    expect(results.get("s")!.soldFraction).toBeCloseTo(1, 10);
  });

  it("diagnoses the reconciled book without treating expected nameplate inflation as actionable", () => {
    const seen: ClearingBookDiagnostic[] = [];
    computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 60, demand: 90 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      onBookDiagnostic: (diagnostic) => seen.push(diagnostic),
    });

    expect(seen).toEqual([
      expect.objectContaining({
        group: null,
        rawOfferedUnits: 100,
        offeredUnits: 60,
        normalizableUnits: 100,
        exemptRealUnits: 0,
        laggedSupply: 60,
      }),
    ]);
    expect(seen[0].offeredUnits).not.toBeGreaterThan(seen[0].laggedSupply * 3);
  });

  it("keeps a measured produced-unit mismatch actionable after normalization", () => {
    const seen: ClearingBookDiagnostic[] = [];
    computeClearingFactors({
      sectors: [
        {
          sectorId: "plant",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          producedUnits: 400,
          posture: 0,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 90 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
      onBookDiagnostic: (diagnostic) => seen.push(diagnostic),
    });

    expect(seen[0]).toEqual(
      expect.objectContaining({
        rawOfferedUnits: 400,
        normalizedOfferedUnits: 400,
        normalizableUnits: 0,
        exemptRealUnits: 400,
        laggedSupply: 100,
      })
    );
    expect(seen[0].normalizedOfferedUnits).toBeGreaterThan(seen[0].laggedSupply * 3);
  });

  it("reconciles only legacy units in a mixed measured and nameplate book", () => {
    const seen: ClearingBookDiagnostic[] = [];
    computeClearingFactors({
      sectors: [
        {
          sectorId: "legacy",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0,
        },
        {
          sectorId: "plant",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          producedUnits: 40,
          posture: 0,
        },
      ],
      balances: bals([["steel", { supply: 60, demand: 90 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
      onBookDiagnostic: (diagnostic) => seen.push(diagnostic),
    });

    expect(seen[0]).toEqual(
      expect.objectContaining({
        rawOfferedUnits: 140,
        normalizedOfferedUnits: 60,
        normalizableUnits: 100,
        exemptRealUnits: 40,
      })
    );
  });

  it("identifies each country book in partitioned diagnostics", () => {
    const seen: ClearingBookDiagnostic[] = [];
    computeClearingFactors({
      sectors: [
        { sectorId: "us", revenue: 8_000, supplyRates: { steel: 1 }, posture: 0 },
        { sectorId: "ca", revenue: 8_000, supplyRates: { steel: 1 }, posture: 0 },
      ],
      balances: bals([["steel", { supply: 20, demand: 20 }]]),
      balancesByGroup: new Map([
        ["US", bals([["steel", { supply: 10, demand: 10 }]])],
        ["CA", bals([["steel", { supply: 10, demand: 10 }]])],
      ]),
      groupBySector: new Map([
        ["us", "US"],
        ["ca", "CA"],
      ]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      onBookDiagnostic: (diagnostic) => seen.push(diagnostic),
    });

    expect(seen).toEqual([
      expect.objectContaining({ commodity: "steel", group: "US" }),
      expect.objectContaining({ commodity: "steel", group: "CA" }),
    ]);
  });

  it("does NOT scale a book already within supply (no phantom inflation)", () => {
    // Nameplate 100 units, supply 400 (corps are a subset) → book untouched, the
    // existing share mechanism gives them 25% of the 200-unit demand = fill 0.5.
    const results = computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 400, demand: 200 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    expect(results.get("s")!.soldFraction).toBeCloseTo(0.5, 10);
  });

  it("returns nothing for sectors with no outputs", () => {
    const results = computeClearingFactors({
      sectors: [{ sectorId: "s", revenue: 80_000, supplyRates: {}, posture: 0 }],
      balances: bals([]),
      priceRatioByCommodity: new Map(),
      basePrices,
    });
    expect(results.has("s")).toBe(false);
  });
});

describe("computeClearingFactors: state-scoped commodities", () => {
  const basePrices = { freight: 100, consulting_services: 100 } as Record<CommodityType, number>;

  // Two logistics sectors in one country. NJ is 10x oversupplied against its
  // own state; AZ is short. Nationally the two net out to a mild glut, which
  // is the average that used to be handed to both of them.
  const twoStates = {
    sectors: [
      { sectorId: "nj", revenue: 10_000, supplyRates: { freight: 1 }, posture: 0 },
      { sectorId: "az", revenue: 10_000, supplyRates: { freight: 1 }, posture: 0 },
    ],
    balances: bals([["freight", { supply: 200, demand: 110 }]]),
    stateMarkets: {
      stateBySector: new Map([
        ["nj", "NJ"],
        ["az", "AZ"],
      ]),
      balances: new Map([
        ["NJ", bals([["freight", { supply: 100, demand: 10 }]])],
        ["AZ", bals([["freight", { supply: 100, demand: 100 }]])],
      ]),
      priceRatios: new Map<string, Map<CommodityType, number>>(),
    },
    priceRatioByCommodity: new Map<CommodityType, number>([["freight", 1]]),
    basePrices,
  };

  it("pays the short state and starves the glutted one, instead of averaging both", () => {
    const { stateMarkets: _stateMarkets, ...nationalInputs } = twoStates;
    const national = computeClearingFactors(nationalInputs);
    // Without scoping both sellers face the same national book and get the
    // same answer, so neither player learns anything about their own state.
    expect(national.get("nj")!.soldFraction).toBeCloseTo(national.get("az")!.soldFraction, 10);

    const scoped = computeClearingFactors(twoStates);
    expect(scoped.get("az")!.soldFraction).toBeCloseTo(1, 10);
    expect(scoped.get("nj")!.soldFraction).toBeCloseTo(0.1, 10);
  });

  it("realizes the short state's scarcity price, not the national one", () => {
    const scoped = computeClearingFactors({
      ...twoStates,
      stateMarkets: {
        ...twoStates.stateMarkets,
        // AZ's freight trades at 1.4x base, NJ's below base.
        priceRatios: new Map([
          ["AZ", new Map<CommodityType, number>([["freight", 1.4]])],
          ["NJ", new Map<CommodityType, number>([["freight", 0.9]])],
        ]),
      },
    });
    // Clearing volume locally while realizing price nationally would leave
    // these two identical. The seller who relieved the shortage earns more.
    expect(scoped.get("az")!.factor).toBeGreaterThan(scoped.get("nj")!.factor);
  });

  it("leaves a non-scoped output on the national book from the same plant", () => {
    // A logistics sector sells freight AND consulting from one plant. Only the
    // freight leg is state-locked; consulting is a national service and must
    // not be dragged into a state book by its neighbour.
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "nj",
          revenue: 10_000,
          supplyRates: { freight: 1, consulting_services: 1 },
          posture: 0,
        },
      ],
      balances: bals([
        ["freight", { supply: 100, demand: 10 }],
        ["consulting_services", { supply: 100, demand: 100 }],
      ]),
      stateMarkets: {
        stateBySector: new Map([["nj", "NJ"]]),
        balances: new Map([
          ["NJ", bals([["freight", { supply: 100, demand: 10 }]])],
          // Deliberately NO consulting entry for NJ.
        ]),
        priceRatios: new Map(),
      },
      priceRatioByCommodity: new Map<CommodityType, number>([
        ["freight", 1],
        ["consulting_services", 1],
      ]),
      basePrices,
    });
    const sold = results.get("nj")!.soldByCommodity!;
    expect(sold.freight).toBeCloseTo(0.1, 10);
    expect(sold.consulting_services).toBeCloseTo(1, 10);
  });

  it("fails closed when a state-local seller has no balance entry", () => {
    // Falling back would reuse the same national demand already consumed by
    // correctly located state books.
    const results = computeClearingFactors({
      sectors: [{ sectorId: "us", revenue: 10_000, supplyRates: { freight: 1 }, posture: 0 }],
      balances: bals([["freight", { supply: 100, demand: 100 }]]),
      balancesByGroup: new Map([["US", bals([["freight", { supply: 100, demand: 100 }]])]]),
      groupBySector: new Map([["us", "US"]]),
      stateMarkets: {
        stateBySector: new Map([["us", "NOWHERE"]]),
        balances: new Map(),
        priceRatios: new Map(),
      },
      priceRatioByCommodity: new Map<CommodityType, number>([["freight", 1]]),
      basePrices,
    });
    expect(results.get("us")!.soldFraction).toBeCloseTo(0, 10);
  });

  it("does not let a state id collide with a country id", () => {
    // DE is both Delaware and Germany. Delaware is glutted, Germany is not.
    const results = computeClearingFactors({
      sectors: [{ sectorId: "de", revenue: 10_000, supplyRates: { freight: 1 }, posture: 0 }],
      balances: bals([["freight", { supply: 100, demand: 100 }]]),
      balancesByGroup: new Map([["DE", bals([["freight", { supply: 100, demand: 100 }]])]]),
      groupBySector: new Map([["de", "DE"]]),
      stateMarkets: {
        stateBySector: new Map([["de", "DE"]]),
        balances: new Map([["DE", bals([["freight", { supply: 100, demand: 5 }]])]]),
        priceRatios: new Map(),
      },
      priceRatioByCommodity: new Map<CommodityType, number>([["freight", 1]]),
      basePrices,
    });
    // Delaware's book, not Germany's.
    expect(results.get("de")!.soldFraction).toBeCloseTo(0.05, 10);
  });

  it("is byte-identical for every reachable commodity while state markets are active", () => {
    const commodities = COMMODITY_TYPES.filter((commodity) => commodity !== "freight");
    const supplyRates = Object.fromEntries(commodities.map((commodity) => [commodity, 1]));
    const balances = bals(commodities.map((commodity) => [commodity, { supply: 100, demand: 60 }]));
    const priceRatios = new Map<CommodityType, number>(
      commodities.map((commodity) => [commodity, 1])
    );
    const allBasePrices = Object.fromEntries(
      COMMODITY_TYPES.map((commodity) => [commodity, 100])
    ) as Record<CommodityType, number>;
    const inputs = {
      sectors: [{ sectorId: "seller", revenue: 10_000, supplyRates, posture: 0 }],
      balances,
      priceRatioByCommodity: priceRatios,
      basePrices: allBasePrices,
    };
    const before = computeClearingFactors(inputs);
    const after = computeClearingFactors({
      ...inputs,
      stateMarkets: {
        stateBySector: new Map([["seller", "NJ"]]),
        balances: new Map(),
        priceRatios: new Map(),
      },
    });
    expect(after.get("seller")).toEqual(before.get("seller"));
  });
});

describe("clearCommodityMarket — loyal-slice pre-pass (A2b)", () => {
  it("is byte-identical to cheapest-first when no loyalty map is passed", () => {
    const sellers = [
      { id: "cheap", units: 60, posture: -0.1 },
      { id: "dear", units: 60, posture: 0.1 },
    ];
    const sold = clearCommodityMarket(60, sellers);
    expect(sold.get("cheap")).toBeCloseTo(1, 10); // cheapest fills first
    expect(sold.get("dear")).toBeCloseTo(0, 10);
  });

  it("reserves a loyal slice for the premium seller so it isn't fully undercut", () => {
    const sellers = [
      { id: "cheap", units: 100, posture: -0.1 },
      { id: "dear", units: 100, posture: 0.1 },
    ];
    // demand 100; without loyalty 'dear' sells ~0 (cheap covers it all).
    const loyalty = new Map([
      ["dear", 100],
      ["cheap", 0],
    ]);
    const sold = clearCommodityMarket(100, sellers, loyalty);
    // 'dear' reserves LOYAL_POOL_FRACTION(0.4)*100 = 40 units → fill 0.4.
    expect(sold.get("dear")).toBeCloseTo(0.4, 6);
    // remaining 60 demand goes to cheapest 'cheap' → 0.6 of its 100 units.
    expect(sold.get("cheap")).toBeCloseTo(0.6, 6);
  });

  it("splits the loyal pool by RELATIVE loyalty and caps at own units", () => {
    const sellers = [
      { id: "hi", units: 100, posture: 0.1 },
      { id: "lo", units: 100, posture: 0.1 },
    ];
    const loyalty = new Map([
      ["hi", 90],
      ["lo", 30],
    ]);
    const sold = clearCommodityMarket(100, sellers, loyalty);
    // pool 40 split 90:30 → hi 30, lo 10 (before same-posture remainder split).
    // remainder 60 demand over 160 remaining units → +0.375 each of remaining.
    expect(sold.get("hi")! > sold.get("lo")!).toBe(true);
  });

  it("noise floor: a near-zero-loyalty seller gets no reservation", () => {
    const sellers = [
      { id: "faithful", units: 100, posture: 0.1 },
      { id: "nobody", units: 100, posture: 0.1 },
    ];
    const loyalty = new Map([
      ["faithful", 60],
      ["nobody", 2],
    ]);
    const sold = clearCommodityMarket(40, sellers, loyalty);
    // only 'faithful' reserves; pool 0.4*40=16 units → +0.16 before remainder.
    expect(sold.get("faithful")! > sold.get("nobody")!).toBe(true);
  });
});

describe("clearCommodityMarket — contracted pre-pass (supply agreements)", () => {
  it("fills contracted units first, off the top of demand", () => {
    const sellers = [
      { id: "supplier", units: 100, posture: 0.15 }, // priciest — normally sells last
      { id: "rival", units: 100, posture: -0.1 },
    ];
    // demand 100; contract guarantees supplier 40 units before cheapest-first.
    const contracted = new Map([["supplier", 40]]);
    const sold = clearCommodityMarket(100, sellers, undefined, contracted);
    // supplier gets its 40 contracted (0.4) despite being priciest.
    expect(sold.get("supplier")).toBeCloseTo(0.4, 6);
    // remaining 60 demand → cheapest 'rival' fills 0.6.
    expect(sold.get("rival")).toBeCloseTo(0.6, 6);
  });

  it("is byte-identical when no contract map is passed", () => {
    const sellers = [{ id: "a", units: 50, posture: 0 }];
    const withUndef = clearCommodityMarket(50, sellers, undefined, undefined);
    expect(withUndef.get("a")).toBeCloseTo(1, 10);
  });

  it("contracted units are capped at the seller's own offered units", () => {
    const sellers = [{ id: "s", units: 30, posture: 0.1 }];
    const sold = clearCommodityMarket(1000, sellers, undefined, new Map([["s", 999]]));
    expect(sold.get("s")).toBeCloseTo(1, 6); // can't sell more than it has
  });

  it("honors a buyer-demand-capped contract ahead of a thin anonymous book", () => {
    // The reported shape: 16k/day of freight against a 13k agreement, in a book
    // whose proportional anonymous demand is only 6.4k. Named buyer demand was
    // already checked before this clearing pass, so it must not be capped twice.
    const sellers = [{ id: "supplier", units: 16_000, posture: 0 }];
    const sold = clearCommodityMarket(6_400, sellers, undefined, new Map([["supplier", 13_000]]));
    expect(sold.get("supplier")).toBeCloseTo(13_000 / 16_000, 6);
  });

  it("delivers a contract in full when the book has demand for it", () => {
    // The reporter's own control case: a 2k agreement against 3,271 of output
    // cleared at 100%.
    const sellers = [{ id: "supplier", units: 3_271, posture: 0 }];
    const sold = clearCommodityMarket(10_000, sellers, undefined, new Map([["supplier", 2_000]]));
    expect(sold.get("supplier")).toBeCloseTo(1, 6);
  });
});

describe("computeClearingFactors — supply-agreement settlement + exclusivity", () => {
  const basePrices = { steel: 800 } as Record<CommodityType, number>;
  // revenue 80_000 / base 800 = 100 offered units for the single steel sector.

  it("reports the contracted units that actually cleared into contractSettlementOut", () => {
    const settlementOut = new Map<string, Map<CommodityType, number>>();
    computeClearingFactors({
      sectors: [{ sectorId: "s1", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 100, demand: 300 }]]), // shortage → all sells
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      contractedByCorpCommodity: new Map([["C1", new Map([["steel", 50]])]]),
      sectorCorpId: new Map([["s1", "C1"]]),
      contractSettlementOut: settlementOut,
    });
    // 50 contracted units offered and cleared.
    expect(settlementOut.get("C1")?.get("steel")).toBeCloseTo(50, 1);
  });

  it("a supply agreement is additive: the surplus above the contract still clears", () => {
    // A contract reserves 50 units for the buyer; the sector produces 100 into a
    // glut book (demand 60). The 50 contracted are guaranteed-sold, then the
    // remaining 10 of demand clears the surplus → 60 of 100 offered. A contract
    // never blackholes the surplus, so this is identical to no contract at all.
    const common = {
      sectors: [{ sectorId: "s1", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 100, demand: 60 }]]), // glut: demand 60 < supply 100
      priceRatioByCommodity: new Map<CommodityType, number>([["steel", 1]]),
      basePrices,
      sectorCorpId: new Map([["s1", "C1"]]),
    };
    const noContract = computeClearingFactors(common);
    const withContract = computeClearingFactors({
      ...common,
      contractedByCorpCommodity: new Map<string, Map<CommodityType, number>>([
        ["C1", new Map<CommodityType, number>([["steel", 50]])],
      ]),
    });
    // Both clear the whole 60 of demand across the 100 offered → 0.6. The
    // contract only changes WHO buys (50 guaranteed to the buyer), not how much
    // the sector sells.
    expect(noContract.get("s1")!.soldFraction).toBeCloseTo(0.6, 1);
    expect(withContract.get("s1")!.soldFraction).toBeCloseTo(0.6, 1);
  });

  it("keeps the ORIGINAL offered units as the soldFraction denominator", () => {
    // Contracted volume well below output, demand ample: the contract reserves
    // 20 for the buyer and the surplus 80 clears on the open market too, so the
    // sector sells everything → 1.0 over its 100 offered units. If soldFraction
    // used the contracted 20 as the denominator this would misreport, and if the
    // surplus were blackholed it would read ~0.2.
    const res = computeClearingFactors({
      sectors: [{ sectorId: "s1", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances: bals([["steel", { supply: 100, demand: 1000 }]]), // huge demand
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      contractedByCorpCommodity: new Map([["C1", new Map([["steel", 20]])]]),
      sectorCorpId: new Map([["s1", "C1"]]),
    });
    expect(res.get("s1")!.soldFraction).toBeCloseTo(1, 6);
  });

  it("records each corp's offered (produced) units into producedUnitsOut", () => {
    const producedOut = new Map<string, Map<CommodityType, number>>();
    computeClearingFactors({
      sectors: [
        {
          sectorId: "s1",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: 40,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 30 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
      contractedByCorpCommodity: new Map([["C1", new Map([["steel", 60]])]]),
      sectorCorpId: new Map([["s1", "C1"]]),
      producedUnitsOut: producedOut,
    });
    // Real produced units, not the 100-unit revenue nameplate.
    expect(producedOut.get("C1")?.get("steel")).toBeCloseTo(40, 6);
  });
});

describe("computeClearingFactors — plants tier offers produced units", () => {
  const basePrices = { steel: 800, iron: 400 } as Record<CommodityType, number>;

  it("is byte-identical when plantsEnabled is off, even with producedUnits supplied", () => {
    const sectors = [
      { sectorId: "a", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0, producedUnits: 5 },
    ];
    const balances = bals([["steel", { supply: 100, demand: 60 }]]);
    const common = {
      balances,
      priceRatioByCommodity: new Map<CommodityType, number>([["steel", 1]]),
      basePrices,
    };
    const off = computeClearingFactors({ sectors, ...common });
    const legacy = computeClearingFactors({
      sectors: [{ sectorId: "a", revenue: 80_000, supplyRates: { steel: 1 }, posture: 0 }],
      ...common,
    });
    expect(off.get("a")!.soldFraction).toBe(legacy.get("a")!.soldFraction);
  });

  it("offers producedUnits instead of the revenue nameplate", () => {
    // Nameplate would be 80_000/800 = 100 units; the sector actually made 40.
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "a",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: 40,
        },
      ],
      balances: bals([["steel", { supply: 200, demand: 20 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
    });
    // Share of lagged supply = 40/200 ⇒ demand for the pass = 20 × 0.2 = 4 of 40.
    expect(results.get("a")!.soldFraction).toBeCloseTo(0.1, 10);
  });

  it("splits a multi-output sector's produced units by the rate/base mix", () => {
    // Mix weights: steel 1/800, iron 1/400 ⇒ iron takes 2/3 of the 60 units.
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "a",
          revenue: 80_000,
          supplyRates: { steel: 1, iron: 1 },
          posture: 0,
          producedUnits: 60,
        },
      ],
      balances: bals([
        ["steel", { supply: 20, demand: 10 }],
        ["iron", { supply: 40, demand: 40 }],
      ]),
      priceRatioByCommodity: new Map([
        ["steel", 1],
        ["iron", 1],
      ]),
      basePrices,
      plantsEnabled: true,
    });
    // steel: 20 offered vs demand 10 (share 1) ⇒ 0.5 sold.
    // iron:  40 offered vs demand 40 (share 1) ⇒ sells out.
    // Sector factor weights by supply rate (equal) ⇒ soldFraction 0.75.
    expect(results.get("a")!.soldFraction).toBeCloseTo(0.75, 10);
  });

  it("exempts real produced units from the lagged-supply normalization", () => {
    // Legacy nameplate sellers get scaled down to the lagged supply; the plants
    // seller does not, because its offer already carries every production leg.
    const balances = bals([["steel", { supply: 100, demand: 100 }]]);
    const common = {
      balances,
      priceRatioByCommodity: new Map<CommodityType, number>([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
    };
    const withRealUnits = computeClearingFactors({
      sectors: [
        {
          sectorId: "plants",
          revenue: 800_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: 150,
        },
      ],
      ...common,
    });
    // 150 real units offered against lagged supply 100 and demand 100: the book
    // is NOT scaled down to 100, so 100 of the 150 units clear.
    expect(withRealUnits.get("plants")!.soldFraction).toBeCloseTo(2 / 3, 10);

    // Same sector on the legacy path: 1000 nameplate units normalized to 100.
    const nameplate = computeClearingFactors({
      sectors: [{ sectorId: "np", revenue: 800_000, supplyRates: { steel: 1 }, posture: 0 }],
      balances,
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
    });
    // Normalized offer 100 vs demand 100 ⇒ reads as a full sellout, which is
    // exactly the overstatement-correction the plants seller must not inherit.
    expect(nameplate.get("np")!.soldFraction).toBe(1);
  });

  it("falls back to the nameplate for a sector with no producedUnits yet", () => {
    const results = computeClearingFactors({
      sectors: [
        {
          sectorId: "a",
          revenue: 80_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: null,
        },
      ],
      balances: bals([["steel", { supply: 100, demand: 100 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
    });
    expect(results.get("a")!.soldFraction).toBe(1);
  });
});

describe("computeClearingFactors — plants and legacy sellers in the same book", () => {
  const basePrices = { steel: 800 } as Record<CommodityType, number>;

  it("normalizes only the legacy sellers down to the supply the real ones leave", () => {
    // Real seller offers 60 of a lagged supply of 100; the legacy seller's
    // nameplate is 1000 units. Only 40 units of book are left for it.
    const results = computeClearingFactors({
      sectors: [
        { sectorId: "real", revenue: 0, supplyRates: { steel: 1 }, posture: 0, producedUnits: 60 },
        { sectorId: "np", revenue: 800_000, supplyRates: { steel: 1 }, posture: 0 },
      ],
      balances: bals([["steel", { supply: 100, demand: 100 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
    });
    // Book after normalization is 60 + 40 = 100 == lagged supply == demand, so
    // both sellers clear fully and neither is depressed by the other.
    expect(results.get("real")!.soldFraction).toBeCloseTo(1, 10);
    expect(results.get("np")!.soldFraction).toBeCloseTo(1, 10);
  });

  it("zeroes the legacy book when real units alone exhaust lagged supply", () => {
    const results = computeClearingFactors({
      sectors: [
        { sectorId: "real", revenue: 0, supplyRates: { steel: 1 }, posture: 0, producedUnits: 150 },
        { sectorId: "np", revenue: 800_000, supplyRates: { steel: 1 }, posture: 0 },
      ],
      balances: bals([["steel", { supply: 100, demand: 100 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices,
      plantsEnabled: true,
    });
    // Legacy seller offers nothing, so it sells nothing; the real seller has the
    // whole 100 units of demand against its 150-unit offer.
    expect(results.get("np")!.soldFraction).toBe(0);
    expect(results.get("real")!.soldFraction).toBeCloseTo(2 / 3, 10);
  });
});
