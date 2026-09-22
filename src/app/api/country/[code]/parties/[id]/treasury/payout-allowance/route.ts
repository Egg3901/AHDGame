import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSameCountry } from "@/lib/api/sameCountry";
import { parseObjectId } from "@/lib/utils/objectId";
import type { Character } from "@/lib/db/types";
import { isPartyOfficer } from "@/lib/parties/pendingTreasuryTransactions";
import { getPlayerPayoutThisTurn } from "@/lib/treasury/payoutCap";
import { countDistinctOfficers, getEffectivePlayerPayoutCap } from "@/lib/treasury/payoutCapValues";
import { getGameTime } from "@/lib/time/gameTime";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

const querySchema = z.object({
  /** Omit to ask about yourself, which is the Request Funds case. */
  characterId: z.string().min(1).optional(),
});

// GET /api/country/[code]/parties/[id]/treasury/payout-allowance
//     ?characterId=<id>   (omit for your own)
//
// How much more party money one member may receive this turn: the
// country's per-player cap, what they have already drawn, and the
// difference. Drives the readouts on Send to Member and Request Funds,
// which previously printed the flat cap and left the player to discover
// at submit time that most of it was already spent.
//
// The figure is combined across the national treasury, every state
// party and every caucus, exactly as `checkPlayerPayoutCap` computes it
// at execution, so the number shown is the number enforced.
//
// Auth: requireAuthWithCharacter. A member may ask about THEMSELVES
// (that is the Request Funds case). Asking about anyone else requires
// an officer seat on this party AND that the subject is a member of it,
// matching the send route this figure serves. Without both halves any
// player could read any other player's treasury intake, or an officer
// could read a rival party's.
// Errors: 400, 401, 403, 404, 429
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult;

    const rateLimit = checkRateLimit(user.userId, 60, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const raw = new URL(request.url).searchParams.get("characterId");
    const parsed = querySchema.safeParse(raw == null ? {} : { characterId: raw });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid characterId" }, { status: 400 });
    }
    const targetId =
      parsed.data.characterId == null ? user.character._id : parseObjectId(parsed.data.characterId);
    if (!targetId) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    if (!isSameCountry(user.character, { countryId })) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const isSelf = user.character._id.equals(targetId);
    if (!isSelf) {
      if (!isPartyOfficer(party, user.character._id)) {
        return NextResponse.json(
          { error: "Only an officer can read another member's payout allowance." },
          { status: 403 }
        );
      }
      // Scoped to this party's own members, matching the send route this
      // figure exists to serve. Without it an officer could read the
      // treasury intake of anyone in the country, rival parties included,
      // which is a good deal more than pricing a payment needs.
      const target = await db
        .collection<Character>("characters")
        .findOne({ _id: targetId }, { projection: { party: 1, countryId: 1 } });
      if (!target) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      if (target.party !== String(party.sequentialId) || !isSameCountry(target, { countryId })) {
        return NextResponse.json(
          { error: "Character is not a member of this party" },
          { status: 400 }
        );
      }
    }

    const { currentTurn } = await getGameTime();
    const seatedOfficers = countDistinctOfficers([
      party.chairId?.toString(),
      party.viceChairId?.toString(),
      party.treasurerId?.toString(),
    ]);
    const cap = getEffectivePlayerPayoutCap(countryId, seatedOfficers);
    const used = await getPlayerPayoutThisTurn(db, targetId, countryId, currentTurn);

    return NextResponse.json({
      characterId: targetId.toString(),
      cap,
      used,
      remaining: Math.max(0, cap - used),
      // Sent so the cards can explain WHY the ceiling is what it is
      // rather than just printing a number that changes when a seat is
      // filled or vacated.
      seatedOfficers,
      currentTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
