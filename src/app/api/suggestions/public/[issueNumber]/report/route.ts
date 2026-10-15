import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getSuggestionCommentsCollection } from "@/lib/db/collections/suggestionComments";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { PLAYER_REPORT_REASONS, reportPlayer } from "@/lib/safety/playerSafety";

const reportSchema = z.object({
  reason: z.enum(PLAYER_REPORT_REASONS as [string, ...string[]]),
  details: z.string().max(1000).optional(),
  /** Report one reply instead of the suggestion itself. */
  commentId: z.string().optional(),
});

// POST /api/suggestions/public/[issueNumber]/report — Report a suggestion or one of its replies
// to moderators. Lands in the player content report queue with context "suggestion".
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 409, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ issueNumber: string }> }
) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`player-report:${auth.user.userId}`, 10, 60 * 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const { issueNumber: raw } = await params;
    const issueNum = parseInt(raw, 10);
    if (isNaN(issueNum) || issueNum < 1) return errorResponse(400, "Invalid suggestion id");

    const parsed = await parseJsonBody(request, reportSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { reason, details, commentId } = parsed.data;

    const db = await getDb();
    const suggestion = await getSuggestionsCollection(db).findOne(
      { issueNumber: issueNum },
      { projection: { _id: 1, userId: 1 } }
    );
    if (!suggestion) return errorResponse(404, "Suggestion not found");

    let targetUserId = suggestion.userId;
    let where = `Suggestion S#${issueNum}`;
    if (commentId) {
      if (!ObjectId.isValid(commentId)) return errorResponse(400, "Invalid reply id");
      const comment = await getSuggestionCommentsCollection(db).findOne(
        { _id: new ObjectId(commentId), suggestionId: suggestion._id },
        { projection: { userId: 1 } }
      );
      if (!comment) return errorResponse(404, "Reply not found");
      targetUserId = comment.userId;
      where = `Reply ${commentId} on suggestion S#${issueNum}`;
    }

    const character = targetUserId ? await getCharacterByUserId(db, targetUserId) : null;
    if (!character) {
      return errorResponse(
        400,
        "This post has no in-game author to report. Ask a moderator on Discord instead."
      );
    }

    const note = details?.trim();
    await reportPlayer(db, auth.user.userId, character._id.toString(), {
      reason: reason as (typeof PLAYER_REPORT_REASONS)[number],
      context: "suggestion",
      details: note ? `${where}: ${note}` : where,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
