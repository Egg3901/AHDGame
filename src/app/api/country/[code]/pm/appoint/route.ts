// GET  /api/country/[code]/pm/appoint — List eligible PM candidates
// POST /api/country/[code]/pm/appoint — Initiate a PM appointment nomination
// Auth: requireAuthWithCharacter
// Error codes: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, ELECTION_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { getParliamentaryCountryId } from "@/lib/government/parliamentaryCountry";
import { getPmAppointmentCandidates } from "@/lib/government/queries/parliamentaryGovernment";
import { proposePmAppointment } from "@/lib/government/commands/parliamentaryGovernment";

const appointSchema = z.object({
  nomineeCharacterId: schemas.objectId,
});

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = getParliamentaryCountryId(code);

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    return NextResponse.json(
      await getPmAppointmentCandidates(db, countryId, auth.user.character._id)
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = getParliamentaryCountryId(code);

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(
      `pm-appoint:${auth.user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    return NextResponse.json(
      await proposePmAppointment(db, countryId, auth.user.character, parsed.data.nomineeCharacterId)
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
