/**
 * Era ledger unit rescale (ticket #1027 phase 2).
 *
 * Under plants on an era world, supply is physical `producedUnits` on the era
 * unit basis (capitalStock carries ~69.8x for 1953), while every
 * dollars-to-units leg in `computeRawSupplyDemand` divided era-nominal revenue
 * by the MODERN base-price table - undercounting intermediate demand, macro
 * GDP demand and legacy nameplate supply ~70x against plants supply. These
 * tests pin the rescale: no-op at scale 1, linear scaling of every
 * dollars-derived leg, the plants `producedUnits` path untouched, and the
 * PLANTS_LEDGER_DEMAND_SUPPLY_CAP pass (cap at 1.5x supply, state-share
 * preservation, never below the unscaled-basis demand).
 */
import { describe, it, expect } from "vitest";
import {
  computeRawSupplyDemand,
  getCommodityStabilizer,
  COMMODITY_BASE_PRICES,
  PLANTS_LEDGER_DEMAND_SUPPLY_CAP,
  SECTOR_DEMAND,
  type CommodityType,
} from "./commodities";

const SCALE = 69.8;

/** A manufacturing plant with a physical production record (plants tier). */
const plant = (over: Record<string, unknown> = {}) => ({
  sectorType: "manufacturing",
  revenue: 1_000_000,
  stateId: "TX",
  producedUnits: 500_000,
  capacityUnits: 500_000,
  ...over,
});

const run = (
  sectors: Parameters<typeof computeRawSupplyDemand>[0],
  luScale: number,
  opts: { stateGdpMap?: Map<string, number> } = {}
) =>
  computeRawSupplyDemand(
    sectors,
    { nationalAverage: 0, byState: new Map() },
    opts.stateGdpMap,
    undefined, // no turn → no drift, deterministic
    opts.stateGdpMap ? new Map([...opts.stateGdpMap.keys()].map((s) => [s, 2.75])) : undefined,
    undefined,
    false,
    undefined,
    false,
    true, // plantsEnabled
    luScale
  );

describe("computeRawSupplyDemand - ledgerUnitScale (ticket #1027 phase 2)", () => {
  it("scale 1 / absent / garbage is byte-identical to the legacy path", () => {
    const sectors = [plant()];
    const base = computeRawSupplyDemand(
      sectors,
      { nationalAverage: 0, byState: new Map() },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      true
    );
    for (const bad of [1, 0, -3, NaN, Infinity]) {
      const scaled = run(sectors, bad);
      for (const [c, bal] of base.global) {
        expect(scaled.global.get(c)!.supply).toBe(bal.supply);
        expect(scaled.global.get(c)!.demand).toBe(bal.demand);
      }
    }
  });

  it("scales INPUT demand linearly while leaving plants producedUnits supply untouched", () => {
    // Tiny revenue so the rescaled demand stays far below the 1.5x supply cap.
    const sectors = [plant({ revenue: 1_000 })];
    const base = run(sectors, 1);
    const scaled = run(sectors, SCALE);
    const inputs = (SECTOR_DEMAND["manufacturing"] ?? []).map((f) => f.commodity);
    expect(inputs.length).toBeGreaterThan(0);
    for (const c of inputs as CommodityType[]) {
      const stab = getCommodityStabilizer(c);
      const baseLeg = base.global.get(c)!.demand - stab;
      const scaledLeg = scaled.global.get(c)!.demand - stab;
      expect(baseLeg).toBeGreaterThan(0);
      expect(scaledLeg).toBeCloseTo(baseLeg * SCALE, 6);
    }
    // Supply for the plant's own outputs comes from producedUnits (already era
    // units) - the rescale must not double it.
    for (const [c, bal] of scaled.global) {
      expect(bal.supply).toBe(base.global.get(c)!.supply);
    }
  });

  it("scales the legacy nameplate supply path (extraction) so both legacy legs move together", () => {
    const sectors = [
      { sectorType: "extraction", revenue: 1_000, stateId: "TX" },
      plant({ revenue: 1_000 }),
    ];
    const base = run(sectors, 1);
    const scaled = run(sectors, SCALE);
    const stab = getCommodityStabilizer("iron");
    const baseLeg = base.global.get("iron")!.supply - stab;
    const scaledLeg = scaled.global.get("iron")!.supply - stab;
    expect(baseLeg).toBeGreaterThan(0);
    expect(scaledLeg).toBeCloseTo(baseLeg * SCALE, 6);
  });

  it("scales the macro GDP demand legs (network/entertainment/construction services)", () => {
    const stateGdpMap = new Map([["TX", 1_000_000]]);
    const base = run([plant({ revenue: 0 })], 1, { stateGdpMap });
    const scaled = run([plant({ revenue: 0 })], SCALE, { stateGdpMap });
    for (const c of [
      "network_services",
      "entertainment_services",
      "construction_services",
    ] as CommodityType[]) {
      const stab = getCommodityStabilizer(c);
      const baseLeg = base.global.get(c)!.demand - stab;
      const scaledLeg = scaled.global.get(c)!.demand - stab;
      expect(baseLeg).toBeGreaterThan(0);
      expect(scaledLeg).toBeCloseTo(baseLeg * SCALE, 6);
    }
  });

  it("caps rescaled demand at PLANTS_LEDGER_DEMAND_SUPPLY_CAP x supply, preserving state shares", () => {
    // Manufacturing input demand for energy rescales far past supply; an
    // energy plant provides real physical supply so the cap binds ABOVE the
    // unscaled demand level (the floor test below covers the other side).
    const sectors = [
      plant({ stateId: "S1", revenue: 10_000_000, producedUnits: 1_000, capacityUnits: 1_000 }),
      plant({ stateId: "S2", revenue: 30_000_000, producedUnits: 3_000, capacityUnits: 3_000 }),
      plant({
        sectorType: "energy",
        stateId: "S3",
        revenue: 0,
        producedUnits: 2_000_000,
        capacityUnits: 2_000_000,
      }),
    ];
    const unscaled = run(sectors, 1);
    const scaled = run(sectors, SCALE);
    const energy = scaled.global.get("energy")!;
    // Preconditions for the cap to be the binding bound.
    expect(unscaled.global.get("energy")!.demand).toBeLessThan(
      energy.supply * PLANTS_LEDGER_DEMAND_SUPPLY_CAP
    );
    expect(energy.demand).toBeCloseTo(energy.supply * PLANTS_LEDGER_DEMAND_SUPPLY_CAP, 6);
    // The truncated amount is recorded so the real gap stays visible (#1460).
    const truncated = scaled.demandTruncated.get("energy") ?? 0;
    expect(truncated).toBeGreaterThan(0);
    expect(energy.demand + truncated).toBeGreaterThan(
      energy.supply * PLANTS_LEDGER_DEMAND_SUPPLY_CAP
    );
    expect(unscaled.demandTruncated.get("energy") ?? 0).toBe(0);
    // State shares preserved: S2 carries 3x S1's revenue, keeps 3x the demand.
    const s1 = scaled.byState.get("S1")!.get("energy")!.demand;
    const s2 = scaled.byState.get("S2")!.get("energy")!.demand;
    expect(s2 / s1).toBeCloseTo(3, 4);
  });

  it("never cuts a commodity below its unscaled-basis demand (legacy shortages keep their pressure)", () => {
    // Agriculture demands fertilizers; give it a huge nameplate so even the
    // UNSCALED fertilizer demand exceeds 1.5x the (near-zero) supply. The cap
    // must fall back to the unscaled level, not to 1.5x supply.
    const rate = (SECTOR_DEMAND["agriculture"] ?? []).find(
      (f) => f.commodity === "fertilizers"
    )!.rate;
    const revenue = 1_000_000_000;
    const sectors = [
      { sectorType: "agriculture", revenue, stateId: "TX", producedUnits: 10, capacityUnits: 10 },
    ];
    const scaled = run(sectors, SCALE);
    const fert = scaled.global.get("fertilizers")!;
    const stab = getCommodityStabilizer("fertilizers");
    const unscaledLeg = (revenue * rate) / COMMODITY_BASE_PRICES["fertilizers"];
    expect(fert.demand).toBeCloseTo(stab + unscaledLeg, 6);
    expect(fert.demand).toBeGreaterThan(fert.supply * PLANTS_LEDGER_DEMAND_SUPPLY_CAP);
  });
});
