import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";
import { applyCharacterPartyJoin } from "@/lib/parties/applyCharacterPartyJoin";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const bodySchema = z.object({
  action: z.enum(["accept", "decline"]),
  characterId: z.string().refine((v) => ObjectId.isValid(v), "Invalid character id"),
});

// POST /api/country/[code]/parties/[id]/join-requests — accept or decline a
// pending join request on an approval-gated party (suggestion #72).
// Auth: requireAuthWithCharacter, must be party chair (or acting vice-chair).
// Errors: 400, 401, 403, 404, 429
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

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action } = parsed.data;
    const requesterId = new ObjectId(parsed.data.characterId);

    const db = await getDb();

    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      throw notFound("Party not found.");
    }

    // Only the party chair (or acting vice-chair when the seat is vacant) may
    // resolve join requests — same authority check as every other chair action.
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the party chair (or acting vice-chair) can accept or decline join requests."
      );
    }

    // The character must have a pending request on this party.
    const hasRequest = (party.pendingJoinRequests ?? []).some((r) =>
      r.characterId.equals(requesterId)
    );
    if (!hasRequest) {
      throw badRequest("That character does not have a pending join request for this party.");
    }

    const now = new Date();

    // Helper to drop the request (used by every terminal branch below).
    const removeRequest = () =>
      db
        .collection<PoliticalParty>("politicalParties")
        .updateOne(
          { _id: party._id },
          { $pull: { pendingJoinRequests: { characterId: requesterId } }, $set: { updatedAt: now } }
        );

    const requester = await db.collection<Character>("characters").findOne({ _id: requesterId });

    if (action === "decline") {
      await removeRequest();
      if (requester) {
        await createNotification({
          userId: requester.userId,
          type: "party_join_declined",
          title: `Join Request Declined: ${party.name}`,
          message: `Your request to join the ${party.name} was declined.`,
          metadata: { partyId: party.sequentialId, partyName: party.name, countryId },
        });
      }
      return NextResponse.json({ success: true, message: "Join request declined." });
    }

    // action === "accept"
    // Stale-request cleanup: the character may have been deleted, or moved to a
    // different country, since asking to join. Drop the request and stop.
    if (!requester || !isSameCountry(requester, party)) {
      await removeRequest();
      return NextResponse.json({
        success: true,
        message: "That character is no longer eligible to join; the request was removed.",
      });
    }

    // Already a member of this party — nothing to do beyond clearing the request.
    if (requester.party === String(party.sequentialId)) {
      await removeRequest();
      return NextResponse.json({ success: true, message: "That character is already a member." });
    }

    const currentTurn = await getCurrentTurn(db);

    // Apply the membership move via the shared join path so the approved join
    // runs the exact same side effects as an immediate join. A leader is
    // approving, so never auto-promote the newcomer to a vacant chair seat.
    await applyCharacterPartyJoin({
      db,
      character: requester,
      party,
      countryId,
      currentTurn,
      now,
      autoChairWhenVacant: false,
      actor: character,
      actorRole: "chair",
    });

    await removeRequest();

    await createNotification({
      userId: requester.userId,
      type: "party_join_accepted",
      title: `Join Request Accepted: ${party.name}`,
      message: `You have been accepted into the ${party.name}.`,
      metadata: { partyId: party.sequentialId, partyName: party.name, countryId },
    });

    return NextResponse.json({ success: true, message: `${requester.name} has joined the party.` });
  } catch (error) {
    return handleRouteError(error);
  }
}
