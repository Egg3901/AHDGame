import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeClearingFactors, type ClearingBookDiagnostic } from "@/lib/market/clearing";
import { sectorCountryForClearing } from "./sectorCountry";

describe("sectorCountryForClearing", () => {
  it("uses the host state's country when a persisted sector country is stale", () => {
    expect(
      sectorCountryForClearing({ stateId: "FR-IDF", countryId: "US" }, new Map([["FR-IDF", "FR"]]))
    ).toBe("FR");
  });

  it("falls back to the persisted country when the host state is unavailable", () => {
    expect(sectorCountryForClearing({ stateId: "MISSING", countryId: "BR" }, new Map())).toBe("BR");
  });

  it("keeps a stale country field from depressing fills in the wrong country book", () => {
    const sectorId = "fr-fertilizer-sector";
    const group = sectorCountryForClearing(
      { stateId: "FR-IDF", countryId: "US" },
      new Map([["FR-IDF", "FR"]])
    );
    const diagnostics: ClearingBookDiagnostic[] = [];
    const result = computeClearingFactors({
      sectors: [
        {
          sectorId,
          revenue: 100,
          supplyRates: { fertilizers: 1 },
          posture: 0,
          producedUnits: 1_000,
        },
      ],
      balances: new Map(),
      balancesByGroup: new Map([
        ["FR", new Map([["fertilizers", { supply: 1_000, demand: 600 }]])],
        ["US", new Map([["fertilizers", { supply: 1, demand: 0 }]])],
      ]),
      groupBySector: new Map([[sectorId, group]]),
      priceRatioByCommodity: new Map([["fertilizers", 1]]),
      basePrices: { fertilizers: 1 } as Record<CommodityType, number>,
      plantsEnabled: true,
      onBookDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ group: "FR", invariantBreach: false });
    expect(result.get(sectorId)?.soldFraction).toBeCloseTo(0.6, 10);
  });
});
