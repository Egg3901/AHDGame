import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminSuggestionMergeSchema } from "@/lib/api/schemas/admin";
import { createNotification } from "@/lib/notifications";
import type { Suggestion } from "@/lib/db/types";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getSuggestionCommentsCollection } from "@/lib/db/collections/suggestionComments";

// POST /api/admin/suggestions/merge — Merge multiple suggestions into one.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, adminSuggestionMergeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { targetIssueNumber, sourceIssueNumbers } = parsed.data;

    const db = await getDb();
    const coll = getSuggestionsCollection(db);

    const target = await coll.findOne({ issueNumber: targetIssueNumber });
    if (!target) {
      return NextResponse.json({ error: "Target suggestion not found" }, { status: 404 });
    }

    if (target.mergedInto) {
      return NextResponse.json(
        { error: "Target is already merged into another suggestion" },
        { status: 400 }
      );
    }

    const sources: Suggestion[] = [];
    for (const num of sourceIssueNumbers) {
      const src = await coll.findOne({ issueNumber: num });
      if (!src) {
        return NextResponse.json({ error: `Source S#${num} not found` }, { status: 404 });
      }
      if (src._id.equals(target._id)) {
        return NextResponse.json(
          { error: "Cannot merge a suggestion into itself" },
          { status: 400 }
        );
      }
      if (src.mergedInto) {
        return NextResponse.json(
          { error: `S#${num} is already merged into another suggestion` },
          { status: 400 }
        );
      }
      sources.push(src);
    }

    const commentsColl = getSuggestionCommentsCollection(db);
    const now = new Date();
    let totalMigratedComments = 0;
    const mergedFromIds: ObjectId[] = [];

    for (const src of sources) {
      // Migrate comments from source to target
      const updateResult = await commentsColl.updateMany(
        { suggestionId: src._id },
        { $set: { suggestionId: target._id } }
      );
      totalMigratedComments += updateResult.modifiedCount;

      // Mark source as merged
      await coll.updateOne(
        { _id: src._id },
        {
          $set: {
            mergedInto: target._id,
            status: "not_implementing" as const,
            updatedAt: now,
          },
        }
      );

      mergedFromIds.push(src._id);

      // Notify the source reporter
      if (src.userId) {
        await createNotification({
          userId: src.userId,
          type: "player_suggestion_merged",
          title: `Suggestion S#${src.issueNumber} merged`,
          message: `Your suggestion "${src.title}" has been merged into S#${target.issueNumber}: "${target.title}"`,
          metadata: {
            sourceIssueNumber: src.issueNumber,
            targetIssueNumber: target.issueNumber,
            targetSuggestionId: target._id.toString(),
          },
        });
      }
    }

    // Update target: add mergedFrom, recalculate commentCount
    const targetCommentCount = await commentsColl.countDocuments({ suggestionId: target._id });
    await coll.updateOne(
      { _id: target._id },
      {
        $push: { mergedFrom: { $each: mergedFromIds } } as Record<string, unknown>,
        $set: { commentCount: targetCommentCount, updatedAt: now, mergedAt: now },
      }
    );

    return NextResponse.json({
      message: "Merged successfully",
      targetIssueNumber,
      sourceIssueNumbers,
      commentsMigrated: totalMigratedComments,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
