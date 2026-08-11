/**
 * Resolve an open NG presiding-officer election. Mirrors
 * {@link resolveCppccChairElection}: the top vote-getter wins, all other open
 * nominations fail, and the election document transitions to `closed`.
 *
 * Unlike the DE/CN resolvers (which write to `congressLeaders`), NG surfaces
 * its presiding officers through the executive resolver on `electedOfficials`
 * (officeType "speaker" / "senatePresident"). So the winner is written there,
 * which is exactly what the read-only presiding-officers route already reads.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { getGameTime } from "@/lib/time/gameTime";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { leadershipRoleLabel } from "@/lib/congress/leadership/electionRoleMap";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import type {
  NgChamberLeadershipElection,
  NgChamberLeadershipNomination,
  NgChamberLeadershipRole,
  ElectedOfficial,
} from "@/lib/db/types";
import { NG_ROLE_CONFIG, NG_ELECTION_COLLECTION, NG_NOMINATION_COLLECTION } from "./config";

export async function resolveNgChamberLeadershipElection(
  db: Db,
  role: NgChamberLeadershipRole,
  force = false
): Promise<boolean> {
  const cfg = NG_ROLE_CONFIG[role];
  const election = await db
    .collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION)
    .findOne({ _id: role });
  if (!election || election.status !== "voting") return false;
  if (!force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  const now = new Date();
  const candidacies = await db
    .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
    .find({ role, status: { $in: ["open", "voting"] } })
    .sort({ votesFor: -1 })
    .toArray();

  if (candidacies.length === 0) {
    await db
      .collection<NgChamberLeadershipElection>(NG_ELECTION_COLLECTION)
      .updateOne({ _id: role }, { $set: { status: "closed", updatedAt: now } });
    return true;
  }

  const winner = candidacies[0];
  await db
    .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
    .updateOne({ _id: winner._id }, { $set: { status: "confirmed", updatedAt: now } });
  await db
    .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
    .updateMany(
      { role, _id: { $ne: winner._id }, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );

  // Write the winner into the presiding-officer electedOfficials record the
  // presiding-officers route reads. Replace any prior holder of the office.
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  await officials.updateOne(
    { officeType: cfg.officerOfficeType, countryId: "NG" },
    {
      $set: {
        officeType: cfg.officerOfficeType,
        countryId: "NG",
        characterId: winner.nomineeId,
        characterName: winner.nomineeName,
        party: winner.nomineeParty,
        isNPP: false,
        state: winner.nomineeState,
        electedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), createdAt: now },
      $unset: { nppId: "" },
    },
    { upsert: true }
  );

  // Atomically claim the close so a concurrent resolver cannot also announce.
  const claimed = await claimStatusTransition(
    db,
    NG_ELECTION_COLLECTION,
    { _id: role, status: "voting" },
    { $set: { status: "closed", updatedAt: now } }
  );

  if (claimed) {
    const roleLabel = leadershipRoleLabel(role);
    sendCountryGameEvent("NG", {
      title: `Leadership Election Result — ${roleLabel}`,
      description: `**${winner.nomineeName}** has been elected as **${roleLabel}**.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    }).catch(() => {});
  }

  return true;
}
