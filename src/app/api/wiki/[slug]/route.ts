import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { updateWikiPageSchema } from "@/lib/api/schemas/wiki";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { notifyModeratorsOfWikiSubmission } from "@/lib/wiki/reviewNotifications";
import type { User, WikiPage } from "@/lib/db/types";
import { ObjectId } from "mongodb";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

// GET /api/wiki/[slug] — Returns a single wiki page by slug; drafts and pending pages are only visible to their author or admins.
// Auth: public; blocked when wiki is disabled
// Errors: 403, 404
export async function GET(request: Request, context: RouteContext) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const { slug } = await context.params;
    const user = await getAuthUser();

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");

    const page = await wikiPages.findOne({ slug });
    if (!page) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    // Private pages are admin-only
    if (page.private && !user?.isAdmin) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    // Check permissions
    if (page.status === "published") {
      // Anyone can view published (unless private, handled above)
      const canEdit =
        user &&
        page.submittedBy &&
        (user.isAdmin || page.submittedBy.equals(new ObjectId(user.userId)));
      return NextResponse.json({ page, canEdit: !!canEdit });
    }

    // Drafts/pending only visible to author or admin
    if (!user) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    const isAuthor = page.submittedBy && page.submittedBy.equals(new ObjectId(user.userId));
    const isAdmin = user.isAdmin;

    if (!isAuthor && !isAdmin) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    return NextResponse.json({ page, canEdit: isAuthor || isAdmin });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/wiki/[slug] — Author edits their own page. Publication status,
// featured flag, and admin-only toggles are ignored; edits to a published page
// send it back to `pending_review`. Admins use /api/admin/wiki/[slug] instead.
// Auth: requireAuthWithCharacter; blocked when wiki is disabled
// Errors: 400, 401, 403, 404, 429
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { slug } = await context.params;
    const parsed = await parseJsonBody(request, updateWikiPageSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");
    const page = await wikiPages.findOne({ slug });
    if (!page) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    const userId = new ObjectId(user.userId);
    const isAuthor = !!page.submittedBy && page.submittedBy.equals(userId);
    if (!isAuthor) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Authors cannot set status/featured/private themselves.
    const {
      status: _ignoredStatus,
      featured: _ignoredFeatured,
      private: _ignoredPrivate,
      ...authorEditable
    } = parsed.data;
    void _ignoredStatus;
    void _ignoredFeatured;
    void _ignoredPrivate;

    const now = new Date();
    const update: Record<string, unknown> = {
      ...authorEditable,
      updatedAt: now,
    };
    // Published pages re-enter review after an author edit.
    const wasPublished = page.status === "published";
    if (wasPublished) {
      update.status = "pending_review";
    }

    await wikiPages.updateOne(
      { _id: page._id },
      {
        $set: update,
        $push: {
          editHistory: {
            userId,
            timestamp: now,
            action: "edited",
          },
        },
      }
    );

    const updated = await wikiPages.findOne({ _id: page._id });

    // Edits that flip a page back into review need the moderator queue ping —
    // otherwise the submission sits silent until someone happens to check.
    if (wasPublished) {
      const submitter = await db
        .collection<User>("users")
        .findOne({ _id: userId }, { projection: { username: 1, displayName: 1 } });
      notifyModeratorsOfWikiSubmission({
        slug,
        title: updated?.title ?? page.title,
        submitterName: submitter?.displayName || submitter?.username || "a player",
      }).catch((err) => console.error("[wiki] edit notify failed:", err));
    }

    revalidatePath(`/wiki/${slug}`);
    return NextResponse.json({ success: true, page: updated, slug: updated?.slug });
  } catch (error) {
    return handleRouteError(error);
  }
}
