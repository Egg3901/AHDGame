import { describe, expect, it } from "vitest";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { planLegacyMacroBudget } from "./legacyMacroBudget";

const country = {
  federationTreasuryMinor: 1000,
  fiscalCapacity: 0.5,
  stability: 0.8,
  sectors: { manufacturing: { capacity: 100, productivity: 1, domesticDemand: 80 } },
} as MacroCountryState;

describe("background successor protected budget", () => {
  it("collects bounded revenue from actual output and reserves services before debt calls", () => {
    expect(planLegacyMacroBudget(country)).toEqual({
      revenueMinor: 800,
      protectedSpendingMinor: 720,
      cashAfterProtectedSpendingMinor: 1080,
    });
  });

  it("does not create spendable cash from an invalid or empty economy", () => {
    expect(() => planLegacyMacroBudget({ ...country, sectors: {} })).toThrow("no fiscal output");
    expect(() => planLegacyMacroBudget({ ...country, federationTreasuryMinor: NaN })).toThrow(
      "invalid fiscal state"
    );
  });
});
