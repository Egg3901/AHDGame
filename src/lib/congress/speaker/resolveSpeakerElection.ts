import type { Db } from "@/lib/mongodb";
import { markCongressLeadershipHeld } from "@/lib/wiki/markCongressLeadership";
import {
  vacateCongressLeadershipRole,
  isLeadershipElectionClosed,
} from "@/lib/congress/leadershipElections";
import { getGameTime } from "@/lib/time/gameTime";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { leadershipRoleLabel } from "@/lib/congress/leadership/electionRoleMap";
import { computeCongressLeadershipTally } from "@/lib/congress/governmentVoteBreakdown";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import type {
  CongressLeader,
  SpeakerElection,
  SpeakerNomination,
  PoliticalParty,
} from "@/lib/db/types";

export async function resolveSpeakerElection(
  db: Db,
  _partyMap: Map<string, PoliticalParty>,
  force = false
): Promise<boolean> {
  const election = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  if (!election || election.status !== "voting") return false;
  if (!force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  const now = new Date();
  const candidacies = await db
    .collection<SpeakerNomination>("speakerNominations")
    .find({ status: { $in: ["open", "voting"] } })
    .sort({ votesFor: -1 })
    .toArray();

  if (candidacies.length === 0) {
    await vacateCongressLeadershipRole(db, "speaker_of_the_house", now);
    await db
      .collection<SpeakerElection>("speakerElections")
      .updateOne({ _id: "current" }, { $set: { status: "closed", updatedAt: now } });
    return true;
  }

  // Declare the winner by the seat-scoped one-member-one-vote count (not the
  // cached `votesFor`, which can include de-seated voters) so the resolved
  // Speaker matches what the leadership page displays.
  const countedCandidacies = await Promise.all(
    candidacies.map(async (c) => ({
      nom: c,
      count: (await computeCongressLeadershipTally(db, "house", c.votes)).votesFor,
    }))
  );
  countedCandidacies.sort(
    (a, b) => b.count - a.count || a.nom.createdAt.getTime() - b.nom.createdAt.getTime()
  );
  const winner = countedCandidacies[0]!.nom;
  await db
    .collection<SpeakerNomination>("speakerNominations")
    .updateOne({ _id: winner._id }, { $set: { status: "confirmed", updatedAt: now } });
  await db
    .collection<SpeakerNomination>("speakerNominations")
    .updateMany(
      { _id: { $ne: winner._id }, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db.collection<CongressLeader>("congressLeaders").updateOne(
    { role: "speaker_of_the_house" },
    {
      $set: {
        role: "speaker_of_the_house",
        characterId: winner.nomineeId,
        characterName: winner.nomineeName,
        party: winner.nomineeParty,
        nominatedBy: winner.nominatedById,
        electedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  markCongressLeadershipHeld(db, winner.nomineeId.toString(), now).catch((err) =>
    console.error("[Speaker] Failed to mark congress leadership:", err)
  );
  // Atomically claim the close so a concurrent resolver (turn phase racing a
  // real-time action, or two containers overlapping on redeploy) cannot also
  // announce this result. Only the caller that flips voting→closed posts.
  const claimed = await claimStatusTransition(
    db,
    "speakerElections",
    { _id: "current", status: "voting" },
    { $set: { status: "closed", updatedAt: now } }
  );

  if (claimed) {
    const roleLabel = leadershipRoleLabel("speaker_of_the_house");
    sendCountryGameEvent("US", {
      title: `Leadership Election Result — ${roleLabel}`,
      description: `**${winner.nomineeName}** has been elected as **${roleLabel}**.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return true;
}
