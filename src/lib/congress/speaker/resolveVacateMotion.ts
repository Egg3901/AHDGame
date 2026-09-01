import type { Db } from "@/lib/mongodb";
import type { HouseComposition } from "@/lib/congress/houseComposition";
import type { SpeakerVacateMotion } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import {
  isLeadershipElectionClosed,
  vacateCongressLeadershipRole,
} from "@/lib/congress/leadershipElections";
import { computeCongressLeadershipTally } from "@/lib/congress/governmentVoteBreakdown";
import { openSpeakerElection } from "./openSpeakerElection";
import { autoVoteNppsForVacateMotion } from "./autoVoteNppsForVacate";

/** Absolute majority of the chamber needed to carry a motion to vacate. */
export function vacateThreshold(totalSeats: number): number {
  return Math.floor(totalSeats / 2) + 1;
}

/**
 * Resolve the current motion to vacate the chair when it has passed (for-votes
 * reached an absolute chamber majority) or its voting window has closed.
 *
 * On pass: vacate the Speaker and immediately open a fresh 24h Speaker election
 * to refill the seat. Lazy-called on read, mirroring {@link resolveSpeakerElection}.
 *
 * Concurrency-safe: the motion is *claimed* with a conditional
 * `status: voting → passed|failed` write, and only the caller that wins the
 * claim runs the vacate + new-election side effects — so two concurrent readers
 * can't double-vacate. Returns true if this call resolved the motion.
 */
export async function resolveSpeakerVacateMotion(
  db: Db,
  house: HouseComposition,
  force = false
): Promise<boolean> {
  const motions = db.collection<SpeakerVacateMotion>("speakerVacateMotions");
  const motion = await motions.findOne({ _id: "current" });
  if (!motion || motion.status !== "voting") return false;

  const gameTime = await getGameTime();
  const windowClosed =
    force || isLeadershipElectionClosed(motion, gameTime.currentTurn, gameTime.effectiveNow);

  // Once the window has closed, give the silent NPP blocs a graded ballot
  // before the final tally. The bar is an absolute majority of ALL seats, so
  // with blocs abstaining by default the motion could never carry.
  //
  // Deliberately NOT done while the motion is still live: blocs voting the
  // moment it was filed would carry it before anyone could whip them, and the
  // early-pass branch below resolves as soon as the threshold is met.
  const votes = windowClosed ? await autoVoteNppsForVacateMotion(db, motion) : motion.votes;

  // Seat-scoped, seat-weighted tally (drops votes from members who since
  // lost their seat), same as Speaker nominations.
  const tally = await computeCongressLeadershipTally(db, "house", votes);
  const passed = tally.votesFor >= vacateThreshold(house.totalSeats);

  // Resolve early only once it has actually passed; otherwise wait for the window.
  if (!passed && !windowClosed) return false;

  const now = new Date();
  // Claim the motion. Only the writer that flips it out of "voting" owns the
  // side effects; a concurrent resolver sees modifiedCount 0 and bails.
  const claim = await motions.updateOne(
    { _id: "current", status: "voting" },
    { $set: { status: passed ? "passed" : "failed", resolvedAt: now, updatedAt: now } }
  );
  if (claim.modifiedCount === 0) return false;

  if (passed) {
    // Vacate the chair, then open a fresh 24h election to refill the seat
    // (shared with the lost-seat vacancy path).
    await vacateCongressLeadershipRole(db, "speaker_of_the_house", now);
    await openSpeakerElection(db, now);
  }
  return true;
}
