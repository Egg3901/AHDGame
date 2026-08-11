import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const declineSchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/join/decline — Decline a join request (coalition chair only)
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

    const parsed = await parseJsonBody(request, declineSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Find coalition, verify caller is coalition chair
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can decline join requests.");
    }

    // Find the requesting party
    const requestingParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parsed.data.partySequentialId, countryId });
    if (!requestingParty) {
      throw notFound("Requesting party not found.");
    }

    // Verify the party has a pending request in this coalition
    const joinRequest = coalition.joinRequests.find(
      (r) => String(r.partyId) === String(requestingParty._id)
    );
    if (!joinRequest) {
      throw badRequest("That party does not have a pending join request to this coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $pull: { joinRequests: { partyId: requestingParty._id } },
        $set: { updatedAt: now },
      }
    );

    // Notify the requesting party's chair
    if (requestingParty.chairId) {
      const chairChar = await db
        .collection<Character>("characters")
        .findOne({ _id: requestingParty.chairId }, { projection: { userId: 1 } });
      if (chairChar) {
        await createNotification({
          userId: chairChar.userId,
          type: "coalition_join_declined",
          title: `Join Request Declined: ${coalition.name}`,
          message: `Your party's request to join the coalition "${coalition.name}" was declined.`,
          metadata: {
            coalitionId: coalition._id,
            coalitionSequentialId: coalition.sequentialId,
            coalitionName: coalition.name,
            countryId,
            partyName: requestingParty.name,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
