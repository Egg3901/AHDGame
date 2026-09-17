import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getResignablePositions } from "@/lib/settings/resignations";

// GET /api/settings/resignable-positions
// Returns the authenticated character's current political positions.
export async function GET() {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const positions = await getResignablePositions(db, authResult.user.character);
    return NextResponse.json({ positions });
  } catch (error) {
    return handleRouteError(error);
  }
}
