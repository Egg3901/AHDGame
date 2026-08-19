import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import type { ObjectId } from "mongodb";
import type { User, WikiPage } from "@/lib/db/types";

// GET /api/admin/wiki/review-queue — Returns all wiki pages with pending_review status awaiting moderation.
// Auth: requireModerator (admin or moderator)
// Errors: 403
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");

    const pending = await wikiPages
      .find({ status: "pending_review" })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Resolve submitter display names so the review UI doesn't need a second round trip.
    const submitterIds = Array.from(
      new Set(pending.map((p) => p.submittedBy).filter((id): id is ObjectId => !!id))
    );
    const users = submitterIds.length
      ? await db
          .collection<User>("users")
          .find({ _id: { $in: submitterIds } })
          .project<{ _id: ObjectId; username?: string; displayName?: string }>({
            username: 1,
            displayName: 1,
          })
          .toArray()
      : [];
    const nameById = new Map(
      users.map((u) => [u._id.toString(), u.displayName || u.username || "Unknown"])
    );

    const enriched = pending.map((p) => ({
      ...p,
      submitterName: p.submittedBy
        ? (nameById.get(p.submittedBy.toString()) ?? "Unknown")
        : "System",
    }));

    return NextResponse.json({ pending: enriched });
  } catch (error) {
    return handleRouteError(error);
  }
}
