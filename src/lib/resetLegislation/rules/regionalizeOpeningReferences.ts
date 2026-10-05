/**
 * A country-level regional source crosswalk describes the legal lineage and
 * pooled 1991 cost. A region must see only its own allocated source share.
 */
import type { RegionalOpeningClaim } from "@/lib/resetFinance/rules/regionalOpeningAllocation";
import type { OpeningLawReference } from "../openingLaw";

export function regionalizeOpeningReferences(
  references: readonly OpeningLawReference[],
  allocatedClaims: readonly RegionalOpeningClaim[]
): OpeningLawReference[] {
  const claims = new Map<string, number>();
  for (const claim of allocatedClaims) {
    if (
      !claim.sourceId ||
      claims.has(claim.sourceId) ||
      !Number.isFinite(claim.annualBooked) ||
      claim.annualBooked < 0
    ) {
      throw new Error(`Invalid allocated regional source ${claim.sourceId}`);
    }
    claims.set(claim.sourceId, claim.annualBooked);
  }
  return references.map((reference) => ({
    ...reference,
    sourceComponents: reference.sourceComponents.map((component) => {
      if (component.annualBooked === 0) return { ...component };
      const regionalAmount = claims.get(component.sourceId);
      if (regionalAmount === undefined) {
        throw new Error(`No regional share for source ${component.sourceId}`);
      }
      return { ...component, annualBooked: regionalAmount };
    }),
  }));
}
