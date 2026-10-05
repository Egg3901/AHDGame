import { describe, expect, it } from "vitest";
import { openingRegionalFiscalOwnership1991 } from "./openingRegionalOwnership1991";
import { allocateRegionalOpeningClaims } from "./rules/regionalOpeningAllocation";

describe("1991 regional fiscal ownership", () => {
  it("accounts for all 71 regions without inventing a regional Cabinet treasury", () => {
    const books = openingRegionalFiscalOwnership1991();
    expect(books.US.regions).toHaveLength(51);
    expect(books.UK.regions).toHaveLength(12);
    expect(books.JP.regions).toHaveLength(8);
    expect(books.US.familyOwned).toBeCloseTo(474_041_960_700, 1);
    expect(books.UK.familyOwned).toBe(27_590_760_000);
    expect(books.JP.familyOwned).toBe(12_091_170_000_000);
    for (const country of ["US", "UK", "JP"] as const) {
      const book = books[country];
      expect(book.familyOwned + book.otherExistingServices).toBeCloseTo(book.annualSpending, 1);
      for (const region of book.regions) {
        expect(region.familyOwned + region.otherExistingServices).toBeCloseTo(
          region.annualSpending,
          1
        );
        expect(region.otherExistingServices).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects duplicate sources, impossible claims and invalid region envelopes", () => {
    const regions = [{ regionId: "A", annualSpending: 100 }];
    const claim = { sourceId: "law", familyId: "L19", annualBooked: 30 };
    expect(() => allocateRegionalOpeningClaims(regions, [claim, claim])).toThrow(/duplicate/);
    expect(() => allocateRegionalOpeningClaims(regions, [{ ...claim, annualBooked: 101 }])).toThrow(
      /exceed/
    );
    expect(() => allocateRegionalOpeningClaims([...regions, ...regions], [claim])).toThrow(
      /duplicate/
    );
  });
});
