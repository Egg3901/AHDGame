// POST /api/country/[code]/pm/no-confidence — Propose a no-confidence motion against the sitting PM
// Auth: requireAuthWithCharacter
// Error codes: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, ELECTION_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  assertConfidenceVoteMechanism,
  getParliamentaryCountryId,
} from "@/lib/government/parliamentaryCountry";
import { proposeNoConfidence } from "@/lib/government/commands/parliamentaryGovernment";

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = getParliamentaryCountryId(code);
    assertConfidenceVoteMechanism(countryId);

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(
      `pm-noconf:${auth.user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    return NextResponse.json(
      await proposeNoConfidence(db, countryId, auth.user.userId, {
        _id: auth.user.character._id,
        name: auth.user.character.name,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
