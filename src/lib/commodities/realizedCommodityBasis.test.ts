/**
 * Cross-surface reconciliation for issue #1999.
 *
 * Fixed fixture: the market leaderboard aggregation
 * (`aggregateRealizedCommodityVolumes`, the exact chain behind
 * `GET /api/commodities/[type]`) must report the same realized physical units
 * as the corporation tab aggregation (`computeCorpCommodityFlows`, behind
 * `GET /api/corporations/[id]/commodities`) for the same turn and geographic
 * scope, for energy and for one intermediate input (steel).
 *
 * Covered: producer totals, consumer totals, rankings, geographic scope,
 * synthetic/advertising labels, the extraction exception, and rounding. The
 * last case keeps the old revenue/price nameplate as a negative control.
 */
import { describe, expect, it } from "vitest";
import {
  COMMODITY_BASE_PRICES,
  MARKETING_ADVERTISING_DEMAND_RATE,
  commodityMixWeight,
  dollarsToUnits,
  getCommodityStabilizer,
} from "@/lib/constants/commodities";
import { computeCorpCommodityFlows } from "@/lib/corporations/corpCommodityFlows";
import type { FlowSector } from "@/lib/corporations/corpCommodityFlows";
import {
  aggregateRealizedCommodityVolumes,
  isExtractionExceptionCommodity,
  realizedPerRowTolerance,
  realizedTotalTolerance,
  REALIZED_COMMODITY_ROUNDING_UNIT,
} from "./realizedCommodityBasis";
import type { RealizedLeaderboardSector } from "./realizedCommodityBasis";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import type { CommodityType } from "@/lib/constants/commodities";

/** Operating-strategy rate both surfaces actually use (differs from base tables). */
function strategyRate(
  sectorType:
    "manufacturing" | "technology" | "energy" | "retail" | "media_entertainment" | "extraction",
  kind: "supply" | "demand",
  commodity: CommodityType
): number {
  const rates = getEffectiveStrategyRates(sectorType, "standard", null, null, TURN);
  return (kind === "supply" ? rates.supply[commodity] : rates.demand[commodity]) ?? 0;
}

const TURN = 91;
const CONTEXT = { plantsEnabled: true, isNatcorp: false, eraUnitScale: 1 } as const;
const ROW_TOL = realizedPerRowTolerance();

const round2 = (n: number): number => Math.round(n * 100) / 100;

const stateInfo = new Map([
  ["CA", { name: "California", region: "West" }],
  ["NY", { name: "New York", region: "Northeast" }],
  ["LON", { name: "London", region: "South East" }],
]);

const stateCountryOf = (stateId: string): string | undefined =>
  stateId === "LON" ? "UK" : stateId === "CA" || stateId === "NY" ? "US" : undefined;

type FixtureSector = Omit<RealizedLeaderboardSector, "corporationId"> & { corpId: string };

const mkSector = (over: Partial<FixtureSector> & { corpId: string }): FixtureSector => ({
  sectorType: "manufacturing",
  stateId: "CA",
  countryId: "US",
  revenue: 100_000,
  strategyId: "standard",
  transitionFromStrategyId: null,
  transitionStartTurn: null,
  revenueAnchor: 100_000,
  producedUnits: 800,
  capacityUnits: 1_000,
  ...over,
});

const toFlowSector = (s: FixtureSector): FlowSector => ({
  sectorType: s.sectorType,
  stateId: s.stateId,
  countryId: s.countryId,
  revenue: s.revenue,
  strategyId: s.strategyId,
  transitionFromStrategyId: s.transitionFromStrategyId,
  transitionStartTurn: s.transitionStartTurn,
  revenueAnchor: s.revenueAnchor ?? s.revenue,
  producedUnits: s.producedUnits,
  capacityUnits: s.capacityUnits,
  mothballed: s.mothballed,
  productionPolicyLevel: s.productionPolicyLevel,
  embargoSuspended: s.embargoSuspended,
  embargoExportExposure: s.embargoExportExposure,
  militaryDivertedFraction: s.militaryDivertedFraction,
  militaryDivertedTurn: s.militaryDivertedTurn,
});

/** Corporation-tab output/consumption for one corp's sectors. */
function corpTabFor(sectors: FixtureSector[], corpId: string) {
  const owned = sectors.filter((s) => s.corpId === corpId).map(toFlowSector);
  const { commodities } = computeCorpCommodityFlows(owned, TURN, new Map(), stateInfo, new Map(), {
    ...CONTEXT,
  });
  return commodities;
}

function marketForCommodity(sectors: FixtureSector[], commodity: "energy" | "steel") {
  return aggregateRealizedCommodityVolumes(
    sectors.map((s) => ({ ...s, corporationId: s.corpId })),
    commodity,
    TURN,
    { ...CONTEXT },
    stateCountryOf
  );
}

/** Low-utilization energy producer plus intermediate consumers across two countries. */
function fixture(): FixtureSector[] {
  return [
    // Corp A: energy producer at 60% utilization (the low-utilization case
    // from the issue: revenue nameplate overstates it by 1/0.6 even before
    // the era-scale gap).
    mkSector({
      corpId: "corpA",
      sectorType: "energy",
      stateId: "CA",
      countryId: "US",
      revenue: 1_000_000,
      revenueAnchor: 1_000_000,
      producedUnits: 600,
      capacityUnits: 1_000,
    }),
    // Corp B: manufacturing consumer of energy, producer of steel (the
    // intermediate input), at 80% utilization.
    mkSector({
      corpId: "corpB",
      sectorType: "manufacturing",
      stateId: "NY",
      countryId: "US",
      revenue: 500_000,
      revenueAnchor: 500_000,
      producedUnits: 800,
      capacityUnits: 1_000,
    }),
    // Corp C: technology consumer in a second country (steel + energy inputs).
    mkSector({
      corpId: "corpC",
      sectorType: "technology",
      stateId: "LON",
      countryId: "UK",
      revenue: 300_000,
      revenueAnchor: 300_000,
      producedUnits: 900,
      capacityUnits: 1_000,
    }),
  ];
}

describe("realized basis reconciles market and corporation surfaces", () => {
  it("matches producer totals for energy within rounding tolerance", () => {
    const sectors = fixture();
    const market = marketForCommodity(sectors, "energy");
    for (const corpId of ["corpA", "corpB", "corpC"]) {
      const tab = corpTabFor(sectors, corpId).find((c) => c.commodity === "energy");
      const tabOutput = tab?.outputUnits ?? 0;
      const marketUnits = market.supplyByCorp.get(corpId) ?? 0;
      expect(Math.abs(round2(marketUnits) - tabOutput)).toBeLessThanOrEqual(ROW_TOL);
    }
    // Corp A realizes its measured 600 units, all of them energy (single-output mix).
    expect(round2(market.supplyByCorp.get("corpA") ?? 0)).toBeCloseTo(600, 1);
    // Totals reconcile within one cent per row.
    const marketTotal = [...market.supplyByCorp.values()].reduce((a, b) => a + b, 0);
    const tabTotal = ["corpA", "corpB", "corpC"].reduce(
      (sum, corpId) =>
        sum + (corpTabFor(sectors, corpId).find((c) => c.commodity === "energy")?.outputUnits ?? 0),
      0
    );
    expect(Math.abs(round2(marketTotal) - round2(tabTotal))).toBeLessThanOrEqual(
      realizedTotalTolerance(market.supplyByCorp.size)
    );
  });

  it("matches consumer totals for energy within rounding tolerance", () => {
    const sectors = fixture();
    const market = marketForCommodity(sectors, "energy");
    for (const corpId of ["corpB", "corpC"]) {
      const tab = corpTabFor(sectors, corpId).find((c) => c.commodity === "energy");
      const tabConsumption = tab?.consumptionUnits ?? 0;
      const marketUnits = market.demandByCorp.get(corpId) ?? 0;
      expect(Math.abs(round2(marketUnits) - tabConsumption)).toBeLessThanOrEqual(ROW_TOL);
    }
    // Utilization-scaled: manufacturing at 80% buys 80% of its energy nameplate.
    const expectedB =
      dollarsToUnits(
        500_000 * strategyRate("manufacturing", "demand", "energy"),
        COMMODITY_BASE_PRICES.energy
      ) * 0.8;
    expect(round2(market.demandByCorp.get("corpB") ?? 0)).toBeCloseTo(round2(expectedB), 1);
    expect(market.demandByCorp.get("corpA") ?? 0).toBe(0);
  });

  it("matches producer and consumer totals for the intermediate input steel", () => {
    const sectors = fixture();
    const market = marketForCommodity(sectors, "steel");
    // Producer: corp B splits measured output across the manufacturing mix.
    const expectedB =
      800 *
      commodityMixWeight({ steel: 0.4, building_materials: 0.2 }, COMMODITY_BASE_PRICES, "steel");
    expect(round2(market.supplyByCorp.get("corpB") ?? 0)).toBeCloseTo(round2(expectedB), 1);
    const tabB = corpTabFor(sectors, "corpB").find((c) => c.commodity === "steel");
    expect(
      Math.abs(round2(market.supplyByCorp.get("corpB") ?? 0) - (tabB?.outputUnits ?? 0))
    ).toBeLessThanOrEqual(ROW_TOL);
    // Consumers: energy plants buy steel (corp A @60%), tech buys steel (corp C @90%).
    const expectedA =
      dollarsToUnits(
        1_000_000 * strategyRate("energy", "demand", "steel"),
        COMMODITY_BASE_PRICES.steel
      ) * 0.6;
    const expectedC =
      dollarsToUnits(
        300_000 * strategyRate("technology", "demand", "steel"),
        COMMODITY_BASE_PRICES.steel
      ) * 0.9;
    expect(round2(market.demandByCorp.get("corpA") ?? 0)).toBeCloseTo(round2(expectedA), 1);
    expect(round2(market.demandByCorp.get("corpC") ?? 0)).toBeCloseTo(round2(expectedC), 1);
    for (const corpId of ["corpA", "corpC"]) {
      const tab = corpTabFor(sectors, corpId).find((c) => c.commodity === "steel");
      expect(
        Math.abs(round2(market.demandByCorp.get(corpId) ?? 0) - (tab?.consumptionUnits ?? 0))
      ).toBeLessThanOrEqual(ROW_TOL);
    }
  });

  it("preserves rankings across surfaces", () => {
    const sectors = fixture();
    const market = marketForCommodity(sectors, "energy");
    // Leaderboard maps only carry positive volumes; mirror that for the tab side.
    const rank = (m: Map<string, number>): string[] =>
      [...m.entries()]
        .filter(([, units]) => units > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
    const marketProducers = rank(market.supplyByCorp);
    const tabOutputs = new Map(
      ["corpA", "corpB", "corpC"].map((corpId) => [
        corpId,
        corpTabFor(sectors, corpId).find((c) => c.commodity === "energy")?.outputUnits ?? 0,
      ])
    );
    expect(rank(tabOutputs)).toEqual(marketProducers);
    const marketConsumers = rank(market.demandByCorp);
    const tabInputs = new Map(
      ["corpA", "corpB", "corpC"].map((corpId) => [
        corpId,
        corpTabFor(sectors, corpId).find((c) => c.commodity === "energy")?.consumptionUnits ?? 0,
      ])
    );
    expect(rank(tabInputs)).toEqual(marketConsumers);
  });

  it("reconciles the same geographic scope (global and per-country)", () => {
    const sectors = fixture();
    const market = marketForCommodity(sectors, "energy");
    // Global: market totals equal the summed corporation tabs.
    const globalMarket = round2([...market.supplyByCorp.values()].reduce((a, b) => a + b, 0));
    const globalTab = round2(
      ["corpA", "corpB", "corpC"].reduce(
        (sum, corpId) =>
          sum +
          (corpTabFor(sectors, corpId).find((c) => c.commodity === "energy")?.outputUnits ?? 0),
        0
      )
    );
    expect(Math.abs(globalMarket - globalTab)).toBeLessThanOrEqual(
      realizedTotalTolerance(market.supplyByCorp.size)
    );
    // Country slice: the US slice holds corps A + B only, the UK slice corp C.
    const usSlice = market.supplyByCountry.get("US") ?? new Map();
    expect(usSlice.get("corpA") ?? 0).toBeCloseTo(market.supplyByCorp.get("corpA") ?? 0, 1);
    expect(usSlice.has("corpC")).toBe(false);
    const ukSlice = market.demandByCountry.get("UK") ?? new Map();
    expect(ukSlice.get("corpC") ?? 0).toBeCloseTo(market.demandByCorp.get("corpC") ?? 0, 1);
    expect(ukSlice.has("corpB")).toBe(false);
  });

  it("keeps advertising-budget and synthetic demand labelled, never as consumption", () => {
    const sectors: FixtureSector[] = [
      mkSector({
        corpId: "corpM",
        sectorType: "media_entertainment",
        stateId: "CA",
        countryId: "US",
        revenue: 200_000,
        revenueAnchor: 200_000,
        producedUnits: 1_000,
        capacityUnits: 1_000,
      }),
      mkSector({
        corpId: "corpR",
        sectorType: "retail",
        stateId: "CA",
        countryId: "US",
        revenue: 400_000,
        revenueAnchor: 400_000,
        producedUnits: 1_000,
        capacityUnits: 1_000,
      }),
    ];
    const market = aggregateRealizedCommodityVolumes(
      sectors.map((s) => ({ ...s, corporationId: s.corpId })),
      "advertising",
      TURN,
      { ...CONTEXT },
      stateCountryOf
    );
    // The helper reports plant input demand only: the retail leg, and nothing
    // for the media producer (media supplies advertising, it does not consume it).
    const retailInput =
      dollarsToUnits(
        400_000 * strategyRate("retail", "demand", "advertising"),
        COMMODITY_BASE_PRICES.advertising
      ) * 1.0;
    expect(round2(market.demandByCorp.get("corpR") ?? 0)).toBeCloseTo(round2(retailInput), 1);
    expect(market.demandByCorp.get("corpM") ?? 0).toBe(0);
    // A marketing budget converts to SEPARATE market-level demand, never folded
    // into the helper's consumption maps.
    const budgetUnits = dollarsToUnits(
      50_000 * MARKETING_ADVERTISING_DEMAND_RATE,
      COMMODITY_BASE_PRICES.advertising
    );
    expect(budgetUnits).toBeGreaterThan(0);
    expect(market.demandByCorp.get("corpM") ?? 0).toBe(0);
    // Synthetic non-corporate demand (base stabilizer) is not in the helper either.
    expect(getCommodityStabilizer("advertising")).toBeGreaterThanOrEqual(0);
    const helperTotal = [...market.demandByCorp.values()].reduce((a, b) => a + b, 0);
    expect(helperTotal).toBeCloseTo(retailInput, 1);
  });

  it("preserves the extraction exception instead of reconstructing turn factors", () => {
    expect(isExtractionExceptionCommodity("iron")).toBe(true);
    expect(isExtractionExceptionCommodity("energy")).toBe(false);
    const sectors: FixtureSector[] = [
      mkSector({
        corpId: "corpX",
        sectorType: "extraction",
        stateId: "CA",
        countryId: "US",
        revenue: 100_000,
        revenueAnchor: 100_000,
        // Measured production exists but MUST be ignored for extraction: the
        // nameplate already carries the deposit-capacity haircut.
        producedUnits: 5,
        capacityUnits: 1_000,
      }),
    ];
    const context = {
      ...CONTEXT,
      stateResourcesByState: new Map([["CA", { iron: 500 }]]),
    };
    const market = aggregateRealizedCommodityVolumes(
      sectors.map((s) => ({ ...s, corporationId: s.corpId })),
      "iron",
      TURN,
      context,
      stateCountryOf
    );
    const tab = computeCorpCommodityFlows(
      sectors.map(toFlowSector),
      TURN,
      new Map(),
      stateInfo,
      new Map(),
      context
    ).commodities.find((c) => c.commodity === "iron");
    // Both surfaces share the nameplate basis (not the 5 measured units).
    const nameplate = dollarsToUnits(
      100_000 * strategyRate("extraction", "supply", "iron"),
      COMMODITY_BASE_PRICES.iron
    );
    expect(round2(market.supplyByCorp.get("corpX") ?? 0)).toBeCloseTo(round2(nameplate), 1);
    expect(tab?.outputUnits).toBeCloseTo(round2(nameplate), 1);
    // And neither reconstructs the unpersisted realized fraction: a ledger leg
    // scaled by a hypothetical 0.5 factor is a DIFFERENT number, and the
    // display surfaces must not claim it.
    expect(round2(market.supplyByCorp.get("corpX") ?? 0)).not.toBeCloseTo(
      round2(nameplate * 0.5),
      1
    );
  });

  it("documents rounding tolerance explicitly and holds it", () => {
    expect(REALIZED_COMMODITY_ROUNDING_UNIT).toBe(0.01);
    expect(ROW_TOL).toBeGreaterThan(0.01);
    expect(realizedTotalTolerance(3)).toBeGreaterThan(realizedPerRowTolerance());
    const sectors = fixture();
    const market = marketForCommodity(sectors, "energy");
    // Every market figure, once rounded to display precision, is what the tab shows.
    for (const corpId of ["corpA", "corpB", "corpC"]) {
      const tab = corpTabFor(sectors, corpId).find((c) => c.commodity === "energy");
      expect(
        Math.abs(round2(market.supplyByCorp.get(corpId) ?? 0) - (tab?.outputUnits ?? 0))
      ).toBeLessThanOrEqual(ROW_TOL);
    }
  });

  it("negative control: the old revenue/price nameplate diverges at low utilization", () => {
    // The pre-fix market path reported revenue x rate / price with no
    // utilization leg. For corp A at 60% utilization that overstates realized
    // output: the shape of the 59x-class gaps in the issue (wider still with
    // the era-scale gap layered on).
    const oldNameplate = dollarsToUnits(
      1_000_000 * strategyRate("energy", "supply", "energy"),
      COMMODITY_BASE_PRICES.energy
    );
    const realized = 600;
    expect(oldNameplate / realized).toBeGreaterThan(5);
    const sectors = fixture();
    const market = marketForCommodity(sectors, "energy");
    // The fixed basis reports realized output, not the nameplate.
    expect(round2(market.supplyByCorp.get("corpA") ?? 0)).toBeCloseTo(realized, 1);
    expect(round2(market.supplyByCorp.get("corpA") ?? 0)).not.toBeCloseTo(round2(oldNameplate), 0);
  });
});
