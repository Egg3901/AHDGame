import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import { blockPlayer, unblockPlayer } from "@/lib/safety/playerSafety";

type Params = { params: Promise<{ characterId: string }> };

// POST /api/players/[characterId]/block — Block the player who owns this character
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export const POST = withNoStore(async function POST(_request: Request, { params }: Params) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(`player-block:${auth.user.userId}`, 30, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const { characterId } = await params;
    const db = await getDb();
    const result = await blockPlayer(db, auth.user.userId, characterId);
    invalidateCachedUser(auth.user.userId);
    return NextResponse.json({ success: true, blocked: true, ...result });
  } catch (err) {
    return handleRouteError(err);
  }
});

// DELETE /api/players/[characterId]/block — Unblock the player who owns this character
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export const DELETE = withNoStore(async function DELETE(_request: Request, { params }: Params) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(`player-block:${auth.user.userId}`, 30, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const { characterId } = await params;
    const db = await getDb();
    await unblockPlayer(db, auth.user.userId, { characterId });
    invalidateCachedUser(auth.user.userId);
    return NextResponse.json({ success: true, blocked: false });
  } catch (err) {
    return handleRouteError(err);
  }
});
