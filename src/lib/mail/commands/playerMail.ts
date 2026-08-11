import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import type { Character, PlayerMail, PlayerMailReport, User } from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";
import { createNotifications } from "@/lib/notifications";

type MailSender = Pick<Character, "_id" | "name" | "sequentialId">;

export async function sendPlayerMail(
  db: Db,
  sender: MailSender,
  toCharacterId: string,
  subject: string,
  body: string
): Promise<void> {
  if (toCharacterId === sender._id.toString()) {
    throw badRequest("Cannot send mail to yourself");
  }

  const toCharOid = new ObjectId(toCharacterId);
  const toChar = await db.collection<Character>("characters").findOne({ _id: toCharOid });
  if (!toChar) {
    throw notFound("Recipient not found");
  }

  const toUser = await db.collection<User>("users").findOne({ _id: toChar.userId });
  if (toUser?.isBanned) {
    throw badRequest("Cannot send mail to this player");
  }

  const now = new Date();
  const mail: Omit<PlayerMail, "_id"> = {
    fromCharacterId: sender._id,
    fromCharacterName: sender.name,
    fromCharacterSequentialId: sender.sequentialId ?? 0,
    toUserId: toChar.userId,
    toCharacterId: toCharOid,
    toCharacterName: toChar.name,
    toCharacterSequentialId: toChar.sequentialId ?? 0,
    subject,
    body,
    read: false,
    deletedByRecipient: false,
    deletedBySender: false,
    createdAt: now,
  };

  await db.collection<Omit<PlayerMail, "_id">>("playerMail").insertOne(mail);
}

export async function markReceivedMailRead(db: Db, userId: string, mailId: string): Promise<void> {
  if (!ObjectId.isValid(mailId)) {
    throw notFound("Mail not found");
  }

  const mailOid = new ObjectId(mailId);
  const userOid = new ObjectId(userId);
  const mail = await db
    .collection<PlayerMail>("playerMail")
    .findOne({ _id: mailOid, toUserId: userOid, deletedByRecipient: false });

  if (!mail) {
    throw notFound("Mail not found");
  }

  await db
    .collection<PlayerMail>("playerMail")
    .updateOne({ _id: mailOid, toUserId: userOid }, { $set: { read: true } });
}

export async function deleteReceivedMail(db: Db, userId: string, mailId: string): Promise<void> {
  if (!ObjectId.isValid(mailId)) {
    throw notFound("Mail not found");
  }

  const mailOid = new ObjectId(mailId);
  const userOid = new ObjectId(userId);
  const mail = await db
    .collection<PlayerMail>("playerMail")
    .findOne({ _id: mailOid, toUserId: userOid, deletedByRecipient: false });

  if (!mail) {
    throw notFound("Mail not found");
  }

  await db
    .collection<PlayerMail>("playerMail")
    .updateOne({ _id: mailOid, toUserId: userOid }, { $set: { deletedByRecipient: true } });

  if (mail.deletedBySender) {
    await db.collection<PlayerMail>("playerMail").deleteOne({ _id: mailOid });
  }
}

export async function deleteSentMail(db: Db, characterId: ObjectId, mailId: string): Promise<void> {
  if (!ObjectId.isValid(mailId)) {
    throw notFound("Mail not found");
  }

  const mailOid = new ObjectId(mailId);
  const mail = await db
    .collection<PlayerMail>("playerMail")
    .findOne({ _id: mailOid, fromCharacterId: characterId, deletedBySender: false });

  if (!mail) {
    throw notFound("Mail not found");
  }

  await db
    .collection<PlayerMail>("playerMail")
    .updateOne({ _id: mailOid, fromCharacterId: characterId }, { $set: { deletedBySender: true } });

  if (mail.deletedByRecipient) {
    await db.collection<PlayerMail>("playerMail").deleteOne({ _id: mailOid });
  }
}

export async function reportReceivedMail(db: Db, userId: string, mailId: string): Promise<void> {
  if (!ObjectId.isValid(mailId)) {
    throw forbidden("Forbidden");
  }

  const mailOid = new ObjectId(mailId);
  const userOid = new ObjectId(userId);
  const mail = await db
    .collection<PlayerMail>("playerMail")
    .findOne({ _id: mailOid, toUserId: userOid, deletedByRecipient: false });

  if (!mail) {
    throw forbidden("Forbidden");
  }

  const existing = await db
    .collection<PlayerMailReport>("playerMailReports")
    .findOne({ mailId: mailOid });
  if (existing) {
    throw new ApiError(409, "Already reported");
  }

  const report: Omit<PlayerMailReport, "_id"> = {
    mailId: mailOid,
    reportedByUserId: userOid,
    status: "pending",
    createdAt: new Date(),
  };

  await db.collection<Omit<PlayerMailReport, "_id">>("playerMailReports").insertOne(report);

  const staffUsers = await db
    .collection<User>("users")
    .find(
      { $or: [{ isAdmin: true }, { role: "admin" }, { role: "moderator" }] },
      { projection: { _id: 1 } }
    )
    .toArray();

  await createNotifications(
    staffUsers.map((u) => ({
      userId: u._id,
      type: "system" as const,
      title: "New Mail Report",
      message: `A player reported a message. Review it under Mail Reports in the moderator or admin panel.`,
    }))
  );
}
