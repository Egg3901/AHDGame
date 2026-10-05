/**
 * Close an NG leadership election with an immutable winner before writing its result.
 * Pending results replay idempotently after failure; only completion publishes a card.
 * The electedOfficials record remains the executive hub's presiding-officer source.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { getGameTime } from "@/lib/time/gameTime";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { leadershipRoleLabel } from "@/lib/congress/leadership/electionRoleMap";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import type {
  Character,
  NgChamberLeadershipElection,
  NgChamberLeadershipNomination,
  NgChamberLeadershipRole,
  NgChamberLeadershipResolution,
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
  if (!election || election.status === "cancelled") return false;
  if (election.status === "closed" && (!election.resolution || election.resolution.completedAt)) {
    return false;
  }
  if (election.status === "voting" && !force) {
    const gameTime = await getGameTime();
    if (!isLeadershipElectionClosed(election, gameTime.currentTurn, gameTime.effectiveNow))
      return false;
  }

  let resolution: NgChamberLeadershipResolution;
  if (election.status === "voting") {
    const candidacies = await db
      .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
      .find({ role, status: { $in: ["open", "voting"] } })
      .sort({ votesFor: -1 })
      .toArray();
    const candidate = candidacies[0];
    resolution = {
      id: new ObjectId(),
      resolvedAt: new Date(),
      winner: candidate
        ? {
            _id: candidate._id,
            nomineeId: candidate.nomineeId,
            nomineeName: candidate.nomineeName,
            nomineeParty: candidate.nomineeParty,
            nomineeState: candidate.nomineeState,
          }
        : null,
    };
    // Include the cycle identity: a stale read must never close a newly opened ballot.
    const claimed = await claimStatusTransition(
      db,
      NG_ELECTION_COLLECTION,
      { _id: role, status: "voting", startedAt: election.startedAt },
      { $set: { status: "closed", resolution, updatedAt: resolution.resolvedAt } }
    );
    if (!claimed) return true;
  } else {
    // Reuse the durable selection even if nominations changed after a partial write.
    resolution = election.resolution!;
  }

  const now = resolution.resolvedAt;
  const winner = resolution.winner;
  if (winner) {
    await db
      .collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION)
      .updateOne({ _id: winner._id, role }, { $set: { status: "confirmed", updatedAt: now } });
    await db.collection<NgChamberLeadershipNomination>(NG_NOMINATION_COLLECTION).updateMany(
      {
        role,
        _id: { $ne: winner._id },
        status: { $in: ["open", "voting"] },
        createdAt: { $lte: now },
      },
      { $set: { status: "failed", updatedAt: now } }
    );

    const officials = db.collection<ElectedOfficial>("electedOfficials");
    const prior = await officials.findOne(
      { officeType: cfg.officerOfficeType, countryId: "NG" },
      { projection: { _id: 1, electedAt: 1 } }
    );
    // An overlapping replay must not replace a winner from a later cycle.
    if (!prior || !prior.electedAt || prior.electedAt <= now) {
      await officials.updateOne(
        {
          _id: prior?._id ?? resolution.id,
          ...(prior
            ? { $or: [{ electedAt: { $lte: now } }, { electedAt: { $exists: false } }] }
            : {}),
        },
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
          $setOnInsert: { _id: resolution.id, createdAt: now },
          $unset: { nppId: "" },
        },
        { upsert: !prior }
      );
    }
  }

  // The completion claim follows all idempotent writes and gates publication.
  const completed = await claimStatusTransition(
    db,
    NG_ELECTION_COLLECTION,
    {
      _id: role,
      status: "closed",
      startedAt: election.startedAt,
      "resolution.id": resolution.id,
      "resolution.completedAt": { $exists: false },
    },
    { $set: { "resolution.completedAt": new Date(), updatedAt: now } }
  );

  if (completed && winner) {
    const roleLabel = leadershipRoleLabel(role);
    const nomineeAvatarUrl = (
      await db
        .collection<Character>("characters")
        .findOne({ _id: winner.nomineeId }, { projection: { avatarUrl: 1 } })
    )?.avatarUrl;
    sendCountryGameEvent("NG", {
      title: `Leadership Election Result: ${roleLabel}`,
      description: `**${winner.nomineeName}** has been elected as **${roleLabel}**.`,
      color: DISCORD_COLORS.leadership,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
      ...(nomineeAvatarUrl ? { thumbnail: { url: nomineeAvatarUrl } } : {}),
    }).catch(() => {});
  }

  return true;
}
