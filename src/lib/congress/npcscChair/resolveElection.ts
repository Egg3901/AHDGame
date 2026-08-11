import type { Db } from "@/lib/mongodb";
import { markCongressLeadershipHeld } from "@/lib/wiki/markCongressLeadership";
import {
  vacateCongressLeadershipRole,
  isLeadershipElectionClosed,
} from "@/lib/congress/leadershipElections";
import { getGameTime } from "@/lib/time/gameTime";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { leadershipRoleLabel } from "@/lib/congress/leadership/electionRoleMap";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import type {
  NpcscChairElection,
  NpcscChairNomination,
  CongressLeader,
  PoliticalParty,
} from "@/lib/db/types";

/**
 * Resolve the open NPC Standing Committee Chairman election. Mirrors
 * {@link resolveBundestagspraesidentElection}: top-vote-getter wins, all other
 * open nominations fail, the winner is written to `congressLeaders` under role
 * `chair_npcsc`, and the election singleton transitions to `closed`.
 *
 * @returns true if the election was resolved (or closed empty), false if no
 *   open election exists or the deadline hasn't fired yet (when `force` is
 *   not set).
 */
export async function resolveNpcscChairElection(
  db: Db,
  _partyMap: Map<string, PoliticalParty>,
  force = false
): Promise<boolean> {
  const election = await db
    .collection<NpcscChairElection>("npcscChairElections")
    .findOne({ _id: "current" });
  if (!election || election.status !== "voting") return false;
  if (!force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  const now = new Date();
  const candidacies = await db
    .collection<NpcscChairNomination>("npcscChairNominations")
    .find({ status: { $in: ["open", "voting"] } })
    .sort({ votesFor: -1 })
    .toArray();

  if (candidacies.length === 0) {
    await vacateCongressLeadershipRole(db, "chair_npcsc", now);
    await db
      .collection<NpcscChairElection>("npcscChairElections")
      .updateOne({ _id: "current" }, { $set: { status: "closed", updatedAt: now } });
    return true;
  }

  const winner = candidacies[0];
  await db
    .collection<NpcscChairNomination>("npcscChairNominations")
    .updateOne({ _id: winner._id }, { $set: { status: "confirmed", updatedAt: now } });
  await db
    .collection<NpcscChairNomination>("npcscChairNominations")
    .updateMany(
      { _id: { $ne: winner._id }, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db.collection<CongressLeader>("congressLeaders").updateOne(
    { role: "chair_npcsc" },
    {
      $set: {
        role: "chair_npcsc",
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
    console.error("[NPCSC Chair] Failed to mark congress leadership:", err)
  );
  // Atomically claim the close so a concurrent resolver cannot also announce.
  const claimed = await claimStatusTransition(
    db,
    "npcscChairElections",
    { _id: "current", status: "voting" },
    { $set: { status: "closed", updatedAt: now } }
  );

  if (claimed) {
    const roleLabel = leadershipRoleLabel("chair_npcsc");
    sendCountryGameEvent("CN", {
      title: `Leadership Election Result — ${roleLabel}`,
      description: `**${winner.nomineeName}** has been elected as **${roleLabel}**.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return true;
}
