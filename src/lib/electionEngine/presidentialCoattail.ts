/**
 * Presidential coattail for down-ballot generals.
 *
 * Mirrors the governor coattail (`govCoattail.ts`) at national scope: the
 * sitting President's party gets an approval-driven nominal-share multiplier
 * (`1 + swing × COATTAIL_MAX_BONUS`, the same constants the governor uses) in
 * every down-ballot general nationwide. Sourced from the *sitting* President
 * (party + stored national approval), not the live presidential race tally.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { BASE_APPROVAL } from "@/lib/utils/governmentApproval";
import { approvalCoattailMultiplier, coattailMultiplierMapToPct } from "./coattailMagnitude";

/**
 * The election type that is the head-of-government race per country.
 * Presidential coattails are currently US-only; non-US heads of government
 * (UK PM, DE chancellor, JP shugiin) remain out of scope.
 */
const HEAD_OF_GOVERNMENT_TYPE_BY_COUNTRY: Readonly<Partial<Record<CountryId, string>>> = {
  US: "president",
};

/**
 * True when the given election type is the head-of-government race for the
 * country — used to skip the coattail lookup for the presidential race itself
 * (you don't get coattails from your own race).
 */
export function isHeadOfGovernmentRace(electionType: string, countryId: CountryId): boolean {
  return HEAD_OF_GOVERNMENT_TYPE_BY_COUNTRY[countryId] === electionType;
}

/**
 * Resolve the sitting President's party and the country's national approval.
 * Party comes from `electedOfficials` (most recent by `electedAt`); approval
 * is the stored population-weighted national rating from `governmentApprovals`
 * (defaults to BASE_APPROVAL → neutral 1.0× when the doc is missing).
 *
 * Returns null when the country has no presidential head-of-government office,
 * or the presidency is vacant / has no party.
 */
export async function resolvePresidentApproval(
  db: Db,
  countryId: CountryId
): Promise<{ partyId: string; approval: number } | null> {
  const headType = HEAD_OF_GOVERNMENT_TYPE_BY_COUNTRY[countryId];
  if (!headType) return null;

  const official = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ countryId, officeType: headType }, { sort: { electedAt: -1 } });
  if (!official?.party) return null;

  const approvalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: countryId });
  const approval = approvalDoc?.approvalRating ?? BASE_APPROVAL;

  return { partyId: official.party, approval };
}

/**
 * Build the per-party presidential-coattail multiplier map. Only the
 * President's party gets an entry, and only when that party is actually
 * present in the race (a stale party value silently no-ops to neutral).
 */
export function buildPresidentialModifierByParty(
  president: { partyId: string; approval: number } | null,
  partyIdsInRace: Set<string>
): Map<string, number> {
  const map = new Map<string, number>();
  if (!president) return map;
  if (!partyIdsInRace.has(president.partyId)) return map;
  map.set(president.partyId, approvalCoattailMultiplier(president.approval));
  return map;
}

/**
 * Convert a presidential modifier multiplier map into signed percentage tilts
 * for display (e.g. 1.09 → +9). Pure; used by the persuasion-drivers card.
 */
export function presidentialModifierToPct(modifier: Map<string, number>): Record<string, number> {
  return coattailMultiplierMapToPct(modifier);
}
