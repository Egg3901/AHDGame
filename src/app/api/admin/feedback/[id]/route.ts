import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { syncFeedbackToGitHub } from "@/lib/github";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { adminFeedbackPatchSchema } from "@/lib/api/schemas/admin";
import type { Feedback, User } from "@/lib/db/types";

// PATCH /api/admin/feedback/[id] — Update feedback status and/or admin notes, notifying the reporter on status change.
// Auth: requireAdmin
// Errors: 400, 403, 404
/**
 * PATCH /api/admin/feedback/[id]
 * Update feedback status and/or admin notes.
 * [id] can be issueNumber (e.g. 1) or MongoDB ObjectId.
 * Body: { status?, adminNotes? }
 * Notifies the reporter when status changes.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const { id } = await params;
    const parsed = await parseJsonBody(request, adminFeedbackPatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { status, adminNotes } = parsed.data;

    const db = await getDb();

    // Resolve id: can be issueNumber or ObjectId
    let feedback: Feedback | null = null;
    const issueNum = parseInt(id, 10);
    if (!isNaN(issueNum) && issueNum >= 1) {
      feedback = await db.collection<Feedback>("feedback").findOne({ issueNumber: issueNum });
    }
    if (!feedback) {
      const oid = parseObjectId(id);
      if (oid) {
        feedback = await db.collection<Feedback>("feedback").findOne({ _id: oid });
      }
    }

    if (!feedback) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let statusChanged = false;
    let previousStatus = feedback.status;

    if (status) {
      if (status !== feedback.status) {
        updates.status = status;
        updates.statusChangedAt = new Date();
        updates.statusChangedBy = new ObjectId(admin.userId);
        statusChanged = true;
        previousStatus = feedback.status;
      }
    }

    if (adminNotes !== undefined) {
      updates.adminNotes = typeof adminNotes === "string" ? adminNotes.trim().slice(0, 5000) : "";
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ message: "No changes" });
    }

    await db.collection<Feedback>("feedback").updateOne({ _id: feedback._id }, { $set: updates });

    // Sync to GitHub issue when linked — keep admin panel and GitHub consistent.
    // Fall back to extracting the issue number from the URL for legacy records
    // that have githubIssueUrl but are missing the githubIssueNumber field.
    const githubIssueNum =
      feedback.githubIssueNumber ??
      (() => {
        if (!feedback.githubIssueUrl) return null;
        const match = feedback.githubIssueUrl.match(/\/issues\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
      })();

    if (githubIssueNum && process.env.GIT_TOKEN && process.env.GITHUB_REPO) {
      const adminUser = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(admin.userId) }, { projection: { username: 1 } });
      await syncFeedbackToGitHub({
        githubIssueNumber: githubIssueNum,
        previousStatus: statusChanged ? previousStatus : undefined,
        newStatus: statusChanged ? (updates.status as string) : undefined,
        previousAdminNotes: updates.adminNotes !== undefined ? feedback.adminNotes : undefined,
        newAdminNotes:
          updates.adminNotes !== undefined ? (updates.adminNotes as string) : undefined,
        adminUsername: adminUser?.username,
      });
    }

    // Notify reporter when status changes (if they have an account)
    if (statusChanged && feedback.userId) {
      const newStatus = updates.status as string;
      const statusLabel =
        newStatus === "resolved"
          ? "resolved"
          : newStatus === "wont_fix"
            ? "closed (won't fix)"
            : newStatus === "in_progress"
              ? "in progress"
              : newStatus;

      const title = `Issue #${feedback.issueNumber} updated`;
      const message =
        newStatus === "resolved"
          ? `Your ${feedback.type} "${feedback.title}" has been resolved.`
          : newStatus === "wont_fix"
            ? `Your ${feedback.type} "${feedback.title}" was closed (won't fix).`
            : `Your ${feedback.type} "${feedback.title}" is now ${statusLabel}.`;

      await createNotification({
        userId: feedback.userId,
        type: "feedback_status_changed",
        title,
        message,
        metadata: {
          issueNumber: feedback.issueNumber,
          feedbackId: feedback._id.toString(),
          previousStatus,
          newStatus,
        },
      });
    }

    return NextResponse.json({
      message: "Updated",
      issueNumber: feedback.issueNumber,
      status: updates.status ?? feedback.status,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
