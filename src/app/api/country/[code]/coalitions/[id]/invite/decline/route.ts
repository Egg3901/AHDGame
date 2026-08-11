import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";

// POST /api/coalitions/[id]/invite/decline — Decline a coalition invite
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
      throw badRequest("You must be a member of a party to decline a coalition invite.");
    }

    const db = await getDb();

    // Find coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Find the character's party
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(character.party), countryId });
    if (!party) {
      throw notFound("Your party could not be found.");
    }

    // Caller must be the party chair
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the national party chair (or acting vice-chair) can decline a coalition invite."
      );
    }

    // Verify the party has a pending invite from this coalition
    const invite = coalition.pendingInvites.find(
      (inv) => String(inv.partyId) === String(party._id)
    );
    if (!invite) {
      throw badRequest("Your party does not have a pending invite from this coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $pull: { pendingInvites: { partyId: party._id } },
        $set: { updatedAt: now },
      }
    );

    // Notify coalition chair
    const chairChar = coalition.chairCharacterId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: coalition.chairCharacterId }, { projection: { userId: 1 } })
      : null;
    if (chairChar) {
      await createNotification({
        userId: chairChar.userId,
        type: "coalition_invite_declined",
        title: `Invite Declined: ${party.name}`,
        message: `${party.name} has declined your invitation to join "${coalition.name}".`,
        metadata: {
          coalitionId: coalition._id,
          coalitionSequentialId: coalition.sequentialId,
          coalitionName: coalition.name,
          partyId: party._id,
          partyName: party.name,
          countryId,
        },
      });
    }

    return NextResponse.json({ success: true, message: "Invite declined" });
  } catch (error) {
    return handleRouteError(error);
  }
}
