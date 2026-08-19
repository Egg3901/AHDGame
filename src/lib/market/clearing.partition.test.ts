import { describe, it, expect } from "vitest";
import { computeClearingFactors, type SectorClearingInput } from "./clearing";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";

const steelBase = COMMODITY_BASE_PRICES.steel;

const seller = (sectorId: string, revenue: number, posture = 0): SectorClearingInput => ({
  sectorId,
  revenue,
  supplyRates: { steel: 1 },
  posture,
});

const balances = (supply: number, demand: number) =>
  new Map<CommodityType, { supply: number; demand: number }>([["steel", { supply, demand }]]);

describe("computeClearingFactors market partition", () => {
  it("without partition args, glut sellers drag every seller's fill (the old world book)", () => {
    // 100 units US, 900 units RU, worldwide demand 300: everyone fills 0.30.
    const res = computeClearingFactors({
      sectors: [seller("us1", 100 * steelBase), seller("ru1", 900 * steelBase)],
      balances: balances(1000, 300),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
    });
    expect(res.get("us1")!.soldFraction).toBeCloseTo(0.3, 5);
    expect(res.get("ru1")!.soldFraction).toBeCloseTo(0.3, 5);
  });

  it("with partition, each seller clears against its own country's reachable book", () => {
    const res = computeClearingFactors({
      sectors: [seller("us1", 100 * steelBase), seller("ru1", 900 * steelBase)],
      balances: balances(1000, 300),
      groupBySector: new Map([
        ["us1", "US"],
        ["ru1", "RU"],
      ]),
      balancesByGroup: new Map([
        // US book: tight — 100 supply vs 120 reachable demand → full fill.
        ["US", balances(100, 120)],
        // RU book: walled-off glut — 900 supply vs 180 reachable demand.
        ["RU", balances(900, 180)],
      ]),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
    });
    expect(res.get("us1")!.soldFraction).toBeCloseTo(1, 5);
    expect(res.get("ru1")!.soldFraction).toBeCloseTo(0.2, 5);
  });

  it("sectors missing a group entry fall back to the worldwide book", () => {
    const res = computeClearingFactors({
      sectors: [seller("x1", 100 * steelBase)],
      balances: balances(100, 50),
      groupBySector: new Map(), // x1 unmapped → group "" → worldwide balances
      balancesByGroup: new Map([["US", balances(1, 1)]]),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
    });
    expect(res.get("x1")!.soldFraction).toBeCloseTo(0.5, 5);
  });

  it("splits a cross-country corp's contracted volume by unit weight, never double-counting", () => {
    const contractSettlementOut = new Map<string, Map<CommodityType, number>>();
    const res = computeClearingFactors({
      // One corp, two sectors in different countries, equal units.
      sectors: [seller("a", 100 * steelBase), seller("b", 100 * steelBase)],
      balances: balances(200, 200),
      groupBySector: new Map([
        ["a", "US"],
        ["b", "RU"],
      ]),
      balancesByGroup: new Map([
        ["US", balances(100, 100)],
        ["RU", balances(100, 100)],
      ]),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
      contractedByCorpCommodity: new Map([
        ["corp1", new Map<CommodityType, number>([["steel", 120]])],
      ]),
      sectorCorpId: new Map([
        ["a", "corp1"],
        ["b", "corp1"],
      ]),
      contractSettlementOut,
    });
    // Both books clear fully here; the settled contracted volume must equal
    // the corp's 120 contracted units exactly once (60 per book), not 240.
    expect(contractSettlementOut.get("corp1")!.get("steel")).toBeCloseTo(120, 5);
    expect(res.get("a")!.soldFraction).toBeCloseTo(1, 5);
    expect(res.get("b")!.soldFraction).toBeCloseTo(1, 5);
  });

  it("exclusive with a US buyer does not withhold surplus from the RU book", () => {
    // Ticket #1138: exclusive used to cap EVERY sector of the supplier at
    // volumeCap / worldwide production, including plants in countries the buyer
    // cannot reach. A small US exclusive food deal then pinned JP/AT/UK farms
    // to the same ~5% fill as the US ones.
    //
    // One corp, two equal plants. Contract is 10 of 200 units (5%) exclusive
    // to a US buyer. US demand is ample so the US plant sells only its
    // contracted slice; the RU plant still clears its local glut book.
    const res = computeClearingFactors({
      sectors: [seller("usPlant", 100 * steelBase), seller("ruPlant", 100 * steelBase)],
      balances: balances(200, 200),
      groupBySector: new Map([
        ["usPlant", "US"],
        ["ruPlant", "RU"],
      ]),
      balancesByGroup: new Map([
        ["US", balances(100, 1000)],
        ["RU", balances(100, 80)],
      ]),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
      contractedByCorpCommodity: new Map([
        ["corp1", new Map<CommodityType, number>([["steel", 10]])],
      ]),
      sectorCorpId: new Map([
        ["usPlant", "corp1"],
        ["ruPlant", "corp1"],
      ]),
      exclusiveByCorpCommodity: new Set(["corp1:steel"]),
      exclusiveBuyerGroupsByCorpCommodity: new Map([["corp1:steel", new Set(["US"])]]),
    });
    // US: exclusive withholds the 95-unit surplus → fill = 10/200 of worldwide
    // allocated to this book = 5/100 = 0.05.
    expect(res.get("usPlant")!.soldFraction).toBeCloseTo(0.05, 5);
    // RU: same contracted slice is reserved, but the surplus still sells into
    // the RU book (80 demand / 100 offer → 0.80, and the 5 contracted units
    // are already inside that 80).
    expect(res.get("ruPlant")!.soldFraction).toBeCloseTo(0.8, 5);
  });

  it("exclusive without buyer-group metadata still caps every partitioned book (legacy)", () => {
    const res = computeClearingFactors({
      sectors: [seller("usPlant", 100 * steelBase), seller("ruPlant", 100 * steelBase)],
      balances: balances(200, 200),
      groupBySector: new Map([
        ["usPlant", "US"],
        ["ruPlant", "RU"],
      ]),
      balancesByGroup: new Map([
        ["US", balances(100, 1000)],
        ["RU", balances(100, 80)],
      ]),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
      contractedByCorpCommodity: new Map([
        ["corp1", new Map<CommodityType, number>([["steel", 10]])],
      ]),
      sectorCorpId: new Map([
        ["usPlant", "corp1"],
        ["ruPlant", "corp1"],
      ]),
      exclusiveByCorpCommodity: new Set(["corp1:steel"]),
    });
    expect(res.get("usPlant")!.soldFraction).toBeCloseTo(0.05, 5);
    expect(res.get("ruPlant")!.soldFraction).toBeCloseTo(0.05, 5);
  });

  it("price realization reads the seller's own group ratio, falling back to worldwide", () => {
    const run = (priceRatioByGroup?: Map<string, Map<CommodityType, number>>) =>
      computeClearingFactors({
        sectors: [seller("us1", 100 * steelBase), seller("ru1", 100 * steelBase)],
        balances: balances(200, 200),
        groupBySector: new Map([
          ["us1", "US"],
          ["ru1", "RU"],
        ]),
        balancesByGroup: new Map([
          ["US", balances(100, 100)],
          ["RU", balances(100, 100)],
        ]),
        // Worldwide ratio says glut (0.7x base)...
        priceRatioByCommodity: new Map([["steel" as CommodityType, 0.7]]),
        priceRatioByGroup,
        basePrices: COMMODITY_BASE_PRICES,
      });

    // ...but the US market is short (1.4x). With group ratios the US seller
    // realizes its own market's price; RU (absent from the map) keeps the
    // worldwide fallback, so both books fill 1.0 and only the price leg moves.
    const withGroups = run(new Map([["US", new Map([["steel" as CommodityType, 1.4]])]]));
    const withoutGroups = run(undefined);
    expect(withGroups.get("us1")!.factor).toBeGreaterThan(withoutGroups.get("us1")!.factor);
    expect(withGroups.get("ru1")!.factor).toBeCloseTo(withoutGroups.get("ru1")!.factor, 10);
  });
});
