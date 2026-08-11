import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { createWikiPageSchema } from "@/lib/api/schemas/wiki";
import { isPlayerSubmittableCategory } from "@/lib/wiki/categories";
import { screenWikiContent } from "@/lib/wiki/contentFilter";
import { checkWikiCreateCooldown, formatCooldownMessage } from "@/lib/wiki/createCooldown";
import { notifyModeratorsOfWikiSubmission } from "@/lib/wiki/reviewNotifications";
import { getGameStamp } from "@/lib/wiki/gameConfig";
import type { User, WikiPage } from "@/lib/db/types";
import { ObjectId } from "mongodb";

// GET /api/wiki — Returns a list of all wiki pages with metadata (no content body).
// Auth: public (private pages hidden from non-admins); blocked when wiki is disabled
// Errors: 403
export async function GET() {
  const blocked = await checkWikiDisabled();
  if (blocked) return blocked;

  const user = await getAuthUser().catch(() => null);
  const isAdmin = user?.isAdmin === true;

  const db = await getDb();
  // Hide private pages from non-admins
  const filter: Record<string, unknown> = { status: "published" };
  if (!isAdmin) {
    filter.private = { $ne: true };
  }

  const pages = await db
    .collection<WikiPage>("wikiPages")
    .find(filter, {
      projection: {
        slug: 1,
        title: 1,
        description: 1,
        status: 1,
        tags: 1,
        featured: 1,
        private: 1,
        difficulty: 1,
        contentType: 1,
        estimatedReadTime: 1,
        updatedAt: 1,
        createdAt: 1,
      },
    })
    .sort({ slug: 1 })
    .toArray();
  const response = NextResponse.json(pages);
  if (isAdmin) {
    // The admin variant includes private/unlisted page metadata, so it varies by
    // caller and must never be stored in a shared (CDN) cache — otherwise it can
    // be replayed to non-admins (cross-user leak, #3316). The public variant below
    // is identical for every non-admin viewer and stays share-cacheable.
    response.headers.set("Cache-Control", "private, no-store");
  } else {
    response.headers.set("Cache-Control", "s-maxage=300, stale-while-revalidate=600, no-transform");
  }
  return response;
}

// POST /api/wiki — Submits a new wiki page for admin review.
// Auth: requireAuthWithCharacter; blocked when wiki is disabled
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createWikiPageSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // Moderators and admins bypass the player-category list and the 12 h
    // cooldown; anyone else must pick a valid player-submittable category.
    const isMod = user.isAdmin === true || user.role === "moderator";
    if (!isMod) {
      if (!parsed.data.category || !isPlayerSubmittableCategory(parsed.data.category)) {
        return NextResponse.json(
          {
            error:
              "A category is required. Choose one of: Characters, Corporations, Party profiles, Events, or Reference.",
          },
          { status: 400 }
        );
      }
    }

    // Basic content-safety screen (profanity, spam, link-stuffing, all-caps).
    const screen = screenWikiContent({
      title: parsed.data.title,
      description: parsed.data.description,
      content: parsed.data.content,
      tags: parsed.data.tags,
    });
    if (!screen.ok) {
      return NextResponse.json({ error: screen.reason }, { status: 400 });
    }

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");
    const userId = new ObjectId(user.userId);

    // 12 h cooldown on new page creation (edits are always allowed).
    const cooldown = await checkWikiCreateCooldown(db, userId, { bypass: isMod });
    if (!cooldown.ok) {
      return NextResponse.json(
        { error: formatCooldownMessage(cooldown), retryAfterMs: cooldown.remainingMs },
        { status: 429 }
      );
    }

    // Check slug uniqueness
    const existing = await wikiPages.findOne({ slug: parsed.data.slug });
    if (existing) {
      return NextResponse.json({ error: "A page with this slug already exists" }, { status: 400 });
    }

    const now = new Date();
    const wikiPage: Omit<WikiPage, "_id"> = {
      ...parsed.data,
      status: "pending_review", // User submissions need review
      submittedBy: userId,
      tags: parsed.data.tags || [],
      isAutoGenerated: false,
      ...getGameStamp(),
      createdAt: now,
      updatedAt: now,
      editHistory: [
        {
          userId,
          timestamp: now,
          action: "created",
        },
      ],
    };

    const result = await wikiPages.insertOne(wikiPage as unknown as WikiPage);
    const created = await wikiPages.findOne({ _id: result.insertedId });

    // Fire-and-forget notification to moderators. Don't block the response.
    const submitterDisplay = await db
      .collection<User>("users")
      .findOne({ _id: userId }, { projection: { username: 1, displayName: 1 } });
    notifyModeratorsOfWikiSubmission({
      slug: parsed.data.slug,
      title: parsed.data.title,
      submitterName: submitterDisplay?.displayName || submitterDisplay?.username || "a player",
    }).catch((err) => console.error("[wiki] moderator notify failed:", err));

    return NextResponse.json({
      success: true,
      page: created,
      slug: created?.slug,
      message: "Submitted for review",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
