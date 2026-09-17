import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { defectCommonsSeat } from "@/lib/uk/elections/commonsSeatCommands";

const NO_STORE = { "Cache-Control": "no-store, no-transform" };

const defectSchema = z.object({ toParty: z.string().min(1).max(120) }).strict();

// POST /api/uk/commons/defect — cross the floor: the caller keeps playing
// under a new party and the Commons seat behind them goes to by-election.
// Auth: requireAuthWithCharacter. Errors: 400, 401, 404, 409, 429.
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, defectSchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), {
        status: parsed.status,
        headers: NO_STORE,
      });
    }

    const db = await getDb();
    const result = await defectCommonsSeat(db, auth.user.character, parsed.data.toParty);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: `You have defected. Your former seat goes to by-election.`,
        officialId: result.officialId.toString(),
        vacancyId: result.vacancyId.toString(),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
