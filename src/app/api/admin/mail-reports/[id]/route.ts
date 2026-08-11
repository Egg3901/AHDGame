import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import type { PlayerMail, PlayerMailReport } from "@/lib/db/types";
import { withdrawAllCandidatesForUser } from "@/lib/elections/withdrawBannedCandidates";
import { cleanupPartyElectionsForBannedUser } from "@/lib/elections/cleanupPartyElectionsForBannedUser";
import { vacatePartyLeadershipForBannedUser } from "@/lib/elections/vacatePartyLeadershipForBannedUser";
import { stripPartyMembershipForBannedUser } from "@/lib/account/stripPartyMembershipForBannedUser";
import { loadUserCharacterAndCeoCorpIds } from "@/lib/account/loadUserCharacterAndCeoCorpIds";
import { syncSuspiciousFlagsForBanState } from "@/lib/account/syncSuspiciousFlagsForBanState";
import { getMailReportDetail } from "@/lib/mail/queries/mailReportDetail";

const mailReportActionSchema = z.object({
  action: z.enum(["dismiss", "delete_mail", "warn", "ban"]),
  adminNote: z.string().max(500).optional(),
});

// GET /api/admin/mail-reports/[id] — Report detail with full conversation thread
// Auth: requireModerator (admins and moderators)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const db = await getDb();
    const detail = await getMailReportDetail(db, new ObjectId(id));
    if (!detail) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (err) {
    return handleRouteError(err);
  }
}

// PATCH /api/admin/mail-reports/[id] — Take action on a report
// Auth: requireModerator (admins and moderators)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const reportId = new ObjectId(id);
    const adminId = new ObjectId(auth.user.userId);

    const parsed = await parseJsonBody(request, mailReportActionSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { action, adminNote } = parsed.data;
    const db = await getDb();

    const report = await db
      .collection<PlayerMailReport>("playerMailReports")
      .findOne({ _id: reportId });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const now = new Date();
    const baseUpdate = {
      reviewedAt: now,
      reviewedByAdminId: adminId,
      ...(adminNote ? { adminNote } : {}),
    };

    if (action === "dismiss") {
      await db
        .collection<PlayerMailReport>("playerMailReports")
        .updateOne({ _id: reportId }, { $set: { ...baseUpdate, status: "dismissed" } });
    }

    if (action === "delete_mail") {
      await db
        .collection<PlayerMail>("playerMail")
        .updateOne(
          { _id: report.mailId },
          { $set: { deletedByRecipient: true, deletedBySender: true } }
        );
      await db.collection<PlayerMail>("playerMail").deleteOne({ _id: report.mailId });
      await db
        .collection<PlayerMailReport>("playerMailReports")
        .updateOne({ _id: reportId }, { $set: { ...baseUpdate, status: "actioned" } });
    }

    if (action === "warn") {
      const mail = await db.collection<PlayerMail>("playerMail").findOne({ _id: report.mailId });

      if (mail) {
        const senderChar = await db.collection("characters").findOne({ _id: mail.fromCharacterId });

        if (senderChar) {
          await createNotification({
            userId: senderChar.userId,
            type: "system",
            title: "Warning from Admin",
            message:
              "Your message to another player was reported and reviewed by an admin. Please ensure your communications follow community guidelines. Further violations may result in a ban.",
          });
        }
      }

      await db
        .collection<PlayerMailReport>("playerMailReports")
        .updateOne({ _id: reportId }, { $set: { ...baseUpdate, status: "actioned" } });
    }

    if (action === "ban") {
      const mail = await db.collection<PlayerMail>("playerMail").findOne({ _id: report.mailId });

      if (mail) {
        const senderChar = await db.collection("characters").findOne({ _id: mail.fromCharacterId });

        if (senderChar) {
          const { ceoCorpIds } = await loadUserCharacterAndCeoCorpIds(db, senderChar.userId);
          await db.collection("users").updateOne(
            { _id: senderChar.userId },
            {
              $set: {
                isBanned: true,
                banReason: adminNote || "Banned via mail moderation",
                bannedAt: new Date(),
                bannedShareReleaseCorporationIds: ceoCorpIds,
                updatedAt: new Date(),
              },
              $unset: {
                bannedShareReleaseProcessedAt: "",
              },
            }
          );
          await withdrawAllCandidatesForUser(db, senderChar.userId);
          await cleanupPartyElectionsForBannedUser(db, senderChar.userId);
          await vacatePartyLeadershipForBannedUser(db, senderChar.userId);
          await stripPartyMembershipForBannedUser(db, senderChar.userId);
          await syncSuspiciousFlagsForBanState(db, senderChar.userId, true);
        }
      }

      await db
        .collection<PlayerMailReport>("playerMailReports")
        .updateOne({ _id: reportId }, { $set: { ...baseUpdate, status: "actioned" } });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
