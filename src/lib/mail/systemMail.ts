import type { Db, ObjectId } from "mongodb";
import type { PlayerMail } from "@/lib/db/types/playerMail";

interface SystemMailParams {
  toCharacterId: ObjectId;
  toCharacterName: string;
  toCharacterSequentialId: number;
  toUserId: ObjectId;
  subject: string;
  body: string;
  /** Defaults to "Forex Market". Override for other system senders. */
  senderName?: string;
}

/**
 * Insert a system-generated mail message.
 * Used by turn phases (forex fill notifications, future game events).
 * No fromCharacterId — these messages come from game systems, not players.
 */
export async function sendSystemMail(db: Db, params: SystemMailParams): Promise<void> {
  const mail: Omit<PlayerMail, "_id"> = {
    fromCharacterName: params.senderName ?? "Forex Market",
    toUserId: params.toUserId,
    toCharacterId: params.toCharacterId,
    toCharacterName: params.toCharacterName,
    toCharacterSequentialId: params.toCharacterSequentialId,
    subject: params.subject,
    body: params.body,
    read: false,
    deletedByRecipient: false,
    deletedBySender: false,
    createdAt: new Date(),
  };

  await db.collection<Omit<PlayerMail, "_id">>("playerMail").insertOne(mail);
}
