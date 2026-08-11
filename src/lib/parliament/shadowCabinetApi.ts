// Shadow Cabinet appointment handlers (player suggestion #52).
//
// The resolved Leader of the Opposition names characters to shadow versions of
// the country's real cabinet posts. This is a display / roleplay slice: the
// shadow cabinet is stored on the opposition party document and is NEVER read
// by the turn engine — no mechanical or gameplay effect.
//
// Authorization reuses the exact Opposition Leader resolution the executive hub
// renders (`resolveOppositionLeaderForCountry`), so only the displayed Leader of
// the Opposition may appoint or clear a shadow post — never a weaker check.

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveCabinetRoster } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getCountryState } from "@/lib/countryState";
import { type CountryId } from "@/lib/constants/countries";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { ShadowCabinetAppointment } from "@/lib/db/types/party";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { resolveOppositionLeaderForCountry } from "@/lib/parliament/oppositionLeader";
import { getEligibleCabinetCharacters } from "@/lib/uk/cabinetEligibility";

const appointSchema = z.object({
  positionId: z.string(),
  characterId: z.string().regex(/^[a-f0-9]{24}$/, "Invalid character ID"),
});

const clearSchema = z.object({
  positionId: z.string(),
});

/**
 * Authorize the caller as the sitting Leader of the Opposition and return the
 * opposition party document that owns the shadow cabinet.
 *
 * Shadow cabinets exist only for the multiparty parliamentary hub
 * (`parliamentaryMonarchy` / `parliamentaryRepublic`) — one-party states and
 * presidential systems have no Opposition Leader concept, so they are rejected
 * up front. Throws an `ApiError` (handled by the caller's `handleRouteError`).
 */
async function authorizeOppositionLeader(
  db: Awaited<ReturnType<typeof getDb>>,
  countryId: CountryId,
  authUserId: string
): Promise<{ oppositionParty: PoliticalParty }> {
  const runtime = await getCountryState(db, countryId);
  if (
    runtime.governmentType !== "parliamentaryMonarchy" &&
    runtime.governmentType !== "parliamentaryRepublic"
  ) {
    throw notFound("Shadow cabinet is only available in parliamentary governments");
  }

  const unauthorized = "Only the Leader of the Opposition may manage the shadow cabinet";
  if (!ObjectId.isValid(authUserId)) throw forbidden(unauthorized);

  const callerCharacter = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(authUserId) });
  if (!callerCharacter) throw forbidden(unauthorized);

  const opposition = await resolveOppositionLeaderForCountry(db, countryId);
  if (!opposition) throw forbidden("There is no sitting Leader of the Opposition");
  if (!opposition.chairId.equals(callerCharacter._id)) throw forbidden(unauthorized);
  if (!opposition.partyDoc) {
    // A coalition with no resolvable member party has nowhere to store the
    // shadow cabinet; treat as a transient no-opposition-party state.
    throw forbidden("The opposition has no party to hold a shadow cabinet");
  }

  return { oppositionParty: opposition.partyDoc };
}

/** Cabinet posts that can be shadowed — every position except the head of
 *  government (the Opposition Leader is themselves the shadow head). Era-gated
 *  seats are excluded at the live year: no shadowing offices that don't exist. */
function shadowablePositions(countryId: CountryId, liveYear: number | null) {
  return resolveCabinetRoster(getCabinetPositions(countryId), liveYear).filter(
    (position) => !position.isHeadOfGovernment
  );
}

export async function appointShadowCabinetHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success) throw badRequest(parsed.error);
    const { positionId, characterId: characterIdStr } = parsed.data;

    const db = await getDb();
    const { oppositionParty } = await authorizeOppositionLeader(db, countryId, auth.user.userId);

    // Validate the position id against the country's cabinet config (era-gated
    // at the live year — no shadow appointments to offices that don't exist).
    const position = shadowablePositions(countryId, await getLiveGameYear(db)).find(
      (candidate) => candidate.id === positionId
    );
    if (!position) throw badRequest("Invalid cabinet position");

    // Validate the appointee is a real eligible character. Reuse the exact
    // eligibility the real cabinet uses (seated player, not the head of
    // government, not already a sitting minister); the sitting PM is excluded so
    // the head of government cannot be shadow-appointed.
    const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
    const pmCharacterId = govFormation?.pmCharacterId ?? new ObjectId();
    const eligible = await getEligibleCabinetCharacters(db, countryId, pmCharacterId);
    const chosen = eligible.find((candidate) => candidate._id === characterIdStr);
    if (!chosen) throw forbidden("That character is not eligible for the shadow cabinet");

    // One character cannot hold two shadow posts at once.
    const existing = oppositionParty.shadowCabinet ?? {};
    for (const [heldPositionId, appointment] of Object.entries(existing)) {
      if (heldPositionId !== positionId && appointment.characterId.toString() === characterIdStr) {
        throw forbidden("That character already holds another shadow cabinet post");
      }
    }

    const appointment: ShadowCabinetAppointment = {
      characterId: new ObjectId(characterIdStr),
      characterName: chosen.name,
      appointedAt: new Date(),
    };
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: oppositionParty._id },
        { $set: { [`shadowCabinet.${positionId}`]: appointment, updatedAt: new Date() } }
      );

    return NextResponse.json({
      success: true,
      positionId,
      appointment: { characterId: characterIdStr, characterName: chosen.name },
      message: `${chosen.name} appointed as Shadow ${position.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function clearShadowCabinetHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, clearSchema);
    if (!parsed.success) throw badRequest(parsed.error);
    const { positionId } = parsed.data;

    const db = await getDb();
    const { oppositionParty } = await authorizeOppositionLeader(db, countryId, auth.user.userId);

    // Clearing is deliberately NOT era-gated (null year → full roster): a
    // shadow post held on a seat that has since retired must stay clearable.
    const position = shadowablePositions(countryId, null).find(
      (candidate) => candidate.id === positionId
    );
    if (!position) throw badRequest("Invalid cabinet position");

    if (!oppositionParty.shadowCabinet?.[positionId]) {
      throw notFound("That shadow cabinet post is already vacant");
    }

    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: oppositionParty._id },
        { $unset: { [`shadowCabinet.${positionId}`]: "" }, $set: { updatedAt: new Date() } }
      );

    return NextResponse.json({
      success: true,
      positionId,
      message: `Shadow ${position.name} cleared`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
