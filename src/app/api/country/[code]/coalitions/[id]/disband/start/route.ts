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
import { getGameTime } from "@/lib/time/gameTime";

const DISBAND_VOTE_DURATION_HOURS = 24;
const DISBAND_VOTE_DURATION_MS = DISBAND_VOTE_DURATION_HOURS * 60 * 60 * 1000;

// POST /api/coalitions/[id]/disband/start — Initiate a disband vote (coalition chair only)
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

    const sequentialId = parseInt(id, 10);
    if (isNaN(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const db = await getDb();
    const gameTime = await getGameTime();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId, countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Caller must be the coalition chair
    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can initiate a disband vote.");
    }

    // Reject if a disband vote is already active. Turn-first (matches the
    // server resolver `resolveExpiredDisbandVotes`, which auto-resolves on
    // `expiresOnTurn`) with a wall-clock fallback for any legacy in-flight vote.
    const now = new Date(gameTime.effectiveNow);
    const disbandVoteActive =
      !!coalition.disbandVote &&
      (typeof coalition.disbandVote.expiresOnTurn === "number"
        ? coalition.disbandVote.expiresOnTurn > gameTime.currentTurn
        : coalition.disbandVote.expiresAt > now);
    if (disbandVoteActive) {
      throw badRequest("A disband vote is already active for this coalition.");
    }

    const disbandVote = {
      initiatedBy: character._id,
      initiatedAt: now,
      expiresAt: new Date(now.getTime() + DISBAND_VOTE_DURATION_MS),
      expiresOnTurn: gameTime.currentTurn + DISBAND_VOTE_DURATION_HOURS,
      votes: [],
    };

    await db
      .collection<Coalition>("coalitions")
      .updateOne({ _id: coalition._id }, { $set: { disbandVote, updatedAt: now } });

    // Notify all member party chairs
    const memberPartyIds = coalition.members.map((m) => m.partyId);
    const memberParties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ _id: { $in: memberPartyIds } }, { projection: { _id: 1, chairId: 1 } })
      .toArray();

    const chairCharacterIds = memberParties
      .map((p) => p.chairId)
      .filter((cid): cid is NonNullable<typeof cid> => cid != null);

    const chairCharacters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: chairCharacterIds } }, { projection: { _id: 1, userId: 1 } })
      .toArray();

    await Promise.all(
      chairCharacters.map((c) =>
        createNotification({
          userId: c.userId,
          type: "coalition_disband_vote_started",
          title: `Disband Vote: ${coalition.name}`,
          message: `A vote to disband the coalition "${coalition.name}" has been initiated.`,
          metadata: {
            coalitionId: coalition._id,
            coalitionSequentialId: coalition.sequentialId,
            coalitionName: coalition.name,
            countryId,
          },
        })
      )
    );

    return NextResponse.json({ success: true, message: "Disband vote initiated" });
  } catch (error) {
    return handleRouteError(error);
  }
}
