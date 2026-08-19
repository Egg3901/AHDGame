import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { syncSuggestionToGitHub } from "@/lib/github";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { adminSuggestionPatchSchema } from "@/lib/api/schemas/admin";
import { createNotification } from "@/lib/notifications";
import type { Suggestion, User } from "@/lib/db/types";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { markSuggestionThreadRead } from "@/lib/suggestions/readState";
import {
  discordSubmitHandleForChip,
  discordSubmitPrimaryLabel,
} from "@/lib/suggestions/discordSubmitAttribution";

async function findSuggestionByAdminId(db: Db, id: string): Promise<Suggestion | null> {
  const coll = getSuggestionsCollection(db);
  const issueNum = parseInt(id, 10);
  if (!isNaN(issueNum) && issueNum >= 1) {
    const byNum = await coll.findOne({ issueNumber: issueNum });
    if (byNum) return byNum;
  }
  const oid = parseObjectId(id);
  if (oid) return coll.findOne({ _id: oid });
  return null;
}

// GET /api/admin/suggestions/[id] — Full suggestion for admin triage (includes adminNotes).
// Auth: requireAdmin
// Errors: 403, 404
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const suggestion = await findSuggestionByAdminId(db, id);

    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    let reporterUsername: string | null = null;
    let reporterDiscordUsername: string | null = null;
    let reporterCharacterName: string | null = null;
    if (suggestion.userId) {
      const [u, character] = await Promise.all([
        db
          .collection<User>("users")
          .findOne({ _id: suggestion.userId }, { projection: { username: 1, discordUsername: 1 } }),
        getCharacterByUserId(db, suggestion.userId),
      ]);
      reporterUsername = u?.username ?? null;
      reporterDiscordUsername = u?.discordUsername ?? null;
      reporterCharacterName = character?.name ?? null;
    } else {
      reporterCharacterName = discordSubmitPrimaryLabel(suggestion);
      reporterDiscordUsername = discordSubmitHandleForChip(suggestion);
    }

    await markSuggestionThreadRead(db, new ObjectId(auth.admin.userId), suggestion._id);

    return NextResponse.json({
      id: suggestion._id.toString(),
      issueNumber: suggestion.issueNumber,
      category: suggestion.category,
      gameSystem: suggestion.gameSystem,
      title: suggestion.title,
      description: suggestion.description,
      impact: suggestion.impact ?? null,
      priority: suggestion.priority ?? null,
      status: suggestion.status,
      adminNotes: suggestion.adminNotes ?? "",
      screenshotUrl: suggestion.screenshotUrl ?? null,
      githubIssueUrl: suggestion.githubIssueUrl ?? null,
      githubIssueNumber: suggestion.githubIssueNumber ?? null,
      commentCount: suggestion.commentCount ?? 0,
      context: suggestion.context,
      reporterUsername,
      reporterDiscordUsername,
      reporterCharacterName,
      createdAt: suggestion.createdAt.toISOString(),
      updatedAt: suggestion.updatedAt.toISOString(),
      statusChangedAt: suggestion.statusChangedAt?.toISOString(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

// PATCH /api/admin/suggestions/[id] — Update suggestion status / admin notes (player forum).
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const { id } = await params;
    const parsed = await parseJsonBody(request, adminSuggestionPatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { status, adminNotes } = parsed.data;

    const db = await getDb();
    const coll = getSuggestionsCollection(db);

    let suggestion: Suggestion | null = null;
    const issueNum = parseInt(id, 10);
    if (!isNaN(issueNum) && issueNum >= 1) {
      suggestion = await coll.findOne({ issueNumber: issueNum });
    }
    if (!suggestion) {
      const oid = parseObjectId(id);
      if (oid) {
        suggestion = await coll.findOne({ _id: oid });
      }
    }

    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let statusChanged = false;
    let previousStatus = suggestion.status;

    if (status) {
      if (status !== suggestion.status) {
        updates.status = status;
        updates.statusChangedAt = new Date();
        updates.statusChangedBy = new ObjectId(admin.userId);
        statusChanged = true;
        previousStatus = suggestion.status;
      }
    }

    if (adminNotes !== undefined) {
      updates.adminNotes = typeof adminNotes === "string" ? adminNotes.trim().slice(0, 5000) : "";
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ message: "No changes" });
    }

    await coll.updateOne({ _id: suggestion._id }, { $set: updates });

    const githubIssueNum =
      suggestion.githubIssueNumber ??
      (() => {
        if (!suggestion.githubIssueUrl) return null;
        const match = suggestion.githubIssueUrl.match(/\/issues\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
      })();

    if (githubIssueNum && process.env.GIT_TOKEN && process.env.GITHUB_REPO) {
      const adminUser = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(admin.userId) }, { projection: { username: 1 } });
      await syncSuggestionToGitHub({
        githubIssueNumber: githubIssueNum,
        previousStatus: statusChanged ? previousStatus : undefined,
        newStatus: statusChanged ? (updates.status as string) : undefined,
        previousAdminNotes: updates.adminNotes !== undefined ? suggestion.adminNotes : undefined,
        newAdminNotes:
          updates.adminNotes !== undefined ? (updates.adminNotes as string) : undefined,
        adminUsername: adminUser?.username,
      });
    }

    if (statusChanged && suggestion.userId) {
      const newStatus = updates.status as string;
      const title = `Suggestion S#${suggestion.issueNumber} updated`;
      const message = `Your suggestion "${suggestion.title}" is now ${newStatus.replace(/_/g, " ")}.`;

      await createNotification({
        userId: suggestion.userId,
        type: "player_suggestion_status_changed",
        title,
        message,
        metadata: {
          suggestionIssueNumber: suggestion.issueNumber,
          suggestionId: suggestion._id.toString(),
          previousStatus,
          newStatus,
        },
      });
    }

    return NextResponse.json({
      message: "Updated",
      issueNumber: suggestion.issueNumber,
      status: updates.status ?? suggestion.status,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/admin/suggestions/[id] — Delete a single suggestion and cascade.
// Auth: requireAdmin
// Errors: 403, 404
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const suggestion = await findSuggestionByAdminId(db, id);
    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const coll = getSuggestionsCollection(db);
    const commentsColl = db.collection("suggestionComments");
    const readsColl = db.collection("suggestionReads");

    const [cDel, rDel] = await Promise.all([
      commentsColl.deleteMany({ suggestionId: suggestion._id }),
      readsColl.deleteMany({ suggestionId: suggestion._id }),
    ]);

    await coll.deleteOne({ _id: suggestion._id });

    if (suggestion.userId) {
      await createNotification({
        userId: suggestion.userId,
        type: "player_suggestion_status_changed",
        title: `Suggestion S#${suggestion.issueNumber} removed`,
        message: `Your suggestion "${suggestion.title}" has been removed by an administrator.`,
        metadata: {
          suggestionIssueNumber: suggestion.issueNumber,
          suggestionId: suggestion._id.toString(),
          previousStatus: suggestion.status,
          newStatus: "deleted",
        },
      });
    }

    return NextResponse.json({
      message: "Deleted",
      issueNumber: suggestion.issueNumber,
      deletedComments: cDel.deletedCount,
      deletedReads: rDel.deletedCount,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
