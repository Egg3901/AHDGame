import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import type { NewsPost } from "@/lib/db/types";
import { withPublicNewsVisibility } from "@/lib/news/publicModeration";

// GET /api/public/v1/news?limit=N&category=CATEGORY
// Accuracy fixes vs /discord-bot/news: full content (not truncated), countryId included.
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "news");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);
    const category = url.searchParams.get("category") ?? undefined;

    const query: Filter<NewsPost> = {};
    if (category) query.category = category as NewsPost["category"];

    const db = await getDb();
    const posts = await db
      .collection<NewsPost>("newsPosts")
      .find(withPublicNewsVisibility(query))
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const result = (posts as Array<Record<string, unknown>>).map((p) => ({
      id: (p._id as { toString(): string }).toString(),
      title: (p.title as string) ?? null,
      content: (p.content as string) ?? null,
      authorName: (p.authorName as string) ?? null,
      isSystem: (p.isSystem as boolean) ?? false,
      category: (p.category as string) ?? null,
      countryId: (p.countryId as string) ?? null,
      stateId: (p.stateId as string) ?? null,
      reactions: p.reactions ?? null,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : null,
    }));

    return NextResponse.json({ ok: true, found: result.length > 0, posts: result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
