import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { approveWikiPageSchema } from "@/lib/api/schemas/wiki";
import { notifySubmitterOfWikiDecision } from "@/lib/wiki/reviewNotifications";
import { createModAuditLog } from "@/lib/modAuditLog";
import type { User, WikiPage, EditHistoryEntry } from "@/lib/db/types";
import { ObjectId } from "mongodb";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

// POST /api/admin/wiki/review/[slug]/approve — Approves a pending wiki page submission, optionally applying editorial edits before publishing.
// Auth: requireModerator (admin or moderator)
// Errors: 400, 403, 404
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { slug } = await context.params;

    const parsed = await parseJsonBody(request, approveWikiPageSchema);
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
    const updateData: Partial<WikiPage> = {
      status: "published",
      reviewedBy: reviewerId,
      updatedAt: now,
    };

    const editEntries: EditHistoryEntry[] = [
      { userId: reviewerId, timestamp: now, action: "approved" },
    ];
    const editedFields: string[] = [];
    if (parsed.data.editedContent) {
      updateData.content = parsed.data.editedContent;
      editedFields.push("content");
    }
    if (parsed.data.editedTitle) {
      updateData.title = parsed.data.editedTitle;
      editedFields.push("title");
    }
    if (parsed.data.editedDescription) {
      updateData.description = parsed.data.editedDescription;
      editedFields.push("description");
    }
    if (parsed.data.editedTags) {
      updateData.tags = parsed.data.editedTags;
      editedFields.push("tags");
    }

    if (editedFields.length > 0) {
      editEntries.push({
        userId: reviewerId,
        timestamp: now,
        action: "edited",
        note: `Content modified during approval: ${editedFields.join(", ")}`,
      });
    }

    updateData.editHistory = [...(existing.editHistory || []), ...editEntries];

    await wikiPages.updateOne({ slug }, { $set: updateData });
    const updated = await wikiPages.findOne({ slug });

    let submitterUsername: string | undefined;
    if (existing.submittedBy) {
      const submitter = await db
        .collection<User>("users")
        .findOne({ _id: existing.submittedBy }, { projection: { username: 1, displayName: 1 } });
      submitterUsername = submitter?.displayName || submitter?.username;
      notifySubmitterOfWikiDecision({
        submitterId: existing.submittedBy,
        slug,
        title: updated?.title ?? existing.title,
        decision: "approved",
      }).catch((err) => console.error("[wiki] approve notify failed:", err));
    }

    await createModAuditLog({
      moderatorId: auth.user.userId,
      moderatorName: auth.user.username,
      action: "approve_wiki_page",
      targetUserId: existing.submittedBy?.toString(),
      targetUsername: submitterUsername,
      details: `${slug}: ${updated?.title ?? existing.title}`,
    });
    revalidatePath(`/wiki/${slug}`);
    return NextResponse.json({ success: true, page: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
