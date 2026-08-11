// GET /api/admin/watchlist — list pinned accounts with a recent activity
// summary + "new since last review" alerts.
// POST /api/admin/watchlist — pin an account. Body: { userId, reason? }.
//
// Auth: requireModerator (forensics v2 plan: both moderators and admins can
// manage the watchlist — it's a bookmark list, not a scoring/config surface
// like `/api/admin/alts/config`).
//
// Response shapes (see `src/lib/audit/watchlist.ts` for the alert-detection
// logic and the full `WatchlistEntryView` fields):
//   GET  -> { entries: WatchlistEntryView[], currentTurn }
//   POST -> { entry: WatchlistEntryView } (201), or 409 if already watched,
//            404 if userId doesn't resolve to a real user, 400 on bad input
import { NextResponse } from "next/server";
import { ObjectId, type MongoServerError } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  getWatchlistCollection,
  getUsersCollection,
  getGameStateCollection,
} from "@/lib/db/collections";
import { buildWatchlistViews } from "@/lib/audit/watchlist";
import type { WatchlistEntry } from "@/lib/db/types/watchlist";

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const MAX_REASON_LENGTH = 500;
/** Mongo duplicate-key error code, thrown by the unique `userId` index on a
 * racing concurrent add. */
const DUPLICATE_KEY_CODE = 11000;

const postBodySchema = z.object({
  userId: z.string().optional(),
  reason: z.string().optional(),
});

export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const isAdmin = auth.user.isAdmin === true;

    const db = await getDb();
    const [watchlistCol, gameStateCol] = await Promise.all([
      getWatchlistCollection(db),
      getGameStateCollection(db),
    ]);

    const [entries, gameState] = await Promise.all([
      watchlistCol.find({}).sort({ createdAt: -1 }).toArray(),
      gameStateCol.findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
    ]);

    const views = await buildWatchlistViews(db, entries, isAdmin);

    return NextResponse.json({ entries: views, currentTurn: gameState?.currentTurn ?? 0 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, postBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!OBJECT_ID_RE.test(userId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
        : undefined;

    const db = await getDb();
    const usersCol = await getUsersCollection(db);
    const targetUser = await usersCol.findOne(
      { _id: new ObjectId(userId) },
      { projection: { _id: 1 } }
    );
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const watchlistCol = await getWatchlistCollection(db);
    const existing = await watchlistCol.findOne({ userId: new ObjectId(userId) });
    if (existing) {
      return NextResponse.json({ error: "User is already on the watchlist" }, { status: 409 });
    }

    const entry: WatchlistEntry = {
      _id: new ObjectId(),
      userId: new ObjectId(userId),
      addedBy: new ObjectId(auth.user.userId),
      createdAt: new Date(),
      ...(reason ? { reason } : {}),
    };

    try {
      await watchlistCol.insertOne(entry);
    } catch (error) {
      // Race: the unique userId index catches a concurrent duplicate add
      // that slipped past the findOne check above.
      if ((error as MongoServerError)?.code === DUPLICATE_KEY_CODE) {
        return NextResponse.json({ error: "User is already on the watchlist" }, { status: 409 });
      }
      throw error;
    }

    const isAdmin = auth.user.isAdmin === true;
    const [view] = await buildWatchlistViews(db, [entry], isAdmin);

    return NextResponse.json({ entry: view }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
