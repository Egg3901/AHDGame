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
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";

const transferSchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/transfer?country= — Transfer coalition chair to another member party
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

    const parsed = await parseJsonBody(request, transferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    // Find coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Caller must be the coalition chair
    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can transfer chair status.");
    }

    // Find target party
    const targetParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parsed.data.partySequentialId, countryId });
    if (!targetParty) {
      throw notFound("Target party not found.");
    }

    // Can't transfer to self
    if (String(coalition.chairPartyId) === String(targetParty._id)) {
      throw badRequest("That party is already the coalition chair.");
    }

    // Verify target is a current member
    const isMember = coalition.members.some((m) => String(m.partyId) === String(targetParty._id));
    if (!isMember) {
      throw badRequest("The target party is not a member of this coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $set: {
          chairPartyId: targetParty._id,
          ...(targetParty.chairId ? { chairCharacterId: targetParty.chairId } : {}),
          updatedAt: now,
        },
      }
    );

    // Notify new chair
    if (targetParty.chairId) {
      const newChairChar = await db
        .collection<Character>("characters")
        .findOne({ _id: targetParty.chairId }, { projection: { userId: 1 } });
      if (newChairChar) {
        await createNotification({
          userId: newChairChar.userId,
          type: "coalition_chair_transferred",
          title: `You are now Coalition Chair: ${coalition.name}`,
          message: `The coalition chair of "${coalition.name}" has been transferred to your party.`,
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
