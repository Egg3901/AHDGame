/**
 * Reset law replacement compares an authored proposal with the actual 1991
 * source bundle. Unrelated laws, historical exclusions, and accrued claims
 * survive; a position label alone never repeals another statute.
 */
import type { OpeningLawReference } from "../openingLaw";

export interface OpeningComponent {
  id: string;
  historicalDisposition: "retained-legal-lineage" | "not-adopted-as-1991-law";
  fiscalOwnerFamilyId: string | null;
  annualBooked: number;
  replacementRestriction?: "protected-transfer";
}

export interface ReviewedOptionComponents {
  familyId: string;
  optionId: string;
  supersedes: readonly string[];
  /** Independently reviewed against country and era, not generated from ideology. */
  legalReview: "approved";
  annualAgencyAllocation: number;
  transitionLiability: number;
}

export interface ComponentDisposition {
  id: string;
  relation: "historical_exclusion" | "amend_or_replace" | "preserve";
  fiscalOwnerFamilyId: string | null;
  annualBooked: number;
}

export interface ComponentBundleComparison {
  familyId: string;
  optionId: string;
  currentAnnualAllocation: number;
  /** Existing same-family cost actually displaced by this proposal. */
  supersededAnnualAllocation: number;
  /** Existing same-family cost that the proposal leaves in force. */
  retainedAnnualAllocation: number;
  /** New authority in the proposed bill, before adding retained claims. */
  newAgencyAllocation: number;
  /** Entire same-family allocation after enactment, including retained claims. */
  proposedAnnualAllocation: number;
  annualAllocationDelta: number;
  carriedLiability: number;
  components: readonly ComponentDisposition[];
}

function amount(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and nonnegative`);
  }
  return value;
}

export function compareReviewedComponentBundle(
  opening: readonly OpeningComponent[],
  proposal: ReviewedOptionComponents
): ComponentBundleComparison {
  if (!proposal.familyId || !proposal.optionId || proposal.legalReview !== "approved") {
    throw new Error("option requires an approved country-and-era legal review");
  }
  amount(proposal.annualAgencyAllocation, "annualAgencyAllocation");
  amount(proposal.transitionLiability, "transitionLiability");
  const ids = new Set<string>();
  for (const component of opening) {
    if (!component.id || ids.has(component.id)) {
      throw new Error(`duplicate or empty opening component ${component.id}`);
    }
    ids.add(component.id);
    amount(component.annualBooked, `${component.id}.annualBooked`);
  }
  const supersedes = new Set<string>();
  for (const id of proposal.supersedes) {
    if (supersedes.has(id)) throw new Error(`duplicate supersession ${id}`);
    if (!ids.has(id)) throw new Error(`unknown supersession ${id}`);
    const source = opening.find((component) => component.id === id)!;
    if (source.historicalDisposition === "not-adopted-as-1991-law") {
      throw new Error(`historically excluded component cannot be superseded: ${id}`);
    }
    if (source.replacementRestriction === "protected-transfer") {
      throw new Error(`protected transfer cannot be superseded by this law option: ${id}`);
    }
    supersedes.add(id);
  }
  const components = opening.map((component): ComponentDisposition => ({
    id: component.id,
    relation:
      component.historicalDisposition === "not-adopted-as-1991-law"
        ? "historical_exclusion"
        : supersedes.has(component.id)
          ? "amend_or_replace"
          : "preserve",
    fiscalOwnerFamilyId: component.fiscalOwnerFamilyId,
    annualBooked: component.annualBooked,
  }));
  const currentAnnualAllocation = opening.reduce(
    (sum, component) =>
      sum +
      (component.historicalDisposition !== "not-adopted-as-1991-law" &&
      component.fiscalOwnerFamilyId === proposal.familyId
        ? component.annualBooked
        : 0),
    0
  );
  const supersededAnnualAllocation = opening.reduce(
    (sum, component) =>
      sum +
      (component.historicalDisposition !== "not-adopted-as-1991-law" &&
      component.fiscalOwnerFamilyId === proposal.familyId &&
      supersedes.has(component.id)
        ? component.annualBooked
        : 0),
    0
  );
  const retainedAnnualAllocation = currentAnnualAllocation - supersededAnnualAllocation;
  const proposedAnnualAllocation = retainedAnnualAllocation + proposal.annualAgencyAllocation;
  return {
    familyId: proposal.familyId,
    optionId: proposal.optionId,
    currentAnnualAllocation,
    supersededAnnualAllocation,
    retainedAnnualAllocation,
    newAgencyAllocation: proposal.annualAgencyAllocation,
    proposedAnnualAllocation,
    annualAllocationDelta: proposal.annualAgencyAllocation - supersededAnnualAllocation,
    carriedLiability: proposal.transitionLiability,
    components,
  };
}

/** Convert the source crosswalk without charging legal-lineage-only records. */
export function compareOpeningLawReference(
  reference: OpeningLawReference,
  proposal: ReviewedOptionComponents
): ComponentBundleComparison {
  if (reference.familyId !== proposal.familyId) {
    throw new Error("proposal and current-law reference belong to different families");
  }
  const opening: OpeningComponent[] = reference.sourceComponents.map((component) => {
    if (
      component.historicalDisposition !== "retained-legal-lineage" &&
      component.historicalDisposition !== "not-adopted-as-1991-law"
    ) {
      throw new Error(`unknown historical disposition ${component.sourceId}`);
    }
    return {
      id: component.sourceId,
      historicalDisposition: component.historicalDisposition,
      fiscalOwnerFamilyId:
        component.fiscalRole === "single-booked-owner" ? component.fiscalOwner : null,
      annualBooked: component.annualBooked,
      ...(component.replacementRestriction
        ? { replacementRestriction: component.replacementRestriction }
        : {}),
    };
  });
  return compareReviewedComponentBundle(opening, proposal);
}
