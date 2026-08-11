import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { reliabilityScore, computeRegionEnergyDeltas, applyEnergyEffects } from "./energyEffects";
import { aggregateMix } from "@/lib/constants/cabinetEnergy";
import type { EnergyPlant } from "@/lib/db/types/energyPlant";
import { createMockDb } from "@/lib/test-utils/mockDb";

function plant(p: Partial<EnergyPlant>): EnergyPlant {
  return {
    _id: new ObjectId(),
    countryId: "US",
    positionId: "secretary_of_energy",
    source: "coal",
    name: "P",
    icon: "coal",
    capacityBase: 1000,
    tier: 0,
    regionId: "US-CA",
    createdTurn: 1,
    ...p,
  };
}

describe("reliabilityScore", () => {
  it("rewards firm capacity, penalizes all-intermittent", () => {
    const firm = reliabilityScore(aggregateMix([plant({ source: "nuclear" })]));
    const intermittent = reliabilityScore(aggregateMix([plant({ source: "solar" })]));
    expect(firm).toBeGreaterThan(intermittent);
  });
});

describe("computeRegionEnergyDeltas", () => {
  it("nudges renewable up toward a renewable-heavy mix", () => {
    const d = computeRegionEnergyDeltas([plant({ source: "wind" }), plant({ source: "solar" })], {
      renewable: 10,
      carbon: 30,
      reliability: 50,
    });
    expect(d["environment.renewableEnergy"]).toBeGreaterThan(0);
  });
  it("nudges renewable down toward a fossil-heavy mix + carbon up", () => {
    const d = computeRegionEnergyDeltas([plant({ source: "coal" }), plant({ source: "gas" })], {
      renewable: 80,
      carbon: 5,
      reliability: 90,
    });
    expect(d["environment.renewableEnergy"]).toBeLessThan(0);
    expect(d["environment.carbonEmissions"]).toBeGreaterThan(0);
  });
  it("saturates the cap far from target and eases near it", () => {
    const far = computeRegionEnergyDeltas([plant({ source: "wind" })], {
      renewable: 0,
      carbon: 0,
      reliability: 0,
    });
    expect(far["environment.renewableEnergy"]).toBeCloseTo(0.08, 5); // (100-0)×0.01 clamped
    const near = computeRegionEnergyDeltas([plant({ source: "wind" })], {
      renewable: 98,
      carbon: 0,
      reliability: 0,
    });
    expect(near["environment.renewableEnergy"]).toBeCloseTo(0.02, 5); // (100-98)×0.01
  });
  it("returns {} for no plants", () => {
    expect(computeRegionEnergyDeltas([], { renewable: 50, carbon: 30, reliability: 50 })).toEqual(
      {}
    );
  });
});

function dbWith(plants: EnergyPlant[], budget: unknown) {
  const db = createMockDb();
  db.collection("energyPlants").find = vi.fn().mockReturnValue({ toArray: async () => plants });
  db.collection("federalBudget").findOne = vi.fn().mockResolvedValue(budget);
  db.collection("stateMetrics").findOne = vi.fn().mockResolvedValue(null);
  return db as unknown as Db;
}

describe("applyEnergyEffects routing", () => {
  it("routes per-region deltas to bucket.regional + tilts national budget", async () => {
    const db = dbWith([plant({ regionId: "US-CA", source: "wind" })], {
      gdp: 1_000_000_000_000,
    });
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEnergyEffects(db, "US", "secretary_of_energy", bucket);
    expect(bucket.regional["US-CA"]).toBeDefined();
    expect(bucket.national["governance.budgetBalance"]).toBeDefined();
  });
  it("no-op for a non-energy seat", async () => {
    const db = dbWith([plant({})], { gdp: 1_000_000 });
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEnergyEffects(db, "US", "secretary_of_state", bucket);
    expect(Object.keys(bucket.regional)).toHaveLength(0);
  });
});
