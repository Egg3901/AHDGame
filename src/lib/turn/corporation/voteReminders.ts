import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import type { Corporation, CorporationPrivatizationVote } from "@/lib/db/types";
import {
  notifyVoteEvent,
  notifyVoteEventRaw,
  proposalSummary,
} from "@/lib/corporations/votes/voteNotifications";
import { resolveCorporationVoteIfReady } from "@/lib/corporations/votes/voteService";
import { totalVotingPower } from "@/lib/corporations/superShares";
import { applyPassedVoteEffects } from "@/lib/corporations/votes/voteEffects";
import { resolvePrivatizationVote } from "@/lib/corporations/commands/privatization/resolvePrivatizationVote";

async function getUnvotedUserIds(
  db: Db,
  corporationId: ObjectId,
  votedCharacterIds: Set<string>
): Promise<ObjectId[]> {
  const corp = await db
    .collection("corporations")
    .findOne({ _id: corporationId }, { projection: { shareholders: 1 } });
  if (!corp?.shareholders?.length) return [];
  const unvotedCharacterIds = (corp.shareholders as Array<{ characterId?: ObjectId }>)
    .filter((s) => s.characterId && !votedCharacterIds.has(s.characterId.toString()))
    .map((s) => s.characterId as ObjectId);
  if (!unvotedCharacterIds.length) return [];
  const characters = await db
    .collection("characters")
    .find({ _id: { $in: unvotedCharacterIds } }, { projection: { userId: 1 } })
    .toArray();
  return characters.map((c) => (c as unknown as { userId: ObjectId }).userId);
}

export async function processVoteReminders(db: Db, currentTurn: number): Promise<void> {
  const reminderDeadline = currentTurn + 4;

  const [genericVotes, privVotes] = await Promise.all([
    db
      .collection<CorporationVote>("corporationVotes")
      .find({ status: "open", deadlineAtTurn: reminderDeadline })
      .toArray(),
    db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .find({ status: "open", deadlineAtTurn: reminderDeadline })
      .toArray(),
  ]);

  await Promise.all([
    ...genericVotes.map(async (vote) => {
      const corp = await db
        .collection("corporations")
        .findOne({ _id: vote.corporationId }, { projection: { name: 1 } });
      if (!corp) return;
      const votedCharacterIds = new Set(
        vote.votes.map((v) => v.characterId?.toString()).filter(Boolean) as string[]
      );
      const userIds = await getUnvotedUserIds(db, vote.corporationId, votedCharacterIds);
      if (!userIds.length) return;
      void notifyVoteEventRaw({
        db,
        corporationId: vote.corporationId,
        voteId: vote._id,
        corpName: (corp as unknown as { name: string }).name,
        summary: proposalSummary(vote),
        notificationType: "corp_vote_reminder",
        userIds,
      });
    }),
    ...privVotes.map(async (vote) => {
      const corp = await db
        .collection("corporations")
        .findOne({ _id: vote.corporationId }, { projection: { name: 1 } });
      if (!corp) return;
      const votedCharacterIds = new Set(
        vote.votes.map((v) => v.characterId?.toString()).filter(Boolean) as string[]
      );
      const userIds = await getUnvotedUserIds(db, vote.corporationId, votedCharacterIds);
      if (!userIds.length) return;
      void notifyVoteEventRaw({
        db,
        corporationId: vote.corporationId,
        voteId: vote._id,
        corpName: (corp as unknown as { name: string }).name,
        summary: "take the corporation private (buyout)",
        notificationType: "corp_vote_reminder",
        userIds,
      });
    }),
  ]);
}

/**
 * Turn-driven sweep that finalizes any open corp vote whose tally already meets
 * the auto-resolve criteria — or whose deadline has passed. Without this, votes
 * only resolve when somebody opens the vote endpoint, so an unattended vote
 * can sit "open" indefinitely after the threshold is crossed. Runs every turn.
 *
 * Generic votes (governance/relocation/issuance/dissolution) flow through
 * resolveCorporationVoteIfReady — atomic claim guarantees side effects fire
 * exactly once even with concurrent UI polls.
 *
 * Privatization votes only finalize at deadline (resolvePrivatizationVote
 * has its own atomic claim and full settlement logic).
 */
export async function processVoteAutoResolve(
  db: Db,
  currentTurn: number,
  forexEnabled: boolean
): Promise<void> {
  const [genericVotes, privVotes] = await Promise.all([
    db.collection<CorporationVote>("corporationVotes").find({ status: "open" }).toArray(),
    db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .find({ status: "open" })
      .toArray(),
  ]);

  // Pre-batch corporation lookups for generic votes
  const genericCorpIds = [...new Set(genericVotes.map((v) => v.corporationId.toString()))].map(
    (id) => new MongoObjectId(id)
  );
  const genericCorps =
    genericCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: genericCorpIds } })
          .toArray()
      : [];
  const corpById = new Map(genericCorps.map((c) => [c._id.toString(), c]));

  await Promise.all(
    genericVotes.map(async (vote) => {
      const corp = corpById.get(vote.corporationId.toString());
      if (!corp) return;
      const { outcome, claimed } = await resolveCorporationVoteIfReady({
        db,
        vote,
        totalEligibleShares: totalVotingPower(corp),
        currentTurn,
      });
      if (!claimed || outcome === "open") return;
      const notificationType =
        outcome === "passed" ? "corp_vote_passed" : ("corp_vote_failed" as const);
      if (outcome === "passed") {
        await applyPassedVoteEffects({ db, vote, corporation: corp, currentTurn });
      }
      await notifyVoteEvent({ db, vote, corpName: corp.name, notificationType });
    })
  );

  await Promise.all(
    privVotes.map(async (vote) => {
      await resolvePrivatizationVote({ db, vote, currentTurn, forexEnabled });
    })
  );
}
