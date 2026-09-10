import type { Db } from "mongodb";
import type { ExecutiveEndorsement } from "@/lib/db/types";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { withdrawExecutiveEndorsement } from "@/lib/governorOffice/endorsements/withdrawExecutiveEndorsement";
import { preloadEndorsementTargets } from "./endorsements/preloadEndorsementTargets";

/**
 * Turn phase: auto-withdraw executive endorsements whose conditions no longer hold.
 *   - election no longer active → election_ended
 *   - candidate no longer active → candidate_inactive
 *   - leader no longer the country's head of government (lost election, VONC,
 *     deleted character, etc.) → leader_left_office
 *
 * Parallel to processGovernorEndorsements. Must run BEFORE processCampaignTurn
 * so withdrawals are observed by the endorsement-count aggregation there.
 *
 * Reads are batched up front (#575): elections and candidates resolve from two
 * `$in` queries instead of one `findOne` each per endorsement. Writes stay
 * sequential — they only run for the withdrawing subset, which is small, and
 * `withdrawExecutiveEndorsement` owns the Support-bump reversal.
 */
export async function processExecutiveEndorsements(
  db: Db
): Promise<{ withdrawn: number; byReason: Record<string, number> }> {
  const active = await db
    .collection<ExecutiveEndorsement>("executiveEndorsements")
    .find({ isActive: true })
    .toArray();
  let withdrawn = 0;
  const byReason: Record<string, number> = {};
  function tally(reason: NonNullable<ExecutiveEndorsement["withdrawnReason"]>) {
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    withdrawn++;
  }

  const { electionStatus, candidateStatus } = await preloadEndorsementTargets(db, active);

  // Cache the leader check per (countryId, characterId) so a leader who
  // issued many endorsements only triggers one parliamentaryGovernments /
  // electedOfficials lookup, not one per endorsement.
  const leaderCache = new Map<string, boolean>();

  for (const e of active) {
    if (!e._id) continue;
    if (electionStatus.get(e.electionId.toString()) !== "active") {
      await withdrawExecutiveEndorsement(db, e._id, "election_ended");
      tally("election_ended");
      continue;
    }
    if (candidateStatus.get(e.candidateId.toString()) !== "active") {
      await withdrawExecutiveEndorsement(db, e._id, "candidate_inactive");
      tally("candidate_inactive");
      continue;
    }
    const cacheKey = `${e.countryId}:${e.endorsedByCharacterId.toString()}`;
    let stillLeader = leaderCache.get(cacheKey);
    if (stillLeader === undefined) {
      stillLeader = await isSittingLeader(db, e.countryId, e.endorsedByCharacterId);
      leaderCache.set(cacheKey, stillLeader);
    }
    if (!stillLeader) {
      await withdrawExecutiveEndorsement(db, e._id, "leader_left_office");
      tally("leader_left_office");
    }
  }

  return { withdrawn, byReason };
}
