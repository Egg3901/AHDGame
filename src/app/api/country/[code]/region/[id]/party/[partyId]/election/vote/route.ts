import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { handleRouteError } from "@/lib/api/errors";
import { statePartyVoteSchema } from "@/lib/api/schemas/elections";
import { isStatePartyVoteDuplicateKey } from "@/lib/elections/duplicateKey";
import { validateStatePartyElectionAccess } from "@/lib/utils/statePartyElectionValidation";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import type { StatePartyCandidate, StatePartyVote } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameTime } from "@/lib/time/gameTime";
import { getPartyTenure } from "@/lib/parties/leadershipTenure";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/election/vote — Cast a vote in a state party leadership election
// Auth: requireAuthWithCharacter (via validateStatePartyElectionAccess)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const { code, id, partyId: routePartyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const resolvedStateId = id;

    const parsed = await parseJsonBody(request, statePartyVoteSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { candidateId, position } = parsed.data;
    const candidateObjectId = new ObjectId(candidateId);

    const validation = await validateStatePartyElectionAccess(
      resolvedStateId,
      countryId,
      routePartyId,
      position
    );
    if (!validation.success) return validation.response;

    const { character, election } = validation;

    const limit = checkRateLimit(
      `election:${character.userId.toString()}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const db = await getDb();

    // Founding elections waive cooldown + tenure (see enter route).
    if (!election.founding) {
      // 24h new-character cooldown on state leadership actions.
      const userDoc = await db
        .collection("users")
        .findOne({ _id: character.userId }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: userDoc?.createdAt ?? new Date(0),
        characterCreatedAt: character.createdAt,
        partyJoinedAt: character.partyJoinedAt,
        includePartyJoinedAt: false,
      });
      if (cooldown.blocked) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error:
              "New characters can't vote in party leadership elections for 24 hours. Try again later.",
            unblockAt: cooldown.unblockAt.toISOString(),
          },
          { status: 403 }
        );
      }
    }

    const candidate = await db
      .collection<StatePartyCandidate>("statePartyCandidates")
      .findOne({ electionId: election._id, characterId: candidateObjectId, status: "active" });

    if (!candidate) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "Candidate not found or has withdrawn" }, { status: 400 });
    }

    const gameTime = await getGameTime();
    const now = new Date(gameTime.effectiveNow);

    if (!election.founding) {
      // Minimum party tenure before voting in state leadership (leadershipTenure.ts).
      const tenure = getPartyTenure(character.partyJoinedTurn, gameTime.currentTurn);
      if (!tenure.eligible) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error: `You must be a member of this party for ${tenure.turnsRemaining} more turn${tenure.turnsRemaining === 1 ? "" : "s"} before you can vote in leadership elections.`,
            turnsRemaining: tenure.turnsRemaining,
          },
          { status: 403 }
        );
      }
    }

    // Upsert — voters can change their vote until the election closes
    try {
      await db.collection<StatePartyVote>("statePartyVotes").updateOne(
        { electionId: election._id, voterId: character._id },
        {
          $set: { candidateId: candidateObjectId, votedAt: now },
          $setOnInsert: { electionId: election._id, voterId: character._id },
        },
        { upsert: true }
      );
    } catch (error) {
      if (!isStatePartyVoteDuplicateKey(error)) throw error;

      await db
        .collection<StatePartyVote>("statePartyVotes")
        .updateOne(
          { electionId: election._id, voterId: character._id },
          { $set: { candidateId: candidateObjectId, votedAt: now } }
        );
    }

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      success: true,
      message: `Your vote for ${candidate.characterName} has been recorded`,
      candidateId,
      candidateName: candidate.characterName,
    });
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
