import { getDb } from "@/lib/mongodb";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import { getGameState } from "@/lib/gameState";

export async function resolveExpiredDisbandVotes(referenceNow = new Date()): Promise<{
  resolved: number;
  disbanded: number;
}> {
  const db = await getDb();
  const now = new Date(referenceNow);
  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 0;

  // Find coalitions with expired disband votes. Prefer the game-clock turn
  // deadline; fall back to date for legacy coalitions pre-dating the turn migration.
  const expiredCoalitions = await db
    .collection<Coalition>("coalitions")
    .find({
      disbandVote: { $ne: null },
      $or: [
        { "disbandVote.expiresOnTurn": { $lte: currentTurn } },
        {
          "disbandVote.expiresOnTurn": { $exists: false },
          "disbandVote.expiresAt": { $lte: now },
        },
      ],
    })
    .toArray();

  let resolved = 0;
  let disbanded = 0;
  const notifications: NotificationInput[] = [];

  for (const coalition of expiredCoalitions) {
    if (!coalition.disbandVote) continue;
    resolved++;

    const yesVotes = coalition.disbandVote.votes.filter((v) => v.vote === "yes").length;
    const totalMembers = coalition.members.length;
    const majorityThreshold = Math.floor(totalMembers / 2) + 1;

    if (yesVotes >= majorityThreshold) {
      // Disband: clear coalitionId on all member parties whose coalitionId actually
      // points at *this* coalition. Pre-fix data could have a party listed here while
      // their coalitionId points elsewhere — unconditional clear would orphan them.
      const memberPartyIds = coalition.members.map((m) => m.partyId);
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateMany(
          { _id: { $in: memberPartyIds }, coalitionId: coalition._id },
          { $set: { coalitionId: null } }
        );

      // Notify all member chairs
      const memberParties = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ _id: { $in: memberPartyIds } })
        .project({ chairId: 1 })
        .toArray();
      const chairCharIds = memberParties.map((p) => p.chairId).filter(Boolean);
      const chairChars = await db
        .collection("characters")
        .find({ _id: { $in: chairCharIds } })
        .project({ _id: 1, userId: 1 })
        .toArray();

      for (const chairChar of chairChars) {
        notifications.push({
          userId: chairChar.userId,
          type: "coalition_disbanded",
          title: `${coalition.name} Disbanded`,
          message: `The coalition "${coalition.name}" has been disbanded by majority vote (${yesVotes}/${totalMembers}).`,
          metadata: {
            coalitionId: coalition._id,
            coalitionSequentialId: coalition.sequentialId,
            coalitionName: coalition.name,
            countryId: coalition.countryId,
          },
        });
      }

      await db.collection<Coalition>("coalitions").deleteOne({ _id: coalition._id });
      disbanded++;
    } else {
      // Vote failed — clear the disbandVote
      await db
        .collection<Coalition>("coalitions")
        .updateOne({ _id: coalition._id }, { $set: { disbandVote: null, updatedAt: now } });
    }
  }

  await createNotifications(notifications);
  return { resolved, disbanded };
}
