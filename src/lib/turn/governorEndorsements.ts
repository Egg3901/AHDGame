import type { Db } from "mongodb";
import type {
  GovernorEndorsement,
  Election,
  ElectionCandidate,
  ElectedOfficial,
} from "@/lib/db/types";
import { getRegionalExecutiveOfficeKey } from "@/lib/constants/countries";
import { withdrawEndorsement } from "@/lib/governorOffice/endorsements/withdrawEndorsement";

/**
 * Turn phase: auto-withdraw governor endorsements whose conditions no longer hold.
 *   - election no longer active → election_ended
 *   - candidate no longer active → candidate_inactive
 *   - governor no longer in office → governor_left_office
 *
 * Must run BEFORE processCampaignTurn so withdrawals are observed by the
 * endorsement-count aggregation there.
 */
export async function processGovernorEndorsements(
  db: Db
): Promise<{ withdrawn: number; byReason: Record<string, number> }> {
  const active = await db
    .collection<GovernorEndorsement>("governorEndorsements")
    .find({ isActive: true })
    .toArray();
  let withdrawn = 0;
  const byReason: Record<string, number> = {};
  function tally(reason: NonNullable<GovernorEndorsement["withdrawnReason"]>) {
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    withdrawn++;
  }

  for (const e of active) {
    if (!e._id) continue;
    const election = await db.collection<Election>("elections").findOne({ _id: e.electionId });
    if (!election || election.status !== "active") {
      await withdrawEndorsement(db, e._id, "election_ended");
      tally("election_ended");
      continue;
    }
    const candidate = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne({ _id: e.candidateId });
    if (!candidate || candidate.status !== "active") {
      await withdrawEndorsement(db, e._id, "candidate_inactive");
      tally("candidate_inactive");
      continue;
    }
    const holder = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: getRegionalExecutiveOfficeKey(e.countryId),
      state: e.stateId,
      countryId: e.countryId,
      characterId: e.endorsedByCharacterId,
    });
    if (!holder) {
      await withdrawEndorsement(db, e._id, "governor_left_office");
      tally("governor_left_office");
    }
  }

  return { withdrawn, byReason };
}
