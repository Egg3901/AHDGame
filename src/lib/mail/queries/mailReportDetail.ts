import type { Db, ObjectId } from "mongodb";
import type { PlayerMail, PlayerMailReport, User } from "@/lib/db/types";
import { normalizeMailSubject } from "@/lib/inbox/mailThreads";

export type MailReportMessageView = {
  id: string;
  fromCharacterId: string | null;
  fromCharacterName: string;
  fromCharacterSequentialId: number | null;
  toCharacterId: string;
  toCharacterName: string;
  toCharacterSequentialId: number;
  body: string;
  createdAt: string;
  isReported: boolean;
  deletedByRecipient: boolean;
  deletedBySender: boolean;
};

export type MailReportDetailView = {
  report: {
    _id: string;
    mailId: string;
    reportedByUserId: string;
    status: PlayerMailReport["status"];
    adminNote?: string;
    reviewedAt?: string;
    createdAt: string;
  };
  reporterUsername: string | null;
  subject: string | null;
  messages: MailReportMessageView[];
};

function serializeMessage(mail: PlayerMail, reportedMailId: ObjectId): MailReportMessageView {
  return {
    id: mail._id.toString(),
    fromCharacterId: mail.fromCharacterId?.toString() ?? null,
    fromCharacterName: mail.fromCharacterName,
    fromCharacterSequentialId: mail.fromCharacterSequentialId ?? null,
    toCharacterId: mail.toCharacterId.toString(),
    toCharacterName: mail.toCharacterName,
    toCharacterSequentialId: mail.toCharacterSequentialId,
    body: mail.body,
    createdAt: mail.createdAt.toISOString(),
    isReported: mail._id.equals(reportedMailId),
    deletedByRecipient: mail.deletedByRecipient,
    deletedBySender: mail.deletedBySender,
  };
}

export async function getMailReportDetail(
  db: Db,
  reportId: ObjectId
): Promise<MailReportDetailView | null> {
  const report = await db
    .collection<PlayerMailReport>("playerMailReports")
    .findOne({ _id: reportId });
  if (!report) return null;

  const reporter = await db
    .collection<User>("users")
    .findOne({ _id: report.reportedByUserId }, { projection: { username: 1 } });

  const anchorMail = await db.collection<PlayerMail>("playerMail").findOne({ _id: report.mailId });

  let messages: PlayerMail[] = [];
  if (anchorMail?.fromCharacterId) {
    const charA = anchorMail.fromCharacterId;
    const charB = anchorMail.toCharacterId;
    const subjectKey = normalizeMailSubject(anchorMail.subject);

    const candidates = await db
      .collection<PlayerMail>("playerMail")
      .find({
        $or: [
          { fromCharacterId: charA, toCharacterId: charB },
          { fromCharacterId: charB, toCharacterId: charA },
        ],
      })
      .sort({ createdAt: 1 })
      .toArray();

    messages = candidates.filter((m) => normalizeMailSubject(m.subject) === subjectKey);
  } else if (anchorMail) {
    messages = [anchorMail];
  }

  return {
    report: {
      _id: report._id.toString(),
      mailId: report.mailId.toString(),
      reportedByUserId: report.reportedByUserId.toString(),
      status: report.status,
      adminNote: report.adminNote,
      reviewedAt: report.reviewedAt?.toISOString(),
      createdAt: report.createdAt.toISOString(),
    },
    reporterUsername: reporter?.username ?? null,
    subject: anchorMail?.subject ?? null,
    messages: messages.map((m) => serializeMessage(m, report.mailId)),
  };
}
