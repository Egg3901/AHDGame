import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { withNoStore } from "@/lib/api/withNoStore";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import { listBlockedPlayers, unblockPlayer } from "@/lib/safety/playerSafety";

const unblockSchema = z.object({ userId: z.string().regex(/^[0-9a-f]{24}$/) });

// GET /api/settings/blocked-players — The signed-in player's block list
// Auth: requireBasicAuth
// Errors: 401
export const GET = withNoStore(async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    return NextResponse.json({ players: await listBlockedPlayers(db, auth.user.userId) });
  } catch (err) {
    return handleRouteError(err);
  }
});

// DELETE /api/settings/blocked-players — Unblock a player from the Settings list
// Auth: requireBasicAuth
// Errors: 400, 401
export const DELETE = withNoStore(async function DELETE(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, unblockSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    await unblockPlayer(db, auth.user.userId, { userId: parsed.data.userId });
    invalidateCachedUser(auth.user.userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
});
