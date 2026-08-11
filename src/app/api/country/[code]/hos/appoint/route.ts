// GET  /api/country/[code]/hos/appoint — List eligible head-of-state candidates
// POST /api/country/[code]/hos/appoint — Initiate a head-of-state appointment nomination
// (RU Chairman of the Presidium — countries with headOfStateSelection
// "legislatureAppointment"; spec §2.3. Votes are cast through the shared
// /pm/appoint/[voteId]/vote route — the vote docs live in the same collection.)
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
import { getHosAppointmentCandidates } from "@/lib/government/queries/parliamentaryGovernment";
import { proposeHosAppointment } from "@/lib/government/commands/parliamentaryGovernment";

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
      await getHosAppointmentCandidates(db, countryId, auth.user.character._id)
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
      `hos-appoint:${auth.user.userId}`,
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
      await proposeHosAppointment(
        db,
        countryId,
        auth.user.character,
        parsed.data.nomineeCharacterId
      )
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
