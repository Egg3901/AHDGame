import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Election } from "@/lib/db/types";
import { resolveGoverningPartyIds } from "@/lib/government/governingPartyIds";
import { isUKRegionalCouncilMidterm } from "@/lib/elections/ukRegionalCouncilStagger";

/** Modest nominal-share counterweight for parties outside national government. */
export const MIDTERM_OPPOSITION_MULTIPLIER = 1.05;

export function isMidtermOppositionBoostEligible(election: Election): boolean {
  return isUKRegionalCouncilMidterm({
    countryId: election.countryId,
    electionType: election.electionType,
    state: election.state,
    cycle: election.cycle,
  });
}

/**
 * Apply the boost to every party outside government, including independents.
 * Coalition and confidence partners resolved as governing parties remain
 * neutral. An unresolved/vacant government no-ops instead of boosting all.
 */
export function buildMidtermOppositionModifierByParty(
  governingPartyIds: ReadonlySet<string>,
  partyIdsInRace: ReadonlySet<string>
): Map<string, number> {
  const modifiers = new Map<string, number>();
  if (governingPartyIds.size === 0) return modifiers;
  for (const partyId of partyIdsInRace) {
    if (!governingPartyIds.has(partyId)) {
      modifiers.set(partyId, MIDTERM_OPPOSITION_MULTIPLIER);
    }
  }
  return modifiers;
}

export async function resolveMidtermOppositionModifierByParty(
  db: Db,
  countryId: CountryId,
  partyIdsInRace: ReadonlySet<string>
): Promise<Map<string, number>> {
  const governingPartyIds = await resolveGoverningPartyIds(db, countryId);
  return buildMidtermOppositionModifierByParty(governingPartyIds, partyIdsInRace);
}

export function midtermOppositionModifierToPct(
  modifier: ReadonlyMap<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [partyId, multiplier] of modifier) {
    out[partyId] = (multiplier - 1) * 100;
  }
  return out;
}
