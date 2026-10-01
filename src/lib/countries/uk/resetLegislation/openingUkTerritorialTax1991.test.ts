import { describe, expect, it } from "vitest";
import { buildUkTerritorialTaxOpenings1991 } from "./openingUkTerritorialTax1991";
import { ukTerritorialTaxOpening1991 } from "./ukTerritorialTax1991";

describe("1991 UK local-tax legal fixture", () => {
  it("identifies GB community charge and NI domestic rates without inventing a rate", () => {
    const openings = buildUkTerritorialTaxOpenings1991();
    expect(openings).toHaveLength(12);
    expect(openings.filter((row) => row.domestic === "community_charge")).toHaveLength(11);
    expect(openings.find((row) => row.regionId === "NIR")?.domestic).toBe("domestic_rates");
    expect(openings.every((row) => row.business === "non_domestic_rates")).toBe(true);
    expect(openings.every((row) => !row.domesticRateKnown && !row.businessRateKnown)).toBe(true);
    expect(openings.every((row) => row.sourceOwnRevenueProxy > 0)).toBe(true);
  });

  it("preserves the combined seed own-revenue proxy without relabeling it as tax receipts", () => {
    const opening = ukTerritorialTaxOpening1991({
      regionId: "LON",
      propertyTaxProxy: 100,
      domesticCorporateTaxProxy: 20,
      foreignCorporateTaxProxy: 5,
    });
    expect(opening.sourceOwnRevenueProxy).toBe(125);
    expect(opening.estimateKind).toBe("game-calibrated-unallocated-own-revenue");
  });

  it("rejects unknown regions and invalid amounts", () => {
    const input = {
      regionId: "LON",
      propertyTaxProxy: 1,
      domesticCorporateTaxProxy: 1,
      foreignCorporateTaxProxy: 1,
    };
    expect(() => ukTerritorialTaxOpening1991({ ...input, regionId: "BAD" })).toThrow();
    expect(() => ukTerritorialTaxOpening1991({ ...input, propertyTaxProxy: -1 })).toThrow();
  });
});
