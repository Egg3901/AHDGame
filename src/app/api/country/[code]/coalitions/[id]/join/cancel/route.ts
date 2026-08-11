import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";

// POST /api/coalitions/[id]/join/cancel — Cancel a pending join request
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const { character } = authResult.user;

    if (!character.party || character.party === "independent") {
      throw badRequest("You must be a member of a party to cancel a join request.");
    }

    const db = await getDb();

    // Find user's party
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(character.party), countryId });
    if (!party) {
      throw notFound("Your party could not be found.");
    }

    // Caller must be the party chair
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the national party chair (or acting vice-chair) can cancel a join request."
      );
    }

    // Find the coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Verify the party has a pending request in this coalition
    const request_ = coalition.joinRequests.find((r) => String(r.partyId) === String(party._id));
    if (!request_) {
      throw badRequest("Your party does not have a pending join request to this coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $pull: { joinRequests: { partyId: party._id } },
        $set: { updatedAt: now },
      }
    );

    return NextResponse.json({ success: true, message: "Join request cancelled" });
  } catch (error) {
    return handleRouteError(error);
  }
}
