// POST /api/prospecting/government - Fund a government geological survey (national or state).
// Auth: requireAuth (acting character) — national: head of gov / finance minister; state: governor.
// Errors: 400, 401, 402, 403, 429

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { isProspectingEnabled } from "@/lib/extraction/featureFlag";
import { launchGovernmentProspect } from "@/lib/extraction/commands/launchGovernmentProspect";
import { governmentProspectSchema } from "@/lib/api/schemas/prospecting";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    if (!(await isProspectingEnabled())) {
      return NextResponse.json({ error: "Resource prospecting is not enabled." }, { status: 403 });
    }

    const parsed = await parseJsonBody(request, governmentProspectSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const myChar = auth.user.character;
    if (!myChar) throw forbidden("Character required");

    const db = await getDb();
    const turn = await getCurrentTurn(db);
    const now = new Date();

    const result = await launchGovernmentProspect(
      db,
      parsed.data,
      { characterId: myChar._id, userId: auth.user.userId, isAdmin: auth.user.isAdmin === true },
      turn,
      now
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      survey: { ...result.survey, _id: result.survey._id.toString() },
      costs: result.costs,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
