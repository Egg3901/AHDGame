// POST /api/country/[code]/pm/no-confidence/[id]/vote — Cast an aye/nay vote on a no-confidence motion
// Auth: requireAuthWithCharacter
// Error codes: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { getParliamentaryCountryId } from "@/lib/government/parliamentaryCountry";
import { castNoConfidenceVote } from "@/lib/government/commands/parliamentaryGovernment";

const voteSchema = z.object({
  vote: z.enum(["aye", "nay"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; voteId: string }> }
) {
  try {
    const { code, voteId } = await params;
    const countryId = getParliamentaryCountryId(code);

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(
      `pm-vote:${auth.user.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    return NextResponse.json(
      await castNoConfidenceVote(db, countryId, auth.user.character, voteId, parsed.data.vote)
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
