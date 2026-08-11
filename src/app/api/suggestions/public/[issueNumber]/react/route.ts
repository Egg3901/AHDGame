import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getSuggestionReactionsCollection } from "@/lib/db/collections/suggestionReactions";
import type { SuggestionReaction } from "@/lib/db/types";

const reactSchema = z.object({
  reaction: z.enum(["like", "dislike"]),
});

// POST /api/suggestions/public/[issueNumber]/react — Add, change, or toggle a like/dislike.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ issueNumber: string }> }
) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(`suggestion-react:${user.userId}`, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { issueNumber: raw } = await params;
    const issueNum = parseInt(raw, 10);
    if (isNaN(issueNum) || issueNum < 1) {
      return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, reactSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { reaction } = parsed.data;

    const db = await getDb();
    const suggestions = getSuggestionsCollection(db);
    const reactions = getSuggestionReactionsCollection(db);

    const s = await suggestions.findOne({ issueNumber: issueNum });
    if (!s) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const userId = new ObjectId(user.userId);
    const existing = await reactions.findOne({ suggestionId: s._id, userId });

    let likeChange = 0;
    let dislikeChange = 0;
    let userReaction: "like" | "dislike" | null = null;

    if (existing) {
      if (existing.reaction === reaction) {
        await reactions.deleteOne({ _id: existing._id });
        if (reaction === "like") likeChange = -1;
        else dislikeChange = -1;
        userReaction = null;
      } else {
        await reactions.updateOne({ _id: existing._id }, { $set: { reaction } });
        if (reaction === "like") {
          likeChange = 1;
          dislikeChange = -1;
        } else {
          likeChange = -1;
          dislikeChange = 1;
        }
        userReaction = reaction;
      }
    } else {
      const doc: Omit<SuggestionReaction, "_id"> = {
        suggestionId: s._id,
        userId,
        reaction,
        createdAt: new Date(),
      };
      await reactions.insertOne(doc as SuggestionReaction);
      if (reaction === "like") likeChange = 1;
      else dislikeChange = 1;
      userReaction = reaction;
    }

    const update: Record<string, number> = {};
    if (likeChange !== 0) update["reactions.like"] = likeChange;
    if (dislikeChange !== 0) update["reactions.dislike"] = dislikeChange;
    if (Object.keys(update).length > 0) {
      await suggestions.updateOne({ _id: s._id }, { $inc: update });
    }

    const updated = await suggestions.findOne({ _id: s._id });
    const counts = updated?.reactions ?? { like: 0, dislike: 0 };
    return NextResponse.json({
      reactions: {
        like: Math.max(0, counts.like ?? 0),
        dislike: Math.max(0, counts.dislike ?? 0),
      },
      userReaction,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
