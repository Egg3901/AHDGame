import type { Db } from "@/lib/mongodb";
import type { SpeakerElection, SpeakerNomination } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";

const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Open a fresh 24h Speaker election to fill a vacant chair, unless one is already
 * live. Fails any dangling nominations and upserts the `speakerElections`
 * singleton into `voting`. Does NOT seed an incumbent nomination (the seat is
 * vacant). Shared by the vacancy auto-open path and the motion-to-vacate
 * resolver so the election lifecycle stays identical however the seat opened.
 *
 * @returns true if it opened an election, false if one was already running.
 */
export async function openSpeakerElection(db: Db, now: Date): Promise<boolean> {
  const gameTime = await getGameTime();
  const existing = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  if (
    existing?.status === "voting" &&
    !isLeadershipElectionClosed(existing, gameTime.currentTurn, gameTime.effectiveNow)
  ) {
    return false;
  }

  await db
    .collection<SpeakerNomination>("speakerNominations")
    .updateMany(
      { status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );

  const endsAt = new Date(gameTime.effectiveNow.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = gameTime.currentTurn + ELECTION_DURATION_MS / 3_600_000;
  await db.collection<SpeakerElection>("speakerElections").updateOne(
    { _id: "current" },
    {
      $set: {
        _id: "current",
        status: "voting",
        startedAt: now,
        endsAt,
        endsOnTurn,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  return true;
}
