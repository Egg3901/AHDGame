import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getSuggestionCommentsCollection } from "@/lib/db/collections/suggestionComments";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";

// DELETE /api/suggestions/public/[issueNumber]/comments/[commentId] — Delete a comment.
// Auth: requireBasicAuth (author or admin)
// Errors: 400, 401, 403, 404
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ issueNumber: string; commentId: string }> }
) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { issueNumber: rawIssue, commentId: rawComment } = await params;
    const issueNum = parseInt(rawIssue, 10);
    if (isNaN(issueNum) || issueNum < 1) {
      return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
    }

    if (!ObjectId.isValid(rawComment)) {
      return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
    }

    const db = await getDb();
    const suggestions = getSuggestionsCollection(db);
    const suggestion = await suggestions.findOne({ issueNumber: issueNum });
    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const comments = getSuggestionCommentsCollection(db);
    const comment = await comments.findOne({ _id: new ObjectId(rawComment) });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    if (!comment.suggestionId.equals(suggestion._id)) {
      return NextResponse.json({ error: "Comment does not belong to this suggestion" }, { status: 400 });
    }

    const userId = new ObjectId(auth.user.userId);
    const isAuthor = comment.userId.equals(userId);
    const isAdmin = auth.user.isAdmin === true;
    if (!isAuthor && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await comments.deleteOne({ _id: comment._id });
    await suggestions.updateOne({ _id: suggestion._id }, { $inc: { commentCount: -1 } });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}