import { describe, expect, it } from "vitest";
import { computeCorpCommodityFlows } from "./corpCommodityFlows";
import {
  COMMODITY_BASE_PRICES,
  commodityMixWeight,
  dollarsToUnits,
} from "@/lib/constants/commodities";
import { TRADE_EMBARGO_EXPORT_LOSS_SHARE } from "@/lib/trade/constants";
import {
  MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR,
  PLANNED_ECONOMY_MEDIA_OUTPUT,
  PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR,
} from "@/lib/constants/sectorStrategies";
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
      basis: "ledger_aggregate",
      clearingBasis: "global_pooled_availability",
      commodity: "steel",
      turn: 42,
      supplyUnits: 1000,
      demandUnits: 900,
      demandUnitsLedger: 900,
      clearedUnits: 900,
      clearedUnitsPooled: 900,
      unmetDemandUnits: 0,
      unmetDemandUnitsPooled: 0,
      surplusUnits: 100,
      surplusUnitsPooled: 100,
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
      consumptionUnits: 100,
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
      consumptionUnits: 0,
    });
  });

  it("omits commodities the corp neither produces nor consumes", () => {
    const { commodities } = computeCorpCommodityFlows([mkSector({})], 10, new Map(), stateInfo);
    // Manufacturing (standard) never supplies or demands pharmaceuticals.
    expect(commodities.some((c) => c.commodity === "pharmaceuticals")).toBe(false);
  });
});

describe("computeCorpCommodityFlows — plants-tier physical production (ticket #1177)", () => {
  const plants = { plantsEnabled: true, isNatcorp: false } as const;

  it("reports measured plant production instead of the revenue nameplate", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ revenue: 100_000, producedUnits: 900, capacityUnits: 1_000 })],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    // Manufacturing standard supplies steel@0.4 + building_materials@0.2; the
    // 900 measured units split by the canonical mix weight, NOT revenue/price.
    const steel = commodities.find((c) => c.commodity === "steel")!;
    expect(steel.outputUnits).toBeCloseTo(
      900 *
        commodityMixWeight({ steel: 0.4, building_materials: 0.2 }, COMMODITY_BASE_PRICES, "steel"),
      1
    );
  });

  it("normalizes host-currency revenue to the anchor before deriving nameplate units", () => {
    // A French sector books revenue in francs. Dividing francs by an anchor
    // base price inflated its output by the FX rate.
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ revenue: 36_655_000, revenueAnchor: 100_000 })],
      10,
      new Map(),
      stateInfo
    );

    const steel = commodities.find((c) => c.commodity === "steel")!;
    expect(steel.outputUnits).toBeCloseTo(
      dollarsToUnits(100_000 * 0.4, COMMODITY_BASE_PRICES.steel),
      1
    );
  });

  it("reports no output for a mothballed plant", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ revenue: 100_000, producedUnits: 900, capacityUnits: 1_000, mothballed: true })],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    expect(commodities).toEqual([]);
  });

  it("scales input consumption by plant utilization", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ revenue: 100_000, producedUnits: 600, capacityUnits: 1_000 })],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    // A plant running at 60% of nameplate buys ~60% of its inputs.
    const energy = commodities.find((c) => c.commodity === "energy")!;
    expect(energy.consumptionUnits).toBeCloseTo(
      dollarsToUnits(100_000 * 0.2, COMMODITY_BASE_PRICES.energy) * 0.6,
      1
    );
  });

  it("writes off the embargoed export share of production", () => {
    const { commodities } = computeCorpCommodityFlows(
      [
        mkSector({
          revenue: 100_000,
          producedUnits: 1_000,
          capacityUnits: 1_000,
          embargoExportExposure: 0.5,
        }),
      ],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    const steel = commodities.find((c) => c.commodity === "steel")!;
    const unembargoed =
      1_000 *
      commodityMixWeight({ steel: 0.4, building_materials: 0.2 }, COMMODITY_BASE_PRICES, "steel");
    expect(steel.outputUnits).toBeLessThan(unembargoed);
    expect(steel.outputUnits).toBeCloseTo(
      unembargoed * (1 - 0.5 * TRADE_EMBARGO_EXPORT_LOSS_SHARE),
      1
    );
  });

  it("excludes output diverted to a state arsenal", () => {
    const { commodities } = computeCorpCommodityFlows(
      [
        mkSector({
          revenue: 100_000,
          producedUnits: 1_000,
          capacityUnits: 1_000,
          militaryDivertedFraction: 0.25,
          militaryDivertedTurn: 10,
        }),
      ],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    const steel = commodities.find((c) => c.commodity === "steel")!;
    expect(steel.outputUnits).toBeCloseTo(
      1_000 *
        commodityMixWeight(
          { steel: 0.4, building_materials: 0.2 },
          COMMODITY_BASE_PRICES,
          "steel"
        ) *
        0.75,
      1
    );
  });

  it("drops extraction supply for resources the operating state has no deposits of", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ sectorType: "extraction", stateId: "CA", revenue: 100_000 })],
      10,
      new Map(),
      stateInfo,
      new Map(),
      { ...plants, stateResourcesByState: new Map([["CA", { iron: 500 }]]) }
    );

    // CA has iron deposits only — the other five extraction legs are phantom.
    expect(commodities.find((c) => c.commodity === "iron")!.outputUnits).toBeGreaterThan(0);
    for (const resource of ["coal", "oil", "rare_earth", "natural_gas", "timber"] as const) {
      expect(commodities.find((c) => c.commodity === resource)?.outputUnits ?? 0).toBe(0);
    }
  });

  it("keeps extraction on the nameplate derivation under plants", () => {
    // Extraction carries its own deposit-capacity rationing, so mixing in
    // `producedUnits` would double-count the haircut.
    const { commodities } = computeCorpCommodityFlows(
      [
        mkSector({
          sectorType: "extraction",
          revenue: 100_000,
          producedUnits: 5,
          capacityUnits: 1_000,
        }),
      ],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    const iron = commodities.find((c) => c.commodity === "iron")!;
    expect(iron.outputUnits).toBeCloseTo(
      dollarsToUnits(100_000 * 0.25, COMMODITY_BASE_PRICES.iron),
      1
    );
  });
});

describe("computeCorpCommodityFlows — ledger parity legs (ticket #1177 audit)", () => {
  const plants = { plantsEnabled: true, isNatcorp: false } as const;

  it("derates media supply the way the world ledger and the clearing offer do", () => {
    const { commodities } = computeCorpCommodityFlows(
      [mkSector({ sectorType: "media", producedUnits: 1_000, capacityUnits: 1_000 })],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    // Media is a single-output mix, so the whole 1,000 units carry the
    // market-economy media supply factor.
    const advertising = commodities.find((c) => c.commodity === "advertising")!;
    expect(advertising.outputUnits).toBeCloseTo(1_000 * MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR, 1);
  });

  it("remaps planned-economy media output off advertising", () => {
    const { commodities } = computeCorpCommodityFlows(
      [
        mkSector({
          sectorType: "media",
          countryId: "RU",
          producedUnits: 1_000,
          capacityUnits: 1_000,
        }),
      ],
      10,
      new Map(),
      stateInfo,
      new Map(),
      { ...plants, currentYear: 1953, commandEconomyEnabled: true }
    );

    // A command economy has no advertising market: its media output is state
    // information, and it carries the planned-economy supply factor.
    expect(commodities.find((c) => c.commodity === "advertising")).toBeUndefined();
    const planned = commodities.find((c) => c.commodity === PLANNED_ECONOMY_MEDIA_OUTPUT)!;
    expect(planned).toBeDefined();
    expect(planned.outputUnits).toBeCloseTo(1_000 * PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR, 1);
  });

  it("ignores an arsenal diversion left over from an ended contract", () => {
    const { commodities } = computeCorpCommodityFlows(
      [
        mkSector({
          producedUnits: 1_000,
          capacityUnits: 1_000,
          militaryDivertedFraction: 0.25,
          militaryDivertedTurn: 2,
        }),
      ],
      40,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    // The contract ended long ago; the world market books the full output, so
    // the tab must not keep shaving a quarter off it forever.
    const steel = commodities.find((c) => c.commodity === "steel")!;
    expect(steel.outputUnits).toBeCloseTo(
      1_000 *
        commodityMixWeight({ steel: 0.4, building_materials: 0.2 }, COMMODITY_BASE_PRICES, "steel"),
      1
    );
  });

  it("keeps the CEO pricing link for a plant that made nothing this turn", () => {
    // `outputSectors` is a capability list — which plants can make this, so the
    // CEO can go and price them. An idle plant is exactly the one you want to
    // reach, so it must not drop off the moment it produces zero.
    const { commodities } = computeCorpCommodityFlows(
      [
        mkSector({ _id: "busy" as never, producedUnits: 900, capacityUnits: 1_000 }),
        mkSector({ _id: "idle" as never, producedUnits: 0, capacityUnits: 1_000 }),
      ],
      10,
      new Map(),
      stateInfo,
      new Map(),
      plants
    );

    const steel = commodities.find((c) => c.commodity === "steel")!;
    expect(steel.outputSectors?.map((s) => s.sectorId).sort()).toEqual(["busy", "idle"]);
  });
});
