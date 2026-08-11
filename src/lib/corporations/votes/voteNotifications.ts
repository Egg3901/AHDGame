import type { Db, ObjectId } from "mongodb";
import type { CorporationVote, CorporationVoteType } from "@/lib/db/types/corporationVote";
import type { NotificationType } from "@/lib/db/types/notifications";
import { createNotification } from "@/lib/notifications";

export function voteTypeLabel(type: CorporationVoteType): string {
  switch (type) {
    case "governance_change":
      return "Restructuring Vote";
    case "dissolution":
      return "Dissolution Vote";
    case "relocation":
      return "Relocation Vote";
    case "share_issuance":
      return "Share Issuance Vote";
    case "adopt_supershares":
      return "Supershare Vote";
    case "ticker_change":
      return "Ticker Change Vote";
  }
}

export function proposalSummary(vote: CorporationVote): string {
  switch (vote.type) {
    case "governance_change":
      return `restructure to ${vote.payload.newLegalStructure ?? "new structure"}`;
    case "dissolution":
      return "dissolve the corporation";
    case "relocation":
      return `relocate HQ to ${vote.payload.destinationCountryId ?? "new country"}`;
    case "share_issuance":
      return `issue ${vote.payload.newShareCount?.toLocaleString() ?? "?"} new shares`;
    case "adopt_supershares":
      return `adopt dual-class supershares (founder votes count ${vote.payload.superShareMultiplier ?? "?"}× each)`;
    case "ticker_change":
      return `change ticker to ${vote.payload.newTicker ?? "?"}`;
  }
}

async function getShareholderUserIds(db: Db, corporationId: ObjectId): Promise<ObjectId[]> {
  const corp = await db
    .collection("corporations")
    .findOne({ _id: corporationId }, { projection: { shareholders: 1 } });
  if (!corp?.shareholders?.length) return [];
  const characterIds = corp.shareholders
    .filter((s: { characterId?: ObjectId }) => s.characterId)
    .map((s: { characterId: ObjectId }) => s.characterId);
  if (!characterIds.length) return [];
  const characters = await db
    .collection("characters")
    .find({ _id: { $in: characterIds } }, { projection: { userId: 1 } })
    .toArray();
  return characters.map((c) => (c as unknown as { userId: ObjectId }).userId);
}

function buildTitleAndMessage(
  notificationType: NotificationType,
  corpName: string,
  summary: string
) {
  const title =
    notificationType === "corp_vote_opened"
      ? `New vote at ${corpName}`
      : notificationType === "corp_vote_passed"
        ? `Vote passed at ${corpName}`
        : notificationType === "corp_vote_failed"
          ? `Vote failed at ${corpName}`
          : notificationType === "corp_vote_cancelled"
            ? `Vote cancelled at ${corpName}`
            : `Vote closing soon: ${corpName}`;
  const message =
    notificationType === "corp_vote_opened"
      ? `Proposed: ${summary}`
      : notificationType === "corp_vote_passed"
        ? `Approved: ${summary}`
        : notificationType === "corp_vote_failed"
          ? `Rejected: ${summary}`
          : notificationType === "corp_vote_cancelled"
            ? `Cancelled: ${summary}`
            : `4 turns remaining — ${summary}`;
  return { title, message };
}

export async function notifyVoteEventRaw(opts: {
  db: Db;
  corporationId: ObjectId;
  voteId: ObjectId;
  corpName: string;
  summary: string;
  notificationType: NotificationType;
  /** If provided, skip the shareholder lookup and notify exactly these users. */
  userIds?: ObjectId[];
}): Promise<void> {
  const { db, corporationId, voteId, corpName, summary, notificationType } = opts;
  const userIds = opts.userIds ?? (await getShareholderUserIds(db, corporationId));
  if (!userIds.length) return;
  const { title, message } = buildTitleAndMessage(notificationType, corpName, summary);
  await Promise.all(
    userIds.map((userId) =>
      createNotification({
        userId,
        type: notificationType,
        title,
        message,
        metadata: {
          voteId: voteId.toHexString(),
          corporationId: corporationId.toHexString(),
        },
      })
    )
  );
}

export async function notifyVoteEvent(opts: {
  db: Db;
  vote: CorporationVote;
  corpName: string;
  notificationType: NotificationType;
}): Promise<void> {
  const { db, vote, corpName, notificationType } = opts;
  await notifyVoteEventRaw({
    db,
    corporationId: vote.corporationId,
    voteId: vote._id,
    corpName,
    summary: proposalSummary(vote),
    notificationType,
  });
}
