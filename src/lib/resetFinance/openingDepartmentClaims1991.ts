import { resetLawFamilies } from "@/lib/resetLegislation/catalog";
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
    IE: new Set<string>(),
  };
  return Object.fromEntries(
    (["US", "UK", "JP", "IE"] as const).map((country) => {
      const book = ownership[country];
      const nationalFamilies = resetLawFamilies.filter((family) =>
        family.availability.national.includes(country)
      );
      const knownFamilyIds = new Set(nationalFamilies.map((family) => family.id));
      const unknownFundedFamily = Object.entries(book.familyTotals).find(
        ([familyId, annualAmount]) => annualAmount !== 0 && !knownFamilyIds.has(familyId)
      )?.[0];
      if (unknownFundedFamily) {
        throw new Error(`${country} has an unknown funded law family ${unknownFundedFamily}`);
      }
      // Every enactable national family needs a destination account even when
      // its 1991 opening claim is zero. Later bills cannot fund a department
      // that the opening partition omitted merely because the baseline law was
      // regulatory rather than a separately booked appropriation.
      const claims = nationalFamilies.map((family) => ({
        familyId: family.id,
        seatId: fundingSeatForLaw(family, country, historicalSeats[country]),
        agencyName: fundingNameForLaw1991(family, country, historicalSeats[country]),
        annualAmount: book.familyTotals[family.id] ?? 0,
      }));
      return [country, groupOpeningDepartmentClaims(book.operating, claims, book.continuityOwned)];
    })
  ) as Record<"US" | "UK" | "JP" | "IE", ReturnType<typeof groupOpeningDepartmentClaims>>;
}
