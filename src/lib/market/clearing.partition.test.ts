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
});
