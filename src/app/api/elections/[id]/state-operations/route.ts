import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { buildStateOperations } from "@/lib/elections/primaryStateOperations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/elections/[id]/state-operations — the state operations hub for the
// signed-in candidate: their positives, the field, and what is live in both
// directions. Fetched lazily by the campaign manager.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 429
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    // Its own read budget, matching the other reads this screen makes. The
    // shared `election:` bucket is 20 a minute and every other member of it is
    // an action the player takes; browsing must not starve acting.
    const rateLimit = checkRateLimit(auth.user.userId, 60, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();

    // A race is addressed either by ObjectId or by seat slug ("US-president").
    const resolved = await resolveElectionRouteParam(db, id);
    if (!resolved.ok) {
      const invalid = resolved.reason === "invalid_id";
      return NextResponse.json(
        { error: invalid ? "Invalid election id" : "Election not found" },
        { status: invalid ? 400 : 404 }
      );
    }

    const view = await buildStateOperations(db, {
      election: resolved.election,
      character: auth.user.character,
    });
    if (!view) {
      return NextResponse.json({ error: "Nothing to act on in this race" }, { status: 404 });
    }

    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/elections/[id]/state-operations",
    });
  }
}
