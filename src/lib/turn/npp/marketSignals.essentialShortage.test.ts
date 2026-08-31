import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  findBestUnownedSector,
  sectorShortageScore,
  ESSENTIAL_SHORTAGE_SCORE,
  fragileMarketCommodityForSector,
  fragileMarketFoundingStrategy,
} from "./marketSignals";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

const us = (sectorType: string, stateId: string, revenue = 100_000): UnownedSector =>
  ({
    _id: new ObjectId(),
    stateId,
    countryId: "US" as CountryId,
    sectorType: sectorType as UnownedSector["sectorType"],
    revenue,
    headroomUnits: revenue,
  }) as UnownedSector;

const ratios =
  (map: Partial<Record<CommodityType, number>>) =>
  (commodity: CommodityType): number | null =>
    map[commodity] ?? 1;

const pool = new Map([
  ["US", [us("manufacturing", "PA"), us("logistics", "NY"), us("agriculture", "IA")]],
]);

describe("essential-shortage founding override (freight valve)", () => {
  it("a manufacturing corp founds LOGISTICS when freight is critically short", () => {
    // freight 2.0x base clears the bar; the corp is manufacturing-typed with a
    // manufacturing pool available, so pre-override it would take tier 1.
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({ freight: 2.0 }),
      false
    );
    expect(pick?.sectorType).toBe("logistics");
  });

  it("takes its own type when freight is only mildly elevated (below the bar)", () => {
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({ freight: 1.3 }), // < ESSENTIAL_SHORTAGE_SCORE
      false
    );
    expect(pick?.sectorType).toBe("manufacturing");
  });

  it("does not re-found the same type in the same state", () => {
    // The NY logistics bucket is occupied, so the corp falls back to the open
    // manufacturing bucket in PA. The same type remains legal in other states.
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(["NY:logistics"]),
      pool,
      new Set(),
      ratios({ freight: 2.0 }),
      false
    );
    expect(pick?.sectorType).toBe("manufacturing");
  });

  it("picks the SHORTEST commodity when several clear the bar", () => {
    // freight 1.7x vs food 2.5x: an agriculture-strategy sector (food) outscores
    // logistics (freight), so the override prefers food.
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({ freight: 1.7, food: 2.5 }),
      false
    );
    expect(pick?.sectorType).toBe("agriculture");
  });

  it("triggers on the sector's shortest output, not the blended average", () => {
    // logistics makes freight 0.45 + consulting 0.25. Blended score at freight
    // 2.0x is only ~1.64 (consulting dilutes it); the PEAK is 2.0, which is what
    // the override gates on — so freight 2.0x reliably surfaces logistics even
    // though its co-product is at base. This is why the gate uses peak, not blend.
    const blended = sectorShortageScore("logistics", "US", ratios({ freight: 2.0 }));
    expect(blended).toBeLessThan(2.0); // co-product drags the average down
    expect(ESSENTIAL_SHORTAGE_SCORE).toBeGreaterThan(1);
    expect(ESSENTIAL_SHORTAGE_SCORE).toBeLessThan(blended + 0.05); // still fires via peak
  });
});

describe("governed fragile-market supply routing", () => {
  it("reallocates an existing critical-shortage slot to dedicated fertilizer capacity", () => {
    const candidates = new Map([
      ["US", [us("energy", "PA", 1_000_000), us("chemical_industries", "NY", 100_000)]],
    ]);
    const prices = ratios({ energy: 3, fertilizers: 2.5 });

    const control = findBestUnownedSector(
      "US",
      "PA",
      "energy",
      null,
      new Set(),
      candidates,
      new Set(),
      prices,
      false
    );
    const treatment = findBestUnownedSector(
      "US",
      "PA",
      "energy",
      null,
      new Set(),
      candidates,
      new Set(),
      prices,
      false,
      1,
      { preferFragileMarketSupply: true }
    );

    expect(control?.sectorType).toBe("energy");
    expect(treatment?.sectorType).toBe("chemical_industries");
    expect(fragileMarketFoundingStrategy("chemical_industries", "US", prices)).toBe("fertilizers");
  });

  it("self-disarms below the shared critical-shortage threshold", () => {
    const candidates = new Map([
      ["US", [us("manufacturing", "PA", 1_000_000), us("media", "NY", 100_000)]],
    ]);
    const prices = ratios({ advertising: ESSENTIAL_SHORTAGE_SCORE - 0.01 });
    const treatment = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      candidates,
      new Set(),
      prices,
      false,
      1,
      { preferFragileMarketSupply: true }
    );

    expect(treatment?.sectorType).toBe("manufacturing");
    expect(fragileMarketCommodityForSector("media", "US", prices)).toBeNull();
  });

  it("keeps rare-earth entry subject to deposit headroom", () => {
    const candidates = new Map([
      ["US", [us("energy", "PA", 1_000_000), us("extraction", "NY", 100_000)]],
    ]);
    const prices = ratios({ energy: 3, rare_earth: 2 });
    const treatment = findBestUnownedSector(
      "US",
      "PA",
      "energy",
      null,
      new Set(),
      candidates,
      new Set(),
      prices,
      false,
      1,
      {
        preferFragileMarketSupply: true,
        extractionHeadroomOf: () => 0,
      }
    );

    expect(treatment?.sectorType).toBe("energy");
    expect(fragileMarketFoundingStrategy("extraction", "US", prices)).toBe("rare_earth_mining");
  });

  it("does not route market supply treatment into a planned economy", () => {
    const candidates = new Map([
      ["US", [us("energy", "PA", 1_000_000), us("media", "NY", 100_000)]],
    ]);
    const treatment = findBestUnownedSector(
      "US",
      "PA",
      "energy",
      null,
      new Set(),
      candidates,
      new Set(),
      ratios({ energy: 3, advertising: 2 }),
      false,
      1,
      {
        preferFragileMarketSupply: true,
        fragileMarketCountryEligible: () => false,
      }
    );

    expect(treatment?.sectorType).toBe("energy");
  });
});
