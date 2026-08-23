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

describe("computeRegionEnergyDeltas — grid reliability units (ticket #1129)", () => {
  const firmMix = [
    plant({ source: "nuclear" }),
    plant({ source: "coal" }),
    plant({ source: "hydro" }),
    plant({ source: "gas" }),
  ];

  it("raises reliability for a firm, diverse mix against a real 97-99.9 uptime", () => {
    // The bug: reliabilityScore returns a 0-100 QUALITY score, `current` is the
    // metric's own uptime percent. Differencing them made every mix negative.
    const d = computeRegionEnergyDeltas(firmMix, {
      renewable: 10,
      carbon: 30,
      reliability: 97.5,
    });
    expect(d["infrastructure.powerGridReliability"]).toBeGreaterThan(0);
  });

  it("lowers reliability for an all-intermittent mix", () => {
    const d = computeRegionEnergyDeltas([plant({ source: "solar" })], {
      renewable: 10,
      carbon: 30,
      reliability: 99.5,
    });
    expect(d["infrastructure.powerGridReliability"]).toBeLessThan(0);
  });

  it("does not pin every region to the negative clamp", () => {
    const d = computeRegionEnergyDeltas(firmMix, {
      renewable: 10,
      carbon: 30,
      reliability: 99,
    });
    expect(d["infrastructure.powerGridReliability"]).not.toBe(-0.08);
  });
});

describe("applyEnergyEffects — era band consistency (ticket #1142)", () => {
  /**
   * The reported symptom was a negative cabinet line on US
   * `infrastructure.utilities` that no cabinet action could explain. It was the
   * energy channel: `relTarget` is converted score→uptime against the ERA band
   * (85.5-98.3 in 1958) while `current` came back off the era-blind modern band
   * (97-99.9). The era band's CEILING sits below the modern band's mid, so the
   * gap was negative for every mix in the game — a perfect one included — and
   * `powerGridReliability` maps 1:1 onto `infrastructure.utilities`, so the
   * channel could only ever drag the reporter's own metric down.
   *
   * The #1129 tests above never caught it because they call the pure function
   * with no `era`, which is the one path production does not take.
   */
  function eraDbWith(plants: EnergyPlant[], utilitiesScore: number) {
    const db = createMockDb();
    db.collection("energyPlants").find = vi.fn().mockReturnValue({ toArray: async () => plants });
    db.collection("federalBudget").findOne = vi.fn().mockResolvedValue({ gdp: 1_000_000_000_000 });
    db.collection("stateMetrics").findOne = vi.fn().mockResolvedValue(null);
    db.collection("politicalMetrics").find = vi.fn().mockReturnValue({
      toArray: async () => [
        {
          _id: "US-CA",
          countryId: "US",
          values: { "infrastructure.utilities": utilitiesScore },
        },
      ],
    });
    db.collection("gameState").findOne = vi.fn().mockResolvedValue({
      _id: "current",
      currentYear: 1958,
      currentTurn: 318,
      startingYear: 1953,
      eraSystemEnabled: true,
    });
    return db as unknown as Db;
  }

  const reliabilityDelta = (regional: Record<string, Record<string, number>>) => {
    const row = regional["US-CA"] ?? {};
    const key = Object.keys(row).find((k) => k.includes("powerGridReliability"));
    return key ? row[key] : undefined;
  };

  const firmDiverse = [
    plant({ regionId: "US-CA", source: "nuclear" }),
    plant({ regionId: "US-CA", source: "coal" }),
    plant({ regionId: "US-CA", source: "gas" }),
    plant({ regionId: "US-CA", source: "hydro" }),
  ];

  it("raises reliability for a firm, diverse mix against a mid board score", async () => {
    const db = eraDbWith(firmDiverse, 50);
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEnergyEffects(db, "US", "secretary_of_energy", bucket);
    expect(reliabilityDelta(bucket.regional)).toBeGreaterThan(0);
  });

  it("still lowers reliability for an all-intermittent mix", async () => {
    const db = eraDbWith([plant({ regionId: "US-CA", source: "solar" })], 50);
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEnergyEffects(db, "US", "secretary_of_energy", bucket);
    expect(reliabilityDelta(bucket.regional)).toBeLessThan(0);
  });

  it("leaves a mix that matches the board's own standing flat", async () => {
    // reliabilityScore(firmDiverse) === 98, so a board already at 98 has nothing
    // to gain and the delta is exactly 0 — which the caller drops rather than
    // writing, hence "absent" is the flat case. Under the bug this read -0.018.
    const db = eraDbWith(firmDiverse, 98);
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEnergyEffects(db, "US", "secretary_of_energy", bucket);
    expect(Math.abs(reliabilityDelta(bucket.regional) ?? 0)).toBeLessThan(0.005);
  });
});
