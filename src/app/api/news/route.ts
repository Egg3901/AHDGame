import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser() in GET
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { createNewsPost } from "@/lib/news/commands/newsCommands";
import { getNewsFeed } from "@/lib/news/queries/newsQueries";

const createPostSchema = z.object({
  title: z.string().max(100).trim().optional(),
  content: z.string().min(1).max(1000).trim(),
  feedType: z.enum(["article", "advertisement"]).default("article"),
  imageUrl: z.string().max(2048).optional(),
});

// GET /api/news — List recent news posts (`feed=article|advertisement|ticker`), optional author filter, pagination, reactions.
// Auth: public
// Errors: (none)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const offsetRaw = Number.parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const authorId = searchParams.get("authorId");
    const feedParam = searchParams.get("feed") ?? "article";

    const db = await getDb();
    const user = await getAuthUser();

    return NextResponse.json(
      await getNewsFeed(db, {
        limit,
        offset,
        authorId,
        feed: feedParam,
        userId: user?.userId ?? null,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/news — Create a player post: free `article` (12h cooldown) or paid `advertisement` (5 AP, $100k personal cash, 30m cooldown).
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createPostSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    return NextResponse.json(
      await createNewsPost(db, {
        userId: auth.user.userId,
        ...parsed.data,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
