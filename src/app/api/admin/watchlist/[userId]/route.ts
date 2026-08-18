// DELETE /api/admin/watchlist/[userId] — unpin an account.
// Auth: requireModerator (both moderators and admins can manage the
// watchlist).
// Errors: 400 (malformed userId), 403 (auth), 404 (not on the
// watchlist)
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getWatchlistCollection } from "@/lib/db/collections";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { userId } = await params;
    if (!OBJECT_ID_RE.test(userId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }

    const db = await getDb();
    const watchlistCol = await getWatchlistCollection(db);
    const result = await watchlistCol.deleteOne({ userId: new ObjectId(userId) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "User is not on the watchlist" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
