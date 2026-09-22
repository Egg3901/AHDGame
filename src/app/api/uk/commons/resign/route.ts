import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resignCommonsSeat } from "@/lib/uk/elections/commonsSeatCommands";

const NO_STORE = { "Cache-Control": "no-store, no-transform" };

// POST /api/uk/commons/resign — strategic resignation: vacate the caller's
// Commons seat so a by-election fills it. Idempotent at the shell (one live
// vacancy per seat row); a retried request after the seat is already vacant
// reports 404 with the live state so the client can refresh.
// Auth: requireAuthWithCharacter. Errors: 400, 401, 404, 409, 429.
export async function POST() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const result = await resignCommonsSeat(db, auth.user.character);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: `You have resigned from ${result.label}. A by-election will fill the seat.`,
        officialId: result.officialId.toString(),
        vacancyId: result.vacancyId.toString(),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
