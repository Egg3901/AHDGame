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
import { canInviteToCoalition, isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const inviteSchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/invite — Send an invite to a party
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

    const parsed = await parseJsonBody(request, inviteSchema);
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
      throw forbidden("Only the coalition chair can send invites.");
    }

    // Find target party
    const targetParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parsed.data.partySequentialId, countryId });
    if (!targetParty) {
      throw notFound("Target party not found.");
    }

    // One-party-state guards. Runtime governmentType so a post-Stage-4
    // conversion immediately lifts the coalition restrictions.
    const runtime = await getCountryState(db, countryId);
    const runtimeConfig = { governmentType: runtime.governmentType };
    if (runtime.governmentType === "onePartyState") {
      const invitingPartySeqId = parseInt(character.party ?? "0", 10);
      const invitingParty = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: invitingPartySeqId, countryId });
      if (!canInviteToCoalition(runtimeConfig, invitingParty)) {
        throw forbidden("Only the ruling party may invite parties to a coalition in this country.");
      }
      if (isBannedParty(runtimeConfig, targetParty)) {
        throw forbidden("Banned parties cannot be invited to a coalition.");
      }
    }

    // Reject if target party is already in a coalition
    if (targetParty.coalitionId) {
      throw badRequest("That party is already a member of a coalition.");
    }

    // Reject if target party already has a pending invite from this coalition
    const alreadyInvited = coalition.pendingInvites.some(
      (inv) => String(inv.partyId) === String(targetParty._id)
    );
    if (alreadyInvited) {
      throw badRequest("That party already has a pending invite from this coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $push: {
          pendingInvites: {
            partyId: targetParty._id,
            invitedBy: character._id,
            invitedAt: now,
          },
        },
        $set: { updatedAt: now },
      }
    );

    // Notify the target party's national chair
    if (targetParty.chairId) {
      const targetChar = await db
        .collection<Character>("characters")
        .findOne({ _id: targetParty.chairId }, { projection: { userId: 1 } });
      if (targetChar) {
        await createNotification({
          userId: targetChar.userId,
          type: "coalition_invite_received",
          title: `Coalition Invite: ${coalition.name}`,
          message: `Your party has been invited to join the coalition "${coalition.name}".`,
          metadata: {
            coalitionId: coalition._id,
            coalitionSequentialId: coalition.sequentialId,
            coalitionName: coalition.name,
            countryId,
          },
        });
      }
    }

    return NextResponse.json({ success: true, message: "Invite sent successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
