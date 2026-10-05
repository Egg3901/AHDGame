import { type Db } from "mongodb";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import { getUKPartyConferencesCollection } from "@/lib/db/collections/ukPartyConferences";
import type { UKPartyConference } from "@/lib/uk/conference/types";
import type { Character, PoliticalParty } from "@/lib/db/types";

export function partySeqIdOf(party: PoliticalParty): string {
  return String(party.sequentialId);
}

export interface EligibleRoll {
  memberIds: string[];
  committeeIds: string[];
}

/** The durable roll on a row, or null when it has not frozen yet. */
export function frozenRollOf(doc: UKPartyConference): EligibleRoll | null {
  if (Array.isArray(doc.eligibleMemberIds) && Array.isArray(doc.eligibleCommitteeIds)) {
    return { memberIds: doc.eligibleMemberIds, committeeIds: doc.eligibleCommitteeIds };
  }
  return null;
}

export async function countPartyMembers(db: Db, party: PoliticalParty): Promise<number> {
  return db.collection<Character>("characters").countDocuments({
    party: partySeqIdOf(party),
    userId: { $exists: true },
  });
}

/** Live electorate: player-member characters plus the committee voter set. */
export async function computeEligibleRoll(db: Db, party: PoliticalParty): Promise<EligibleRoll> {
  const rows = await db
    .collection<Character>("characters")
    .find({ party: partySeqIdOf(party), userId: { $exists: true } }, { projection: { _id: 1 } })
    .toArray();
  return {
    memberIds: rows.map((row) => row._id.toString()).sort(),
    committeeIds: [...getEligibleVoterSet(party)].sort(),
  };
}

/**
 * Freeze the conference's authoritative roll, exactly once. The in-hand doc
 * is authoritative when it already carries a roll (no extra read on the
 * steady path); otherwise one guarded write elects the freezer and every
 * loser re-reads the winner's roll, so concurrent first touches converge on
 * one electorate instead of racing live membership reads.
 *
 * `persisted: false` is the defensive remainder: the row vanished under the
 * freeze, so the caller decides from live inputs without a roll filter
 * rather than failing a legitimate vote.
 */
export async function ensureEligibleRoll(
  db: Db,
  party: PoliticalParty,
  doc: UKPartyConference,
  now: Date
): Promise<EligibleRoll & { persisted: boolean }> {
  const existing = frozenRollOf(doc);
  if (existing) return { ...existing, persisted: true };
  const live = await computeEligibleRoll(db, party);
  const collection = getUKPartyConferencesCollection(db);
  const claimed = await collection.findOneAndUpdate(
    { _id: doc._id, eligibleMemberIds: null, eligibleCommitteeIds: null },
    {
      $set: {
        eligibleMemberIds: live.memberIds,
        eligibleCommitteeIds: live.committeeIds,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  const won = claimed ? frozenRollOf(claimed) : null;
  if (won) return { ...won, persisted: true };
  const reread = await collection.findOne({ _id: doc._id });
  const raced = reread ? frozenRollOf(reread) : null;
  if (raced) return { ...raced, persisted: true };
  return { ...live, persisted: false };
}
