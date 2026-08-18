import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { rejectWikiPageSchema } from "@/lib/api/schemas/wiki";
import { notifySubmitterOfWikiDecision } from "@/lib/wiki/reviewNotifications";
import { createModAuditLog } from "@/lib/modAuditLog";
import type { User, WikiPage } from "@/lib/db/types";
import { ObjectId } from "mongodb";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

// POST /api/admin/wiki/review/[slug]/reject - Rejects a pending wiki page submission and returns it to draft status with a reason.
// Auth: requireModerator (admin or moderator)
// Errors: 400, 403, 404
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { slug } = await context.params;

    const parsed = await parseJsonBody(request, rejectWikiPageSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");

    const existing = await wikiPages.findOne({ slug });
    if (!existing) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    if (existing.status !== "pending_review") {
      return NextResponse.json({ error: "Page is not pending review" }, { status: 400 });
    }

    const now = new Date();
    const reviewerId = new ObjectId(auth.user.userId);
    await wikiPages.updateOne(
      { slug },
      {
        $set: {
          status: "draft",
          updatedAt: now,
          editHistory: [
            ...(existing.editHistory || []),
            {
              userId: reviewerId,
              timestamp: now,
              action: "rejected",
              note: parsed.data.reason,
            },
          ],
        },
      }
    );

    let submitterUsername: string | undefined;
    if (existing.submittedBy) {
      const submitter = await db
        .collection<User>("users")
        .findOne({ _id: existing.submittedBy }, { projection: { username: 1, displayName: 1 } });
      submitterUsername = submitter?.displayName || submitter?.username;

      notifySubmitterOfWikiDecision({
        submitterId: existing.submittedBy,
        slug,
        title: existing.title,
        decision: "rejected",
        reason: parsed.data.reason,
      }).catch((err) => console.error("[wiki] reject notify failed:", err));
    }

    await createModAuditLog({
      moderatorId: auth.user.userId,
      moderatorName: auth.user.username,
      action: "reject_wiki_page",
      targetUserId: existing.submittedBy?.toString(),
      targetUsername: submitterUsername,
      details: `${slug}: ${existing.title} - ${parsed.data.reason}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
