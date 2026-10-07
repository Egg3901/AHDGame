import { resolveCanvassGroup } from "./countryDemographics";
import { resolvePartyTurnoutTarget } from "./turnoutTargets";

export interface PartyTurnoutTargetLean {
  economicLean: number;
  socialLean: number;
}

/**
 * Resolve a party GOTV or suppression target without ambient state.
 *
 * New budgets use Layer-1 census buckets. Targets the older catalog already
 * understood, including the US census groups, keep their established lean so
 * this display expansion does not rebalance them. The Layer-1 resolver adds
 * the international buckets that were previously unavailable.
 */
export function resolvePartyTurnoutTargetLean(
  countryId: string,
  category: string,
  group: string,
  preset?: string | null
): PartyTurnoutTargetLean | null {
  return (
    resolveCanvassGroup(countryId, category, group) ??
    resolvePartyTurnoutTarget(countryId, category, group, preset)
  );
}

export function isValidPartyTurnoutTarget(
  countryId: string,
  category: string,
  group: string,
  preset?: string | null
): boolean {
  return resolvePartyTurnoutTargetLean(countryId, category, group, preset) !== null;
}
