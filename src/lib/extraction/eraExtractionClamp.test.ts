import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  COMMODITY_BASE_PRICES,
  eraScaledBasePrices,
  extractionOutputScaleFor,
} from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import {
  computeExtractionCapacityMultipliers,
  type ExtractionSectorInput,
} from "@/lib/turn/extraction/extractionCapacity";
import { haircutScarcityRelief, scarcityReliefCappedUtilization } from "./capacityHaircut";

/**
 * The corp-phase extraction clamp must ration against the SAME desired-output
 * figure the world supply ledger books (revenue x rate x per-resource output
 * scale, over the ERA base-price table). These tests pin the end-to-end chain
 * on a 1953-era world: corrected output -> capacity multiplier -> scarcity
 * relief, where relief may never book past the state's physical ceiling.
 */

const ERA_UNIT_SCALE = getEraUnitScale("1953-default");
const ERA_BASE_PRICES = eraScaledBasePrices(ERA_UNIT_SCALE);

const REVENUE = 500_000;
const IRON_RATE = 0.4;
const CORP = new ObjectId();

function correctedDesiredOutput(resource: ExtractableResource, enabled: boolean): number {
  return (
    (REVENUE * IRON_RATE * extractionOutputScaleFor(resource, enabled)) / ERA_BASE_PRICES[resource]
  );
}

/** Legacy (pre-fix) figure: revenue x rate over the modern table, no scaling. */
function legacyDesiredOutput(resource: ExtractableResource): number {
  return (REVENUE * IRON_RATE) / COMMODITY_BASE_PRICES[resource];
}

function makeCapacity(
  stateId: string,
  resources: Partial<Record<ExtractableResource, number>>
): StateResourceCapacity {
  return {
    _id: new ObjectId(),
    stateId,
    countryId: "US",
    resources,
    updatedAt: new Date(),
  };
}

function makeSector(output: Partial<Record<ExtractableResource, number>>): ExtractionSectorInput {
  return { sectorId: "s1", stateId: "st1", corporationId: CORP, revenueBasedOutput: output };
}

describe("1953 extraction clamp against corrected output", () => {
  it("a sector whose corrected desired output is 10x state capacity is clamped near 0.1 even in global shortage", () => {
    const desired = correctedDesiredOutput("iron", true);
    const capacities = [makeCapacity("st1", { iron: desired / 10 })];
    const sectors = [makeSector({ iron: desired })];

    const multipliers = computeExtractionCapacityMultipliers(sectors, [], capacities);
    const mult = multipliers.get("s1")?.iron ?? 0;
    expect(mult).toBeCloseTo(0.1, 10);

    // Global shortage: s/d = 0.4 <= 0.5, full relief.
    const relief = haircutScarcityRelief(40, 100);
    expect(relief).toBe(1);

    const rates = { iron: IRON_RATE };

    // Relief cannot book past what the deposits can yield.
    const capped = scarcityReliefCappedUtilization(
      rates,
      { iron: mult },
      { iron: relief },
      { iron: desired }
    );
    expect(capped.utilization).toBeCloseTo(0.1, 10);
    expect(capped.bindingResource).toBe("iron");
  });

  it("corrects the clamp basis by the era price ratio times the output scale", () => {
    const desired = correctedDesiredOutput("iron", true);
    // The legacy figure the old clamp rationed against was far smaller than
    // what the ledger books on this world.
    expect(desired).toBeGreaterThan(70 * legacyDesiredOutput("iron"));
    // Exactly era scale x per-resource scale.
    const ratio = desired / legacyDesiredOutput("iron");
    expect(ratio).toBeCloseTo(ERA_UNIT_SCALE * extractionOutputScaleFor("iron", true), 6);
  });

  it("keeps the unscaled modern-table basis on modern worlds with the flag off", () => {
    const modernPrices = eraScaledBasePrices(1);
    expect(modernPrices).toBe(COMMODITY_BASE_PRICES);
    const modernDesired =
      (REVENUE * IRON_RATE * extractionOutputScaleFor("iron", false)) / modernPrices.iron;
    expect(modernDesired).toBeCloseTo(legacyDesiredOutput("iron"), 10);

    // Ample capacity: nothing binds, relief or not.
    const capacities = [makeCapacity("st1", { iron: modernDesired * 2 })];
    const multipliers = computeExtractionCapacityMultipliers(
      [makeSector({ iron: modernDesired })],
      [],
      capacities
    );
    const capped = scarcityReliefCappedUtilization(
      { iron: IRON_RATE },
      multipliers.get("s1"),
      { iron: 1 },
      { iron: modernDesired }
    );
    expect(capped.utilization).toBe(1);
    expect(capped.bindingResource).toBeNull();
  });

  it("still grants full relief when desired output sits within the deposit ceiling", () => {
    const desired = correctedDesiredOutput("oil", true);
    const capacities = [makeCapacity("st1", { oil: desired * 4 })];
    const multipliers = computeExtractionCapacityMultipliers(
      [makeSector({ oil: desired })],
      [],
      capacities
    );
    const mult = multipliers.get("s1")?.oil ?? 0;
    expect(mult).toBe(1);

    const capped = scarcityReliefCappedUtilization(
      { oil: IRON_RATE },
      { oil: mult },
      { oil: haircutScarcityRelief(30, 100) },
      { oil: desired }
    );
    expect(capped.utilization).toBe(1);
    expect(capped.bindingResource).toBeNull();
  });

  it("caps at the unit-weighted raw capacity ratio, not the bare rate mix", () => {
    // Iron leg physically clamped to 0.1 and in shortage; coal leg free.
    // The corrected units are overwhelmingly iron, so the physical ratio wins
    // even though full scarcity relief applies to that leg.
    const capped = scarcityReliefCappedUtilization(
      { iron: 0.4, coal: 0.6 },
      { iron: 0.1, coal: 1 },
      { iron: 1 },
      { iron: 1000, coal: 10 }
    );
    expect(capped.utilization).toBeCloseTo((1000 * 0.1 + 10 * 1) / 1010, 10);
    expect(capped.bindingResource).toBe("iron");
  });
});
