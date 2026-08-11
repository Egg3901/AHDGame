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
  CppccChairElection,
  CppccChairNomination,
  CongressLeader,
  PoliticalParty,
} from "@/lib/db/types";

/**
 * Resolve the open Chairman of the CPPCC election. Mirrors
 * {@link resolveNpcscChairElection}: top-vote-getter wins, all other open
 * nominations fail, the winner is written to `congressLeaders` under role
 * `chair_cppcc`, and the election singleton transitions to `closed`.
 */
export async function resolveCppccChairElection(
  db: Db,
  _partyMap: Map<string, PoliticalParty>,
  force = false
): Promise<boolean> {
  const election = await db
    .collection<CppccChairElection>("cppccChairElections")
    .findOne({ _id: "current" });
  if (!election || election.status !== "voting") return false;
  if (!force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  const now = new Date();
  const candidacies = await db
    .collection<CppccChairNomination>("cppccChairNominations")
    .find({ status: { $in: ["open", "voting"] } })
    .sort({ votesFor: -1 })
    .toArray();

  if (candidacies.length === 0) {
    await vacateCongressLeadershipRole(db, "chair_cppcc", now);
    await db
      .collection<CppccChairElection>("cppccChairElections")
      .updateOne({ _id: "current" }, { $set: { status: "closed", updatedAt: now } });
    return true;
  }

  const winner = candidacies[0];
  await db
    .collection<CppccChairNomination>("cppccChairNominations")
    .updateOne({ _id: winner._id }, { $set: { status: "confirmed", updatedAt: now } });
  await db
    .collection<CppccChairNomination>("cppccChairNominations")
    .updateMany(
      { _id: { $ne: winner._id }, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  await db.collection<CongressLeader>("congressLeaders").updateOne(
    { role: "chair_cppcc" },
    {
      $set: {
        role: "chair_cppcc",
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
    console.error("[CPPCC Chair] Failed to mark congress leadership:", err)
  );
  // Atomically claim the close so a concurrent resolver cannot also announce.
  const claimed = await claimStatusTransition(
    db,
    "cppccChairElections",
    { _id: "current", status: "voting" },
    { $set: { status: "closed", updatedAt: now } }
  );

  if (claimed) {
    const roleLabel = leadershipRoleLabel("chair_cppcc");
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
