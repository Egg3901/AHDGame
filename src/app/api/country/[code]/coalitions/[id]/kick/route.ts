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

const kickSchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/kick?country= — Kick a member party from the coalition
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

    const parsed = await parseJsonBody(request, kickSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Find coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Caller must be the coalition chair
    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can kick members.");
    }

    // Find target party
    const targetParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parsed.data.partySequentialId, countryId });
    if (!targetParty) {
      throw notFound("Target party not found.");
    }

    // Can't self-kick the chair party
    if (String(coalition.chairPartyId) === String(targetParty._id)) {
      throw badRequest("The coalition chair cannot kick their own party.");
    }

    // Verify target is a member
    const isMember = coalition.members.some((m) => String(m.partyId) === String(targetParty._id));
    if (!isMember) {
      throw badRequest("That party is not a member of this coalition.");
    }

    const now = new Date();

    // Remove from coalition members
    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $pull: { members: { partyId: targetParty._id } },
        $set: { updatedAt: now },
      }
    );

    // Clear coalitionId on the kicked party only if it actually pointed at this coalition.
    // Pre-fix data could have a party listed in coalition A.members[] while coalitionId
    // points at coalition B; an unconditional clear would orphan them from B.
    if (targetParty.coalitionId && targetParty.coalitionId.equals(coalition._id)) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: targetParty._id }, { $set: { coalitionId: null } });
    }

    // Notify the kicked party's chair
    if (targetParty.chairId) {
      const kickedChairChar = await db
        .collection<Character>("characters")
        .findOne({ _id: targetParty.chairId }, { projection: { userId: 1 } });
      if (kickedChairChar) {
        await createNotification({
          userId: kickedChairChar.userId,
          type: "coalition_kicked",
          title: `Kicked from Coalition: ${coalition.name}`,
          message: `Your party has been removed from the coalition "${coalition.name}".`,
          metadata: {
            coalitionId: coalition._id,
            coalitionSequentialId: coalition.sequentialId,
            coalitionName: coalition.name,
            countryId,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
