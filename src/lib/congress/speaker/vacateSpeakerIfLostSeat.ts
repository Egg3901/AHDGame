import type { Db } from "@/lib/mongodb";
import type { CongressLeader, ElectedOfficial } from "@/lib/db/types";
import { openSpeakerElection } from "./openSpeakerElection";

/**
 * If the current Speaker no longer has a House seat, vacate the position and
 * automatically open a fresh Speaker election to refill it. This only performs
 * work on the genuine seated→vacant transition: once the leader doc reads
 * `characterId: null`, subsequent calls early-return, so the election is opened
 * exactly once per vacancy (no re-open loop if that election later fails).
 */
export async function vacateSpeakerIfLostSeat(db: Db): Promise<void> {
  const leaderDoc = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "speaker_of_the_house" });
  if (!leaderDoc?.characterId) return;
  const stillHasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: "house",
    $or: [{ characterId: leaderDoc.characterId }, { nppId: leaderDoc.characterId }],
  });
  if (stillHasSeat) return;
  const now = new Date();
  await db
    .collection<CongressLeader>("congressLeaders")
    .updateOne(
      { role: "speaker_of_the_house" },
      { $set: { characterId: null, characterName: "Vacant", updatedAt: now } }
    );
  // The chair is now empty — open an election so the House can refill it without
  // waiting on an admin to start one.
  await openSpeakerElection(db, now);
}
