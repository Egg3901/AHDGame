import { describe, expect, it } from "vitest";
import { computeCorpCommodityFlows } from "./corpCommodityFlows";
import { COMMODITY_BASE_PRICES, dollarsToUnits } from "@/lib/constants/commodities";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";

type FlowSector = Parameters<typeof computeCorpCommodityFlows>[0][number];

const mkSector = (over: Partial<FlowSector>): FlowSector => ({
  sectorType: "manufacturing",
  stateId: "CA",
  revenue: 100_000,
  strategyId: "standard",
  transitionFromStrategyId: null,
  transitionStartTurn: null,
  ...over,
});

const stateInfo = new Map([
  ["CA", { name: "California", region: "West" }],
  ["NY", { name: "New York", region: "Northeast" }],
]);

describe("computeCorpCommodityFlows", () => {
  it("recomputes output/consumption units from revenue × rate / basePrice", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ revenue: 100_000 })],
      10,
      new Map(),
      stateInfo
    );

    // Manufacturing standard supplies steel@0.4 and building_materials@0.2.
    const steel = commodities.find((c) => c.commodity === "steel");
    expect(steel).toBeDefined();
    expect(steel!.outputUnits).toBeCloseTo(
      dollarsToUnits(100_000 * 0.4, COMMODITY_BASE_PRICES.steel),
      1
    );
    expect(steel!.consumptionUnits).toBe(0);
    expect(steel!.netUnits).toBeCloseTo(steel!.outputUnits, 1);

    // It consumes energy@0.2 (demand only → net negative).
    const energy = commodities.find((c) => c.commodity === "energy");
    expect(energy).toBeDefined();
    expect(energy!.outputUnits).toBe(0);
    expect(energy!.consumptionUnits).toBeCloseTo(
      dollarsToUnits(100_000 * 0.2, COMMODITY_BASE_PRICES.energy),
      1
    );
    expect(energy!.netUnits).toBeLessThan(0);
  });

  it("aggregates duplicate commodities across sectors and groups by state", () => {
    const { commodities, regions } = computeCorpCommodityFlows(
      [mkSector({ stateId: "CA", revenue: 100_000 }), mkSector({ stateId: "NY", revenue: 50_000 })],
      10,
      new Map(),
      stateInfo
    );

    const steel = commodities.find((c) => c.commodity === "steel")!;
    // Output sums across both sectors.
    expect(steel.outputUnits).toBeCloseTo(
      dollarsToUnits(150_000 * 0.4, COMMODITY_BASE_PRICES.steel),
      1
    );

    // One region row per state, with resolved names.
    expect(regions.map((r) => r.stateName).sort()).toEqual(["California", "New York"]);
    const ca = regions.find((r) => r.stateId === "CA")!;
    expect(ca.region).toBe("West");
    expect(ca.rows.some((row) => row.commodity === "steel")).toBe(true);
  });

  it("attaches global market context from the latest flow ledger row", () => {
    const flow: CommodityFlow = {
      commodity: "steel",
      turn: 42,
      supplyUnits: 1000,
      demandUnits: 900,
      clearedUnits: 900,
      unmetDemandUnits: 0,
      surplusUnits: 100,
      price: 850,
      stockUnits: 5000,
      coverTurns: 5.5,
      spoiledUnits: 3,
      byCountry: {},
      createdAt: new Date(0),
    };
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({})],
      10,
      new Map([["steel", flow]]),
      stateInfo
    );
    const steel = commodities.find((c) => c.commodity === "steel")!;
    expect(steel.market.price).toBe(850);
    expect(steel.market.stockUnits).toBe(5000);
    expect(steel.market.coverTurns).toBe(5.5);

    // A commodity with no ledger row reports null context, not a crash.
    const energy = commodities.find((c) => c.commodity === "energy")!;
    expect(energy.market.price).toBeNull();
    expect(energy.market.stockUnits).toBeNull();
  });

  it("attaches delivered private supply and computes consumption coverage", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ revenue: 30_000 })],
      10,
      new Map(),
      stateInfo,
      new Map([
        [
          "energy",
          {
            contractedUnits: 80,
            deliveredUnits: 60,
            turn: 9,
          },
        ],
      ])
    );

    const energy = commodities.find((row) => row.commodity === "energy")!;
    expect(energy.privateSupply).toEqual({
      contractedUnits: 80,
      deliveredUnits: 60,
      consumptionCoveredUnits: 60,
      coveragePercent: 60,
      turn: 9,
    });
  });

  it("keeps a zero-demand agreement visible instead of hiding phantom supply", () => {
    const { commodities } = computeCorpCommodityFlows(
      [],
      10,
      new Map(),
      stateInfo,
      new Map([
        [
          "energy",
          {
            contractedUnits: 80,
            deliveredUnits: 0,
            turn: 9,
          },
        ],
      ])
    );

    expect(commodities.find((row) => row.commodity === "energy")?.privateSupply).toEqual({
      contractedUnits: 80,
      deliveredUnits: 0,
      consumptionCoveredUnits: 0,
      coveragePercent: 0,
      turn: 9,
    });
  });

  it("omits commodities the corp neither produces nor consumes", () => {
    const { commodities } = computeCorpCommodityFlows([mkSector({})], 10, new Map(), stateInfo);
    // Manufacturing (standard) never supplies or demands pharmaceuticals.
    expect(commodities.some((c) => c.commodity === "pharmaceuticals")).toBe(false);
  });
});
