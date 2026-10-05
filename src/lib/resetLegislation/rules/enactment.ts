/**
 * Portable replacement of one reviewed v2 law family. A new option replaces
 * its preceding v2 program, but never erases a 1991 source obligation unless
 * that specific component is explicitly superseded.
 */
import type { LawFamilyDefinition } from "../catalog";
import type { OpeningLawReference } from "../openingLaw";
import type { ReviewedLawOption } from "./reviewedOption";
import { reviewedOptionEligibility } from "./reviewedOption";
import { compareOpeningLawReference } from "./componentBundle";

export interface EnactedResetLawProgram {
  country: ReviewedLawOption["country"];
  scope: ReviewedLawOption["scope"];
  familyId: string;
  choice: ReviewedLawOption["choice"];
  annualAgencyAllocation: number;
  supersededSourceIds: readonly string[];
  effectiveTurn: number;
  legalAuthorityId: string;
  fundingAccountId: string;
  serviceDelivererId: string;
}

export interface ResetLawEnactment {
  previousAnnualAllocation: number;
  nextAnnualAllocation: number;
  annualAllocationDelta: number;
  /** A separate accrued claim. It is never folded into the annual delta. */
  transitionClaim: number;
  program: EnactedResetLawProgram;
}

function retainedSourceCost(
  reference: OpeningLawReference,
  familyId: string,
  superseded: ReadonlySet<string>
): number {
  return reference.sourceComponents.reduce(
    (sum, component) =>
      sum +
      (component.historicalDisposition === "retained-legal-lineage" &&
      component.fiscalRole === "single-booked-owner" &&
      component.fiscalOwner === familyId &&
      !superseded.has(component.sourceId)
        ? component.annualBooked
        : 0),
    0
  );
}

export function enactReviewedLawOption(input: {
  family: LawFamilyDefinition;
  reference: OpeningLawReference;
  option: ReviewedLawOption;
  current: EnactedResetLawProgram | null;
  openingChoice: ReviewedLawOption["choice"] | null;
  year: number;
  turn: number;
}): ResetLawEnactment {
  const { family, reference, option, current, openingChoice, year, turn } = input;
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("Invalid law enactment turn");
  if (
    current &&
    (current.familyId !== family.id ||
      current.country !== option.country ||
      current.scope !== option.scope ||
      !Number.isSafeInteger(current.effectiveTurn) ||
      current.effectiveTurn >= turn ||
      !Number.isSafeInteger(current.annualAgencyAllocation) ||
      current.annualAgencyAllocation < 0 ||
      !current.legalAuthorityId ||
      !current.fundingAccountId ||
      !current.serviceDelivererId ||
      (current.choice !== "leave_to_states" &&
        !family.levels.some((level) => level.position === current.choice)))
  ) {
    throw new Error("Current law program is invalid or already changed this turn");
  }
  const eligibility = reviewedOptionEligibility({
    family,
    option,
    country: option.country,
    scope: option.scope,
    choice: option.choice,
    currentChoice: current?.choice ?? openingChoice,
    year,
    openingReference: reference,
  });
  if (!eligibility.allowed) throw new Error(`Law option cannot be enacted: ${eligibility.reason}`);
  const proposedSuperseded = new Set(option.supersedesSourceIds);
  if (current) {
    const known = new Set(
      reference.sourceComponents
        .filter(
          (component) =>
            component.historicalDisposition === "retained-legal-lineage" &&
            component.replacementRestriction !== "protected-transfer"
        )
        .map((component) => component.sourceId)
    );
    if (
      new Set(current.supersededSourceIds).size !== current.supersededSourceIds.length ||
      current.supersededSourceIds.some((id) => !known.has(id))
    ) {
      throw new Error("Current law program has invalid source supersessions");
    }
  }
  if (current?.supersededSourceIds.some((id) => !proposedSuperseded.has(id))) {
    throw new Error("A replacement option cannot silently restore an earlier source law");
  }
  const comparison = compareOpeningLawReference(reference, {
    familyId: option.familyId,
    optionId: `${option.country}:${option.scope}:${option.familyId}:${option.choice}`,
    supersedes: option.supersedesSourceIds,
    legalReview: option.review.legal,
    annualAgencyAllocation: option.annualAllocation,
    transitionLiability: option.accruedTransitionLiability,
  });
  const previousAnnualAllocation =
    retainedSourceCost(reference, family.id, new Set(current?.supersededSourceIds ?? [])) +
    (current?.annualAgencyAllocation ?? 0);
  const nextAnnualAllocation = comparison.proposedAnnualAllocation;
  return {
    previousAnnualAllocation,
    nextAnnualAllocation,
    annualAllocationDelta: nextAnnualAllocation - previousAnnualAllocation,
    transitionClaim: option.accruedTransitionLiability,
    program: {
      country: option.country,
      scope: option.scope,
      familyId: option.familyId,
      choice: option.choice,
      annualAgencyAllocation: option.annualAllocation,
      supersededSourceIds: [...option.supersedesSourceIds],
      effectiveTurn: turn,
      legalAuthorityId: option.legalAuthorityId,
      fundingAccountId: option.fundingAccountId,
      serviceDelivererId: option.serviceDelivererId,
    },
  };
}
