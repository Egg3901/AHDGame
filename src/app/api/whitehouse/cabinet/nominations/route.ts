/**
 * POST /api/whitehouse/cabinet/nominations — President proposes a cabinet nomination
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isActiveCabinetNominationDuplicateKey } from "@/lib/elections/duplicateKey";
import { getGameTime } from "@/lib/time/gameTime";
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear, getManuallyEnabledSeats } from "@/lib/cabinet/liveGameYear";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";

const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

const proposeNominationSchema = z.object({
  // positionId is validated against the resolved country's cabinet positions
  // inside the handler (the set is country-specific), not here.
  positionId: z.string().min(1, "positionId required"),
  nomineeCharacterId: schemas.objectId,
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
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { positionId, nomineeCharacterId } = parsed.data;

    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }
    const positionDef = getCabinetPositions(countryId).find((p) => p.id === positionId);
    if (!positionDef) {
      return NextResponse.json({ error: "Invalid positionId" }, { status: 400 });
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
      return NextResponse.json(
        { error: "This cabinet position does not exist in the current era" },
        { status: 400 }
      );
    }

    // Must be President (player character only — no NPP)
    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president", characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return NextResponse.json({ error: "No President in office" }, { status: 400 });
    }

    const myCharacter = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
      return NextResponse.json(
        { error: "Only the President can propose cabinet nominations" },
        { status: 403 }
      );
    }

    // Nominee must be a player character (has userId)
    let nomineeOid: ObjectId;
    try {
      nomineeOid = new ObjectId(nomineeCharacterId);
    } catch {
      return NextResponse.json({ error: "Invalid nomineeCharacterId" }, { status: 400 });
    }

    const nominee = await db.collection<Character>("characters").findOne({ _id: nomineeOid });
    if (!nominee) {
      return NextResponse.json({ error: "Nominee character not found" }, { status: 404 });
    }
    if (!nominee.userId) {
      return NextResponse.json(
        { error: "Only player characters can be nominated" },
        { status: 400 }
      );
    }
    if (nominee.countryId !== countryId) {
      return NextResponse.json(
        { error: "Nominee must be a politician of this country" },
        { status: 400 }
      );
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
      nomineeCharacterName: nominee.name,
      nomineeParty: nominee.party,
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
        return NextResponse.json(
          { error: "An active nomination for this cabinet position already exists" },
          { status: 409 }
        );
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
        message: `President has nominated ${nominee.name} for ${posName}. Senate vote is open.`,
        metadata: { nominationId: result.insertedId.toString(), type: "cabinet_nomination" },
      });
    }
    if (nominee.userId) {
      await createNotification({
        userId: nominee.userId,
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
      message: `Nominated ${nominee.name} for ${posName}. Senate vote opens for 24 hours.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
