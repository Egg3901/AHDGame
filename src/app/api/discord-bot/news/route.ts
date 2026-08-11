import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import type { NewsPost } from "@/lib/db/types";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
const CONTENT_PREVIEW_LENGTH = 200;

// GET /api/discord-bot/news — Returns recent top-level news posts, optionally filtered by category.
// Auth: requireAdminOrApiKey
// Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:news",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "5", 10), 10);
    const category = url.searchParams.get("category"); // "election" | "legislation" | "executive" | "general"

    // Top-level posts only (no replies); exclude paid placements from the bot feed
    const query: Record<string, unknown> = {
      parentId: { $exists: false },
      feedType: { $ne: "advertisement" },
    };
    if (category) query.category = category;

    const db = await getDb();

    const posts = await db
      .collection<NewsPost>("newsPosts")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    if (posts.length === 0) {
      return NextResponse.json({ found: false, posts: [] });
    }

    const results = posts.map((post) => ({
      id: post._id.toString(),
      title: post.title ?? null,
      content:
        post.content.length > CONTENT_PREVIEW_LENGTH
          ? post.content.slice(0, CONTENT_PREVIEW_LENGTH) + "…"
          : post.content,
      authorName: post.authorName,
      isSystem: post.isSystem ?? false,
      category: post.category ?? null,
      stateId: post.stateId ?? null,
      reactions: post.reactions,
      createdAt: post.createdAt.toISOString(),
      postUrl: `${BASE_URL}/news/${post._id}`,
    }));

    return NextResponse.json({ found: true, posts: results });
  } catch (error) {
    return handleRouteError(error);
  }
}
