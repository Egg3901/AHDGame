import type { LegislationPolicyOption, LegislationType } from "@/lib/db/types";

/** Provision fields this resolver reads. Both bill shapes satisfy it. */
export interface ResolvableProvision {
  policyOptionId?: string;
  effectDirection: number;
  economic?: number;
  social?: number;
}

/**
 * Tax-slider provisions carry a synthetic "rate:<value>" id that matches no
 * seeded option. Detecting it up front stops the axis and direction fallbacks
 * from resolving a slider provision to an unrelated option — a provision with no
 * economic/social reads as 0/0, which matches whichever option sits at the
 * centre of the ladder.
 */
function isSyntheticRateId(id?: string): boolean {
  return typeof id === "string" && id.startsWith("rate:");
}

/**
 * The single implementation, replacing verbatim copies previously in
 * `congress/billEnrichment.ts` and `congress/billProposal.ts`.
 */
export function resolveProvisionPolicyOption(
  lt: LegislationType | null | undefined,
  provision: ResolvableProvision
): { option: LegislationPolicyOption; index: number } | null {
  if (!lt?.policyOptions?.length) return null;
  if (isSyntheticRateId(provision.policyOptionId)) return null;

  if (provision.policyOptionId) {
    const index = lt.policyOptions.findIndex((opt) => opt.id === provision.policyOptionId);
    if (index !== -1) return { option: lt.policyOptions[index], index };
  }

  // The axis match runs only when the provision actually carries an axis. Within
  // it a missing axis resolves as 0, so legacy provisions (which stamped a
  // literal 0) and new ones (which omit the field) land on the same option.
  //
  // The guard matters: without it, a provision carrying NO axes matches the 0/0
  // option — the centre of the ladder — regardless of its direction. The two
  // pre-merge copies disagreed here (billEnrichment guarded, billProposal did
  // not); the guarded behaviour is the correct one and is what the merge keeps.
  const hasExplicitAxes = provision.economic != null || provision.social != null;
  if (hasExplicitAxes) {
    const axisIndex = lt.policyOptions.findIndex(
      (opt) =>
        (opt.economic ?? 0) === (provision.economic ?? 0) &&
        (opt.social ?? 0) === (provision.social ?? 0)
    );
    if (axisIndex !== -1) return { option: lt.policyOptions[axisIndex], index: axisIndex };
  }

  const directionMatches = lt.policyOptions
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => option.effectDirection === provision.effectDirection);
  return directionMatches.length === 1 ? directionMatches[0] : null;
}
