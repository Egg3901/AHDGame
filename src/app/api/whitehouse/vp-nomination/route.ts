/**
 * POST /api/whitehouse/vp-nomination — President nominates a VP when the seat is vacant
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
import { getGameTime } from "@/lib/time/gameTime";
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";

const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

const nominateVpSchema = z.object({
  nomineeCharacterId: schemas.objectId,
});

// POST /api/whitehouse/vp-nomination — President nominates a VP when the seat is vacant.
// Opens a 24-hour Senate confirmation vote (25th Amendment §2).
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
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

    const parsed = await parseJsonBody(request, nominateVpSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { nomineeCharacterId } = parsed.data;

    const db = await getDb();
    const now = new Date();

    // Must be President (player character only)
    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "president", characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return NextResponse.json({ error: "No President in office" }, { status: 400 });
    }

    const myCharacter = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
      return NextResponse.json(
        { error: "Only the President can nominate a Vice President" },
        { status: 403 }
      );
    }

    // VP seat must be vacant
    const vpOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "vicePresident" });
    const vpVacant = !vpOfficial || (vpOfficial.characterId === null && !vpOfficial.nppId);
    if (!vpVacant) {
      return NextResponse.json({ error: "Vice President seat is not vacant" }, { status: 400 });
    }

    // No existing active VP nomination
    const existing = await db
      .collection<CabinetNomination>("cabinetNominations")
      .findOne({ positionId: "vicePresident", status: { $in: ["active", "proposed"] } });
    if (existing) {
      return NextResponse.json(
        { error: "A VP nomination is already pending Senate confirmation" },
        { status: 409 }
      );
    }

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
    if (nominee.countryId !== "US") {
      return NextResponse.json(
        { error: "Only US politicians can be nominated as Vice President" },
        { status: 400 }
      );
    }
    if (nomineeOid.equals(presidentOfficial.characterId)) {
      return NextResponse.json(
        { error: "The President cannot nominate themselves as Vice President" },
        { status: 400 }
      );
    }

    const gameTimeForVote = await getGameTime();
    const votingEndsAt = new Date(gameTimeForVote.effectiveNow.getTime() + VOTING_DURATION_MS);
    const votingEndsOnTurn = gameTimeForVote.currentTurn + VOTING_DURATION_HOURS;

    const nomination: Omit<CabinetNomination, "_id"> = {
      countryId: "US",
      positionId: "vicePresident",
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
      houseVotesFor: 0,
      houseVotesAgainst: 0,
      houseVotesAbstain: 0,
      houseVotes: {},
      votingStartedAt: now,
      votingEndsAt,
      votingEndsOnTurn,
      proposedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db
      .collection<CabinetNomination>("cabinetNominations")
      .insertOne(nomination as unknown as CabinetNomination);

    // Notify all US senators and representatives (player characters)
    const legislators = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: "US",
        officeType: { $in: ["senate", "house"] },
        characterId: { $ne: null },
        isNPP: { $ne: true },
      })
      .toArray();
    const legislatorCharIds = legislators.map((s) => s.characterId!).filter(Boolean);
    const legislatorChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: legislatorCharIds } }, { projection: { _id: 1, userId: 1 } })
      .toArray();
    for (const c of legislatorChars) {
      await createNotification({
        userId: c.userId,
        type: "system",
        title: "VP Nomination",
        message: `President ${myCharacter.name} has nominated ${nominee.name} for Vice President. Both the House and Senate will vote on confirmation.`,
        metadata: { nominationId: result.insertedId.toString(), type: "vp_nomination" },
      });
    }
    if (nominee.userId) {
      await createNotification({
        userId: nominee.userId,
        type: "system",
        title: "VP Nomination",
        message: `You have been nominated as Vice President. The Senate will vote on your confirmation.`,
        metadata: {
          nominationId: result.insertedId.toString(),
          type: "vp_nomination_proposed",
        },
      });
    }

    return NextResponse.json({
      success: true,
      nominationId: result.insertedId.toString(),
      message: `Nominated ${nominee.name} for Vice President. House and Senate votes open for 24 hours.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
