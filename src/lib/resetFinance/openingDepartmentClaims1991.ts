import { resetLawFamilyById } from "@/lib/resetLegislation/catalog";
import { fundingNameForLaw1991, fundingSeatForLaw } from "@/lib/resetLegislation/fundingOwner";
import { openingFiscalOwnership1991 } from "./openingOwnership1991";
import { groupOpeningDepartmentClaims } from "./rules/departmentOpening";

/** Opening department buckets only; continuity obligations remain separately booked. */
export function openingDepartmentClaims1991() {
  const ownership = openingFiscalOwnership1991();
  // The live alternate-history roster can leave Education uncreated in 1991.
  // The reset's historical opening treats the department as established in
  // May 1980 without changing a running v1 world's Cabinet configuration.
  // Source: https://www.ed.gov/about/ed-overview/overview-of-us-department-of-education-history-and-purpose
  const historicalSeats = {
    US: new Set(["secretary_of_education"]),
    UK: new Set<string>(),
    JP: new Set<string>(),
  };
  return Object.fromEntries(
    (["US", "UK", "JP"] as const).map((country) => {
      const book = ownership[country];
      const claims = Object.entries(book.familyTotals).flatMap(([familyId, annualAmount]) => {
        if (annualAmount === 0) return [];
        const family = resetLawFamilyById(familyId);
        if (!family) throw new Error(`${country} has an unknown funded law family ${familyId}`);
        return [
          {
            familyId,
            seatId: fundingSeatForLaw(family, country, historicalSeats[country]),
            agencyName: fundingNameForLaw1991(family, country, historicalSeats[country]),
            annualAmount,
          },
        ];
      });
      return [country, groupOpeningDepartmentClaims(book.operating, claims, book.continuityOwned)];
    })
  ) as Record<"US" | "UK" | "JP", ReturnType<typeof groupOpeningDepartmentClaims>>;
}
