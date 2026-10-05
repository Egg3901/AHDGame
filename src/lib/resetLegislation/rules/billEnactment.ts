/**
 * Portable all-or-nothing review of a v2 bill's law-family transitions.
 * The shell must persist all resulting programs and fiscal changes together.
 */
import type { LawFamilyDefinition } from "../catalog";
import type { OpeningLawReference } from "../openingLaw";
import type { EnactedResetLawProgram, ResetLawEnactment } from "./enactment";
import { enactReviewedLawOption } from "./enactment";
import type { LawChoice } from "./eligibility";
import type { ReviewedLawOption } from "./reviewedOption";

export interface ReviewedBillProvision {
  family: LawFamilyDefinition;
  reference: OpeningLawReference;
  option: ReviewedLawOption;
  openingChoice: LawChoice | null;
  /** Account carrying this family's booked 1991 source claim. */
  openingFundingAccountId: string;
}

export interface ResetBillEnactment {
  country: ReviewedLawOption["country"];
  scope: ReviewedLawOption["scope"];
  transitions: readonly ResetLawEnactment[];
  annualAllocationDelta: number;
  transitionClaim: number;
  fundingAccountDeltas: readonly { fundingAccountId: string; annualDelta: number }[];
}

export function enactReviewedBill(input: {
  provisions: readonly ReviewedBillProvision[];
  /** Complete active program set for this country's jurisdiction. */
  existingPrograms: readonly EnactedResetLawProgram[];
  year: number;
  turn: number;
}): ResetBillEnactment {
  const first = input.provisions[0];
  if (!first) throw new Error("A v2 bill needs at least one provision");
  const country = first.option.country;
  const scope = first.option.scope;
  const activeByFamily = new Map<string, EnactedResetLawProgram>();
  const activeSourceOwner = new Map<string, string>();
  for (const program of input.existingPrograms) {
    if (
      program.country !== country ||
      program.scope !== scope ||
      activeByFamily.has(program.familyId)
    ) {
      throw new Error("Invalid active v2 law program set for bill jurisdiction");
    }
    activeByFamily.set(program.familyId, program);
    for (const id of program.supersededSourceIds) {
      if (activeSourceOwner.has(id)) throw new Error(`Source ${id} is already superseded twice`);
      activeSourceOwner.set(id, program.familyId);
    }
  }
  const familyIds = new Set<string>();
  const supersededIds = new Set<string>();
  const fundingDeltas = new Map<string, number>();
  const addFundingDelta = (account: string, delta: number): void => {
    fundingDeltas.set(account, (fundingDeltas.get(account) ?? 0) + delta);
  };
  const transitions: ResetLawEnactment[] = [];
  let annualAllocationDelta = 0;
  let transitionClaim = 0;
  for (const provision of input.provisions) {
    if (provision.option.country !== country || provision.option.scope !== scope) {
      throw new Error("A v2 bill cannot cross countries or jurisdictions");
    }
    if (familyIds.has(provision.family.id)) {
      throw new Error(`Duplicate v2 bill family ${provision.family.id}`);
    }
    if (
      !provision.openingFundingAccountId.trim() ||
      (scope === "regional" && provision.openingFundingAccountId !== "regional_budget")
    ) {
      throw new Error(`Invalid opening funding account for ${provision.family.id}`);
    }
    familyIds.add(provision.family.id);
    for (const id of provision.option.supersedesSourceIds) {
      const activeOwner = activeSourceOwner.get(id);
      if (activeOwner && activeOwner !== provision.family.id) {
        throw new Error(`Source ${id} is already superseded by ${activeOwner}`);
      }
      if (supersededIds.has(id)) {
        throw new Error(`A v2 bill cannot supersede source ${id} twice`);
      }
      supersededIds.add(id);
    }
    const current = activeByFamily.get(provision.family.id) ?? null;
    const transition = enactReviewedLawOption({
      ...provision,
      current,
      year: input.year,
      turn: input.turn,
    });
    transitions.push(transition);
    annualAllocationDelta += transition.annualAllocationDelta;
    transitionClaim += transition.transitionClaim;
    const newlySupersededOpeningCost =
      transition.previousAnnualAllocation -
      (current?.annualAgencyAllocation ?? 0) -
      (transition.nextAnnualAllocation - provision.option.annualAllocation);
    if (newlySupersededOpeningCost < -0.01) {
      throw new Error(`Invalid opening source reduction for ${provision.family.id}`);
    }
    addFundingDelta(provision.openingFundingAccountId, -newlySupersededOpeningCost);
    if (current) addFundingDelta(current.fundingAccountId, -current.annualAgencyAllocation);
    addFundingDelta(provision.option.fundingAccountId, provision.option.annualAllocation);
  }
  if (
    !Number.isFinite(annualAllocationDelta) ||
    Math.abs(annualAllocationDelta) > Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(transitionClaim)
  ) {
    throw new Error("V2 bill exceeds the supported fiscal amount range");
  }
  const accountTotal = [...fundingDeltas.values()].reduce((sum, value) => sum + value, 0);
  if (Math.abs(accountTotal - annualAllocationDelta) > 0.01) {
    throw new Error("V2 bill account changes do not reconcile");
  }
  return {
    country,
    scope,
    transitions,
    annualAllocationDelta,
    transitionClaim,
    fundingAccountDeltas: [...fundingDeltas]
      .filter(([, delta]) => Math.abs(delta) > 0.01)
      .map(([fundingAccountId, annualDelta]) => ({ fundingAccountId, annualDelta })),
  };
}
