/**
 * Reset legislative proposal authority. A descriptive catalog card is not a
 * purchasable law until legal scope, price, delivery, and outcome are reviewed.
 */
import type { LawFamilyDefinition } from "../catalog";
import type { ResetCountry } from "../fundingOwner";
import type { OpeningLawReference } from "../openingLaw";
import { compareOpeningLawReference } from "./componentBundle";
import type { LawChoice, LawScope } from "./eligibility";
import { lawChoiceEligibility } from "./eligibility";

export interface ReviewedLawOption {
  familyId: string;
  country: ResetCountry;
  scope: LawScope;
  choice: LawChoice;
  effectiveFromYear: number;
  legalAuthorityId: string;
  fundingAccountId: string;
  serviceDelivererId: string;
  annualAllocation: number;
  accruedTransitionLiability: number;
  supersedesSourceIds: readonly string[];
  review: {
    legal: "approved";
    fiscal: "approved";
    outcome: "approved";
  };
}

export type ReviewedOptionBlock =
  "unavailable" | "unreviewed" | "era" | "authority" | "allocation" | "source_conflict";

export function reviewedOptionEligibility(input: {
  family: LawFamilyDefinition;
  option: ReviewedLawOption | null;
  country: ResetCountry;
  scope: LawScope;
  choice: LawChoice;
  currentChoice: LawChoice | null;
  year: number;
  openingReference: OpeningLawReference;
}): { allowed: true } | { allowed: false; reason: ReviewedOptionBlock } {
  const base = lawChoiceEligibility(
    input.family,
    input.country,
    input.scope,
    input.choice,
    input.currentChoice
  );
  if (!base.allowed) return { allowed: false, reason: "unavailable" };
  const option = input.option;
  if (
    !option ||
    option.familyId !== input.family.id ||
    option.country !== input.country ||
    option.scope !== input.scope ||
    option.choice !== input.choice ||
    option.review?.legal !== "approved" ||
    option.review?.fiscal !== "approved" ||
    option.review?.outcome !== "approved"
  ) {
    return { allowed: false, reason: "unreviewed" };
  }
  if (
    !Number.isInteger(input.year) ||
    !Number.isInteger(option.effectiveFromYear) ||
    option.effectiveFromYear < 1991 ||
    input.year < option.effectiveFromYear
  ) {
    return { allowed: false, reason: "era" };
  }
  if (
    typeof option.legalAuthorityId !== "string" ||
    !option.legalAuthorityId.trim() ||
    typeof option.fundingAccountId !== "string" ||
    !option.fundingAccountId.trim() ||
    typeof option.serviceDelivererId !== "string" ||
    !option.serviceDelivererId.trim() ||
    (input.scope === "regional" && option.fundingAccountId !== "regional_budget") ||
    (input.scope === "national" && option.fundingAccountId === "regional_budget")
  ) {
    return { allowed: false, reason: "authority" };
  }
  if (
    !Number.isSafeInteger(option.annualAllocation) ||
    option.annualAllocation < 0 ||
    !Number.isSafeInteger(option.accruedTransitionLiability) ||
    option.accruedTransitionLiability < 0 ||
    (input.choice === "leave_to_states" && option.annualAllocation !== 0)
  ) {
    return { allowed: false, reason: "allocation" };
  }
  if (
    input.openingReference.key !== `${input.country}:${input.scope}:${input.family.id}` ||
    input.openingReference.country !== input.country ||
    input.openingReference.scope !== input.scope ||
    input.openingReference.familyId !== input.family.id
  ) {
    return { allowed: false, reason: "source_conflict" };
  }
  // A legal-lineage reference may point to another family's booked program.
  // Replacing that statute needs an explicit cross-family fiscal transition,
  // which this single-family option cannot express or safely price.
  if (
    option.supersedesSourceIds.some((id) => {
      const source = input.openingReference.sourceComponents.find(
        (component) => component.sourceId === id
      );
      return (
        source &&
        source.annualBooked > 0 &&
        source.fiscalOwner !== null &&
        source.fiscalOwner !== input.family.id
      );
    })
  ) {
    return { allowed: false, reason: "source_conflict" };
  }
  try {
    compareOpeningLawReference(input.openingReference, {
      familyId: option.familyId,
      optionId: `${option.country}:${option.scope}:${option.familyId}:${option.choice}`,
      supersedes: option.supersedesSourceIds,
      legalReview: option.review.legal,
      annualAgencyAllocation: option.annualAllocation,
      transitionLiability: option.accruedTransitionLiability,
    });
  } catch {
    return { allowed: false, reason: "source_conflict" };
  }
  return { allowed: true };
}
