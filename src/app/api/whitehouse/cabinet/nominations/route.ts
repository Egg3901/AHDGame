/**
 * POST /api/whitehouse/cabinet/nominations — President proposes a cabinet nomination
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isActiveCabinetNominationDuplicateKey } from "@/lib/elections/duplicateKey";
import { getGameTime } from "@/lib/time/gameTime";
import type { CabinetNomination, ElectedOfficial, Character, NPP } from "@/lib/db/types";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear, getManuallyEnabledSeats } from "@/lib/cabinet/liveGameYear";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";

const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

const proposeNominationSchema = z
  .object({
    // positionId is validated against the resolved country's cabinet positions
    // inside the handler (the set is country-specific), not here.
    positionId: z.string().min(1, "positionId required"),
    nomineeCharacterId: schemas.objectId.optional(),
    nomineeNppId: schemas.objectId.optional(),
  })
  .refine((v) => Boolean(v.nomineeCharacterId) !== Boolean(v.nomineeNppId), {
    message: "Provide exactly one of nomineeCharacterId or nomineeNppId",
  });

// POST /api/whitehouse/cabinet/nominations — President proposes a cabinet nomination and opens a 24-hour Senate confirmation vote.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const limit = checkRateLimit(
      `cabinet:${authUser.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, proposeNominationSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { positionId, nomineeCharacterId, nomineeNppId } = parsed.data;

    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return errorResponse(400, "Unknown country");
    }
    const positionDef = getCabinetPositions(countryId).find((p) => p.id === positionId);
    if (!positionDef) {
      return errorResponse(400, "Invalid positionId");
    }

    const db = await getDb();
    const now = new Date();

    // Era gating: a seat outside its yearEnabled/yearRetired range cannot be
    // nominated for (hidden client-side too, but the server is the authority).
    // Manually enabled seats included: a create_department bill brings a seat
    // into existence regardless of era, and the roster the UI renders from
    // already honours that. Without it the page offers a seat this route then
    // refuses.
    if (!isSeatActive(positionDef, await getLiveGameYear(db), await getManuallyEnabledSeats(db))) {
      return errorResponse(400, "This cabinet position does not exist in the current era");
    }

    // Must be President (player character only — no NPP)
    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president", characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return errorResponse(400, "No President in office");
    }

    const myCharacter = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
      return errorResponse(403, "Only the President can propose cabinet nominations");
    }

    // Nominee is either a player character (has userId) or an NPP of this
    // country. Follows the FOMC/SCOTUS nominee pattern.
    let nomineeOid: ObjectId | null = null;
    let nomineeNppOid: ObjectId | null = null;
    let nomineeName: string;
    let nomineeParty: string | undefined;
    let nomineeUserId: ObjectId | undefined;
    if (nomineeCharacterId) {
      try {
        nomineeOid = new ObjectId(nomineeCharacterId);
      } catch {
        return errorResponse(400, "Invalid nomineeCharacterId");
      }
      const nominee = await db.collection<Character>("characters").findOne({ _id: nomineeOid });
      if (!nominee) {
        return errorResponse(404, "Nominee character not found");
      }
      if (!nominee.userId) {
        return errorResponse(400, "Only player characters can be nominated");
      }
      if (nominee.countryId !== countryId) {
        return errorResponse(400, "Nominee must be a politician of this country");
      }
      nomineeName = nominee.name;
      nomineeParty = nominee.party;
      nomineeUserId = nominee.userId;
    } else {
      try {
        nomineeNppOid = new ObjectId(nomineeNppId);
      } catch {
        return errorResponse(400, "Invalid nomineeNppId");
      }
      const npp = await db.collection<NPP>("npps").findOne({ _id: nomineeNppOid });
      if (!npp) {
        return errorResponse(404, "Nominee NPP not found");
      }
      if (npp.countryId != null && npp.countryId !== countryId) {
        return errorResponse(400, "Nominee must be a politician of this country");
      }
      nomineeName = npp.name;
      nomineeParty = npp.party;
    }

    // Withdraw any existing active/proposed nomination for this position
    await db
      .collection<CabinetNomination>("cabinetNominations")
      .updateMany(
        { positionId, status: { $in: ["active", "proposed"] } },
        { $set: { status: "withdrawn", updatedAt: now } }
      );

    // Anchor votingEndsAt to the game clock so it agrees with votingEndsOnTurn
    // and with the readers (lifecycle + vote routes) that compare against game time.
    const gameTimeForVote = await getGameTime();
    const votingEndsAt = new Date(gameTimeForVote.effectiveNow.getTime() + VOTING_DURATION_MS);
    const votingEndsOnTurn = gameTimeForVote.currentTurn + VOTING_DURATION_HOURS;

    const nomination: Omit<CabinetNomination, "_id"> = {
      countryId: myCharacter.countryId,
      positionId,
      nomineeCharacterId: nomineeOid,
      nomineeNppId: nomineeNppOid,
      nomineeMode: nomineeNppOid ? "npp" : "character",
      nomineeCharacterName: nomineeName,
      nomineeParty,
      proposedByPresidentId: presidentOfficial.characterId,
      proposedByPresidentName: myCharacter.name,
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      votingStartedAt: now,
      votingEndsAt,
      votingEndsOnTurn,
      proposedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    let result;
    try {
      result = await db
        .collection<CabinetNomination>("cabinetNominations")
        .insertOne(nomination as unknown as CabinetNomination);
    } catch (error) {
      if (isActiveCabinetNominationDuplicateKey(error)) {
        return errorResponse(409, "An active nomination for this cabinet position already exists");
      }
      throw error;
    }

    // Notify senators (player characters only)
    const senators = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId, officeType: "senate", characterId: { $ne: null }, isNPP: { $ne: true } })
      .toArray();
    const senatorCharIds = senators.map((s) => s.characterId!).filter(Boolean);
    const senatorChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: senatorCharIds } }, { projection: { _id: 1, userId: 1 } })
      .toArray();
    const posName = positionDef.name;
    for (const c of senatorChars) {
      await createNotification({
        userId: c.userId,
        type: "system",
        title: "Cabinet Nomination",
        message: `President has nominated ${nomineeName} for ${posName}. Senate vote is open.`,
        metadata: { nominationId: result.insertedId.toString(), type: "cabinet_nomination" },
      });
    }
    if (nomineeUserId) {
      await createNotification({
        userId: nomineeUserId,
        type: "system",
        title: "Cabinet Nomination",
        message: `You have been nominated for ${posName}. The Senate will vote on your confirmation.`,
        metadata: {
          nominationId: result.insertedId.toString(),
          type: "cabinet_nomination_proposed",
        },
      });
    }

    return NextResponse.json({
      success: true,
      nominationId: result.insertedId.toString(),
      message: `Nominated ${nomineeName} for ${posName}. Senate vote opens for 24 hours.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
