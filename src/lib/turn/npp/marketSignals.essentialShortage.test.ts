import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  findBestUnownedSector,
  sectorShortageScore,
  ESSENTIAL_SHORTAGE_SCORE,
} from "./marketSignals";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

const us = (sectorType: string, stateId: string, revenue = 100_000): UnownedSector =>
  ({
    _id: new ObjectId(),
    stateId,
    countryId: "US" as CountryId,
    sectorType: sectorType as never,
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

  it("does not re-found a type the corp already runs, even when critical", () => {
    // logistics excluded by existingTypes → the override has nothing to pick and
    // the corp falls back to its own type.
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(["logistics"]),
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
