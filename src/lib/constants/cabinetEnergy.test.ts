import { describe, it, expect } from "vitest";
import {
  ENERGY_SOURCES,
  ENERGY_POSITION_BY_COUNTRY,
  TIER_MULTIPLIER,
  resolveEnergyPosition,
  getEnergySource,
  effectiveCapacity,
  effectiveUpkeep,
  aggregateMix,
  ENERGY_DISCRETIONARY_FRACTION,
} from "./cabinetEnergy";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "./cabinetEstates";
import type { EnergyPlant } from "@/lib/db/types/energyPlant";

function plant(p: Partial<EnergyPlant>): EnergyPlant {
  return {
    _id: undefined as never,
    countryId: "US",
    positionId: "secretary_of_energy",
    source: "coal",
    name: "P",
    icon: "coal",
    capacityBase: 800,
    tier: 0,
    regionId: "US-CA",
    createdTurn: 1,
    ...p,
  };
}

describe("ENERGY_SOURCES integrity", () => {
  it("has all 6 sources with consistent traits", () => {
    const ids = ENERGY_SOURCES.map((s) => s.id).sort();
    expect(ids).toEqual(["coal", "gas", "hydro", "nuclear", "solar", "wind"]);
    for (const s of ENERGY_SOURCES) {
      expect(s.firmness).toBeGreaterThanOrEqual(0);
      expect(s.firmness).toBeLessThanOrEqual(1);
      expect(s.carbonPerMW).toBeGreaterThanOrEqual(0);
      expect(s.baseCapacity).toBeGreaterThan(0);
      if (s.renewable) expect(s.carbonPerMW).toBe(0);
    }
    expect(getEnergySource("nuclear")?.carbonPerMW).toBe(0);
    expect(getEnergySource("nuclear")?.renewable).toBe(false);
  });
});

describe("resolveEnergyPosition + collisions", () => {
  it("maps each country's energy seat", () => {
    expect(resolveEnergyPosition("US", "secretary_of_energy")).toBe("secretary_of_energy");
    expect(resolveEnergyPosition("DE", "economy_minister")).toBe("economy_minister");
    expect(resolveEnergyPosition("US", "secretary_of_state")).toBeNull();
  });
  it("never maps an energy seat to a transportation seat", () => {
    const transportish = /transport|transportation|land_minister/;
    for (const seat of Object.values(ENERGY_POSITION_BY_COUNTRY)) {
      expect(transportish.test(seat!)).toBe(false);
    }
  });
  it("every non-US energy seat is also an Estates seat (dual flagship)", () => {
    for (const [cc, seat] of Object.entries(ENERGY_POSITION_BY_COUNTRY)) {
      if (cc === "US") continue;
      expect(
        ESTATE_PORTFOLIO_BY_COUNTRY[cc as keyof typeof ESTATE_PORTFOLIO_BY_COUNTRY]?.[seat!]
      ).toBeDefined();
    }
    expect(ESTATE_PORTFOLIO_BY_COUNTRY.US?.["secretary_of_energy"]).toBeUndefined();
  });
});

describe("capacity / upkeep / aggregateMix", () => {
  it("scales capacity by tier", () => {
    expect(effectiveCapacity(plant({ capacityBase: 800, tier: 0 }))).toBe(800);
    expect(effectiveCapacity(plant({ capacityBase: 800, tier: 2 }))).toBe(800 * TIER_MULTIPLIER[2]);
  });
  it("upkeep = effective capacity × source upkeepPerMW", () => {
    const c = getEnergySource("coal")!;
    expect(effectiveUpkeep(plant({ source: "coal", capacityBase: 800, tier: 0 }))).toBeCloseTo(
      800 * c.upkeepPerMW,
      5
    );
  });
  it("aggregates shares, firmness, carbon intensity", () => {
    const agg = aggregateMix([
      plant({ source: "coal", capacityBase: 1000, tier: 0 }),
      plant({ source: "wind", capacityBase: 1000, tier: 0 }),
    ]);
    expect(agg.totalCapacity).toBe(2000);
    expect(agg.renewableShare).toBeCloseTo(0.5, 5);
    expect(agg.bySource.coal).toBe(1000);
    expect(agg.carbonIntensity).toBeGreaterThan(0);
    expect(aggregateMix([]).carbonIntensity).toBe(0);
    expect(aggregateMix([]).renewableShare).toBe(0);
  });
});

describe("calibration", () => {
  it("source upkeep magnitudes are in a sane band (millions/turn at base capacity)", () => {
    for (const s of ENERGY_SOURCES) {
      const baseUpkeep = s.baseCapacity * s.upkeepPerMW; // millions/turn for one base plant
      expect(baseUpkeep).toBeGreaterThan(0);
      expect(baseUpkeep, s.id).toBeLessThanOrEqual(200); // ≤ $200M/turn per plant before tier
    }
  });

  it("a representative starter fleet's upkeep fits inside the discretionary envelope", () => {
    // ~one plant per source, tier 0 → a balanced starter fleet.
    const fleet = ENERGY_SOURCES.map((s) => plant({ source: s.id, capacityBase: s.baseCapacity }));
    const agg = aggregateMix(fleet);
    expect(agg.totalUpkeep).toBeGreaterThan(0);
    // A US-scale energy DISCRETIONARY envelope (gdp ~25T × 0.015 × the discretionary fraction),
    // in millions. A starter fleet sits inside it; a built-up fleet exceeds it.
    const envelopeM = (25_000_000_000_000 * 0.015 * ENERGY_DISCRETIONARY_FRACTION) / 1_000_000;
    expect(agg.totalUpkeep).toBeLessThan(envelopeM);
  });
});
