import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getSuggestionReactionsCollection } from "@/lib/db/collections/suggestionReactions";
import type { NewsPost, NewsReaction, SuggestionReaction, User } from "@/lib/db/types";

const schema = z.object({
  discordUserId: z.string().min(1),
  messageId: z.string().min(1),
  channelType: z.enum(["news", "suggestion"]),
  emoji: z.enum(["👍", "👎"]),
});

// POST /api/discord-bot/reactions — Record a Discord user's 👍/👎 reaction on a news or suggestion webhook post.
// Auth: requireBotToken (private key only)
// Errors: 401, 400, 404, 429
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { discordUserId, messageId, channelType, emoji } = parsed.data;

    const rateLimit = checkRateLimit(`discord-reaction:${discordUserId}`, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    const user = await db
      .collection<User>("users")
      .findOne({ discordId: discordUserId }, { projection: { _id: 1 } });
    if (!user) {
      return NextResponse.json({ linked: false }, { status: 404 });
    }
    const userId = user._id;

    if (channelType === "news") {
      const reaction = emoji === "👍" ? "agree" : "disagree";

      const post = await db
        .collection<NewsPost>("newsPosts")
        .findOne({ discordMessageId: messageId }, { projection: { _id: 1, reactions: 1 } });
      if (!post) {
        return NextResponse.json({ linked: true, itemFound: false }, { status: 404 });
      }

      const postId = post._id;
      const existing = await db
        .collection<NewsReaction>("newsReactions")
        .findOne({ postId, userId });

      let agreeChange = 0;
      let disagreeChange = 0;
      let userReaction: "agree" | "disagree" | null = null;

      if (existing) {
        if (existing.reaction === reaction) {
          await db.collection("newsReactions").deleteOne({ _id: existing._id });
          if (reaction === "agree") agreeChange = -1;
          else disagreeChange = -1;
          userReaction = null;
        } else {
          await db
            .collection("newsReactions")
            .updateOne({ _id: existing._id }, { $set: { reaction } });
          if (reaction === "agree") {
            agreeChange = 1;
            disagreeChange = -1;
          } else {
            agreeChange = -1;
            disagreeChange = 1;
          }
          userReaction = reaction;
        }
      } else {
        const doc: Omit<NewsReaction, "_id"> = { postId, userId, reaction, createdAt: new Date() };
        await db.collection("newsReactions").insertOne(doc);
        if (reaction === "agree") agreeChange = 1;
        else disagreeChange = 1;
        userReaction = reaction;
      }

      const update: Record<string, number> = {};
      if (agreeChange !== 0) update["reactions.agree"] = agreeChange;
      if (disagreeChange !== 0) update["reactions.disagree"] = disagreeChange;
      if (Object.keys(update).length > 0) {
        await db.collection("newsPosts").updateOne({ _id: postId }, { $inc: update });
      }

      const updated = await db
        .collection<NewsPost>("newsPosts")
        .findOne({ _id: postId }, { projection: { reactions: 1 } });
      return NextResponse.json({
        linked: true,
        itemFound: true,
        reactions: updated?.reactions ?? { agree: 0, disagree: 0 },
        userReaction,
      });
    }

    // suggestion
    const reaction = emoji === "👍" ? "like" : "dislike";
    const suggestions = getSuggestionsCollection(db);
    const reactionsColl = getSuggestionReactionsCollection(db);

    const suggestion = await suggestions.findOne(
      { discordMessageId: messageId },
      { projection: { _id: 1, reactions: 1 } }
    );
    if (!suggestion) {
      return NextResponse.json({ linked: true, itemFound: false }, { status: 404 });
    }

    const suggestionId = suggestion._id;
    const existing = await reactionsColl.findOne({ suggestionId, userId });

    let likeChange = 0;
    let dislikeChange = 0;
    let userReaction: "like" | "dislike" | null = null;

    if (existing) {
      if (existing.reaction === reaction) {
        await reactionsColl.deleteOne({ _id: existing._id });
        if (reaction === "like") likeChange = -1;
        else dislikeChange = -1;
        userReaction = null;
      } else {
        await reactionsColl.updateOne({ _id: existing._id }, { $set: { reaction } });
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
        suggestionId,
        userId,
        reaction,
        createdAt: new Date(),
      };
      await reactionsColl.insertOne(doc as SuggestionReaction);
      if (reaction === "like") likeChange = 1;
      else dislikeChange = 1;
      userReaction = reaction;
    }

    const update: Record<string, number> = {};
    if (likeChange !== 0) update["reactions.like"] = likeChange;
    if (dislikeChange !== 0) update["reactions.dislike"] = dislikeChange;
    if (Object.keys(update).length > 0) {
      await suggestions.updateOne({ _id: suggestionId }, { $inc: update });
    }

    const updated = await suggestions.findOne(
      { _id: suggestionId },
      { projection: { reactions: 1 } }
    );
    const counts = updated?.reactions ?? { like: 0, dislike: 0 };
    return NextResponse.json({
      linked: true,
      itemFound: true,
      reactions: { like: Math.max(0, counts.like ?? 0), dislike: Math.max(0, counts.dislike ?? 0) },
      userReaction,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
