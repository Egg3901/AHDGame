import { describe, expect, it } from "vitest";
import { SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT } from "./successorFiscal1991";

describe("1991 successor fiscal series", () => {
  it("records five IMF series and explicitly scoped RU/YU opening estimates", () => {
    expect(Object.keys(SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT).sort()).toEqual([
      "BG",
      "CS",
      "HU",
      "PL",
      "RO",
      "RU",
      "YU",
    ]);
    for (const [countryId, row] of Object.entries(SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT)) {
      expect(row.revenue, countryId).toBeGreaterThan(0);
      expect(row.expenditure, countryId).toBeGreaterThan(0);
      if (countryId !== "BG") {
        expect(row.revenue - row.expenditure, countryId).toBeCloseTo(row.reportedBalance);
      }
    }
  });
});
