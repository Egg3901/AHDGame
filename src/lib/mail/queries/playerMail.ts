import type { Db, ObjectId } from "mongodb";
import type { PlayerMail } from "@/lib/db/types";
import { serializePlayerMail, type PlayerMailView } from "@/lib/mail/dto/playerMailView";

interface InboxFacet {
  mails: PlayerMail[];
  totalCount: { count: number }[];
  unreadCount: { count: number }[];
}

interface SentFacet {
  mails: PlayerMail[];
  totalCount: { count: number }[];
}

export interface InboxMailPage {
  mails: PlayerMailView[];
  unreadCount: number;
  total: number;
  hasMore: boolean;
}

export interface SentMailPage {
  mails: PlayerMailView[];
  total: number;
  hasMore: boolean;
}

export async function getInboxMailPage(
  db: Db,
  userId: ObjectId,
  offset: number,
  limit: number
): Promise<InboxMailPage> {
  const [result] = await db
    .collection<PlayerMail>("playerMail")
    .aggregate<InboxFacet>([
      { $match: { toUserId: userId, deletedByRecipient: false } },
      {
        $facet: {
          mails: [{ $sort: { createdAt: -1 } }, { $skip: offset }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
          unreadCount: [{ $match: { read: false } }, { $count: "count" }],
        },
      },
    ])
    .toArray();

  const mails = result?.mails ?? [];
  const total = result?.totalCount[0]?.count ?? 0;
  const unreadCount = result?.unreadCount[0]?.count ?? 0;

  return {
    mails: mails.map(serializePlayerMail),
    unreadCount,
    total,
    hasMore: offset + mails.length < total,
  };
}

export async function getSentMailPage(
  db: Db,
  characterId: ObjectId,
  offset: number,
  limit: number
): Promise<SentMailPage> {
  const [result] = await db
    .collection<PlayerMail>("playerMail")
    .aggregate<SentFacet>([
      { $match: { fromCharacterId: characterId, deletedBySender: false } },
      {
        $facet: {
          mails: [{ $sort: { createdAt: -1 } }, { $skip: offset }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ])
    .toArray();

  const mails = result?.mails ?? [];
  const total = result?.totalCount[0]?.count ?? 0;

  return {
    mails: mails.map(serializePlayerMail),
    total,
    hasMore: offset + mails.length < total,
  };
}
