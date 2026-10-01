import { ObjectId, type Db } from "mongodb";
import { ApiError, badRequest, notFound } from "@/lib/api/errors";
import { createNotifications } from "@/lib/notifications";
import type {
  Character,
  PlayerContentReport,
  PlayerMail,
  PlayerReportContext,
  PlayerReportReason,
  User,
} from "@/lib/db/types";

/**
 * Player-to-player safety: reporting objectionable content and blocking
 * abusive players. App Store rule 1.2 requires both for apps with
 * user-generated content; they apply on every platform, not only the app.
 */

export const PLAYER_CONTENT_REPORTS = "playerContentReports";
export const MAX_BLOCKED_USERS = 500;

export const PLAYER_REPORT_REASONS: readonly PlayerReportReason[] = [
  "harassment",
  "hate",
  "sexual",
  "violence",
  "spam",
  "impersonation",
  "other",
];
export const PLAYER_REPORT_CONTEXTS: readonly PlayerReportContext[] = [
  "profile",
  "news",
  "party",
  "corporation",
  "other",
];

async function loadTargetCharacter(db: Db, characterId: string) {
  if (!ObjectId.isValid(characterId)) throw notFound("Player not found");
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: new ObjectId(characterId) }, { projection: { _id: 1, name: 1, userId: 1 } });
  if (!character?.userId) throw notFound("Player not found");
  return character;
}

export interface ReportPlayerInput {
  reason: PlayerReportReason;
  context: PlayerReportContext;
  details?: string;
}

/**
 * One open report per reporter and target: a second report while the first is
 * pending is a 409, so a player cannot flood the queue about one person.
 */
export async function reportPlayer(
  db: Db,
  reporterUserId: string,
  targetCharacterId: string,
  input: ReportPlayerInput
): Promise<void> {
  const target = await loadTargetCharacter(db, targetCharacterId);
  const reporter = new ObjectId(reporterUserId);
  if (target.userId.equals(reporter)) throw badRequest("You cannot report yourself");

  const reports = db.collection<Omit<PlayerContentReport, "_id">>(PLAYER_CONTENT_REPORTS);
  const open = await reports.findOne({
    reportedByUserId: reporter,
    targetUserId: target.userId,
    status: "pending",
  });
  if (open)
    throw new ApiError(409, "You already reported this player. A moderator will review it.");

  const details = input.details?.trim();
  await reports.insertOne({
    reportedByUserId: reporter,
    targetUserId: target.userId,
    targetCharacterId: target._id,
    targetCharacterName: target.name,
    reason: input.reason,
    context: input.context,
    ...(details ? { details } : {}),
    status: "pending",
    createdAt: new Date(),
  });

  const staff = await db
    .collection<User>("users")
    .find(
      { $or: [{ isAdmin: true }, { role: "admin" }, { role: "moderator" }] },
      { projection: { _id: 1 } }
    )
    .toArray();
  await createNotifications(
    staff.map((u) => ({
      userId: u._id,
      type: "system" as const,
      title: "New Player Report",
      message:
        "A player reported another player's content. Review it under Player Reports in the moderator or admin panel.",
    }))
  );
}

/** Blocks the user who owns `targetCharacterId` and hides their existing mail. */
export async function blockPlayer(
  db: Db,
  userId: string,
  targetCharacterId: string
): Promise<{ blockedUserId: string }> {
  const target = await loadTargetCharacter(db, targetCharacterId);
  const self = new ObjectId(userId);
  if (target.userId.equals(self)) throw badRequest("You cannot block yourself");

  const result = await db.collection<User>("users").updateOne(
    {
      _id: self,
      $or: [
        { blockedUserIds: { $exists: false } },
        { [`blockedUserIds.${MAX_BLOCKED_USERS - 1}`]: { $exists: false } },
        { blockedUserIds: target.userId },
      ],
    },
    { $addToSet: { blockedUserIds: target.userId } }
  );
  if (result.matchedCount !== 1) {
    throw badRequest(`You can block up to ${MAX_BLOCKED_USERS} players. Unblock someone first.`);
  }

  await setMailHiddenFrom(db, self, target.userId, true);
  return { blockedUserId: target.userId.toHexString() };
}

/** Unblocks by user id (Settings lists users) or by a character they own (profiles). */
export async function unblockPlayer(
  db: Db,
  userId: string,
  target: { userId?: string; characterId?: string }
): Promise<void> {
  let targetUserId: ObjectId;
  if (target.userId && ObjectId.isValid(target.userId)) {
    targetUserId = new ObjectId(target.userId);
  } else if (target.characterId) {
    targetUserId = (await loadTargetCharacter(db, target.characterId)).userId;
  } else {
    throw badRequest("Missing player");
  }
  const self = new ObjectId(userId);
  await db
    .collection<User>("users")
    .updateOne({ _id: self }, { $pull: { blockedUserIds: targetUserId } });
  await setMailHiddenFrom(db, self, targetUserId, false);
}

/** Mail a blocked user already sent stays stored but leaves the inbox until unblocked. */
async function setMailHiddenFrom(
  db: Db,
  recipient: ObjectId,
  sender: ObjectId,
  hidden: boolean
): Promise<void> {
  const senderCharacterIds = await db
    .collection<Character>("characters")
    .find({ userId: sender }, { projection: { _id: 1 } })
    .map((c) => c._id)
    .toArray();
  if (senderCharacterIds.length === 0) return;
  await db
    .collection<PlayerMail>("playerMail")
    .updateMany(
      { toUserId: recipient, fromCharacterId: { $in: senderCharacterIds } },
      hidden ? { $set: { blockedByRecipient: true } } : { $unset: { blockedByRecipient: "" } }
    );
}

export async function hasBlocked(
  db: Db,
  userId: ObjectId,
  otherUserId: ObjectId
): Promise<boolean> {
  const hit = await db
    .collection<User>("users")
    .findOne({ _id: userId, blockedUserIds: otherUserId }, { projection: { _id: 1 } });
  return hit !== null;
}

export interface BlockedPlayer {
  userId: string;
  /** Null when the blocked account has no character left. */
  characterName: string | null;
}

/** The viewer's block list with a recognisable name for each entry. */
export async function listBlockedPlayers(db: Db, userId: string): Promise<BlockedPlayer[]> {
  const self = await db
    .collection<User>("users")
    .findOne({ _id: new ObjectId(userId) }, { projection: { blockedUserIds: 1 } });
  const ids = self?.blockedUserIds ?? [];
  if (ids.length === 0) return [];
  // Character names only: account usernames are login identifiers, not public.
  const characters = await db
    .collection<Character>("characters")
    .find({ userId: { $in: ids } }, { projection: { userId: 1, name: 1 } })
    .toArray();
  const nameByUser = new Map(characters.map((c) => [c.userId.toHexString(), c.name]));
  return ids.map((id) => {
    const key = id.toHexString();
    return { userId: key, characterName: nameByUser.get(key) ?? null };
  });
}
