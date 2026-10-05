import { describe, expect, it } from "vitest";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { openingPlantScenario } from "./openingBalance";

describe("1991 starter plants", () => {
  it.each([4, 4.5, 3])(
    "prices every default sector near revenue and leaves an operating cushion at %s%% prime",
    (prime) => {
      for (const type of CORPORATION_TYPES) {
        const balanced = openingPlantScenario(type, prime);
        const stress = openingPlantScenario(type, prime, true);
        expect(balanced.priceRevenueRatio, type).toBeGreaterThanOrEqual(1);
        expect(balanced.priceRevenueRatio, type).toBeLessThanOrEqual(1.8);
        expect(balanced.marginPercent, type).toBeGreaterThanOrEqual(12);
        expect(stress.dailyProfit, type).toBeGreaterThan(0);
      }
    }
  );
});
