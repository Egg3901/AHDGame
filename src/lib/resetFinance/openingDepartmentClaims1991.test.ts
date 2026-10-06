import { describe, expect, it } from "vitest";
import { openingDepartmentClaims1991 } from "./openingDepartmentClaims1991";
import { openingFiscalOwnership1991 } from "./openingOwnership1991";
import { groupOpeningDepartmentClaims } from "./rules/departmentOpening";
import { resetLawFamilies } from "@/lib/resetLegislation/catalog";
import { fundingSeatForLaw } from "@/lib/resetLegislation/fundingOwner";

describe("1991 department funding ownership", () => {
  it("reconciles family claims and continuity without double-booking", () => {
    const grouped = openingDepartmentClaims1991();
    const books = openingFiscalOwnership1991();
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      const familyAllocated = grouped[country].accounts.reduce(
        (sum, account) => sum + account.annualAllocation,
        0
      );
      expect(familyAllocated).toBeCloseTo(books[country].familyOwned, 2);
      expect(familyAllocated + grouped[country].continuityAmount).toBeCloseTo(
        books[country].operating,
        2
      );
      expect(new Set(grouped[country].accounts.map((account) => account.key)).size).toBe(
        grouped[country].accounts.length
      );
    }
    expect(
      grouped.US.accounts.find((account) => account.familyAllocations.L19 !== undefined)?.seatId
    ).toBe("secretary_of_health");
    expect(
      grouped.US.accounts.find((account) => account.familyAllocations.L10 !== undefined)
    ).toMatchObject({
      seatId: "secretary_of_education",
      agencyName: "U.S. Department of Education",
    });
    expect(
      grouped.US.accounts.find((account) => account.familyAllocations.L19 !== undefined)?.agencyName
    ).toBe("U.S. Department of Health and Human Services");
  });

  it("creates an account for every national law owner even when its opening claim is zero", () => {
    const grouped = openingDepartmentClaims1991();
    const historicalSeats = {
      US: new Set(["secretary_of_education"]),
      UK: new Set<string>(),
      JP: new Set<string>(),
      IE: new Set<string>(),
    };
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      const accountSeats = new Set(grouped[country].accounts.map((account) => account.seatId));
      for (const family of resetLawFamilies.filter((candidate) =>
        candidate.availability.national.includes(country)
      )) {
        expect(accountSeats, `${country}:${family.id}`).toContain(
          fundingSeatForLaw(family, country, historicalSeats[country])
        );
      }
    }
    expect(
      grouped.US.accounts.find((account) => account.familyAllocations.L04 !== undefined)
    ).toMatchObject({
      seatId: "secretary_of_labor",
      agencyName: "U.S. Department of Labor",
    });
  });

  it("rejects duplicate family assignment or an unallocated operating gap", () => {
    const claim = {
      familyId: "L01",
      seatId: "treasury",
      agencyName: "Treasury",
      annualAmount: 10,
    };
    expect(() => groupOpeningDepartmentClaims(20, [claim, claim], 0)).toThrow("Invalid");
    expect(() => groupOpeningDepartmentClaims(20, [claim], 0)).toThrow("do not reconcile");
  });
});
