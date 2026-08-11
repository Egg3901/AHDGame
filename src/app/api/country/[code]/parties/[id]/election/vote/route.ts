import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, ELECTION_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { handleRouteError } from "@/lib/api/errors";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { nationalPartyVoteSchema } from "@/lib/api/schemas/elections";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { isNationalPartyVoteDuplicateKey } from "@/lib/elections/duplicateKey";
import type {
  NationalPartyElection,
  NationalPartyCandidate,
  NationalPartyVote,
} from "@/lib/db/types";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getGameTime } from "@/lib/time/gameTime";
import { hasTurnBackedWindowClosed } from "@/lib/time/turnBackedWindow";
import { getPartyTenure } from "@/lib/parties/leadershipTenure";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/election/vote — Cast a vote in a national party leadership election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return authResult.response;
    }
    if (authResult.user.isBanned) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const authUser = authResult.user;

    const limit = checkRateLimit(
      `election:${authUser.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const parsed = await parseJsonBody(request, nationalPartyVoteSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { candidateId, position } = parsed.data;
    const candidateObjectId = new ObjectId(candidateId);

    // countryId already extracted from path params

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      logRequest("POST", path, 404, Date.now() - start);
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Verify membership: must match both party sequential ID AND country
    const partyCountryId = party.countryId ?? "US";
    if (authUser.character.party !== partyId || !isSameCountry(authUser.character, party)) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        { error: "You must be a member of this party to vote" },
        { status: 403 }
      );
    }

    // Committee-only elections: only committee members and national leadership may vote
    if (party.leadershipElectionMethod === "committee") {
      const eligible = getEligibleVoterSet(party);
      if (!eligible.has(authUser.character._id.toString())) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error:
              "Leadership elections for this party are restricted to committee members and national leadership",
          },
          { status: 403 }
        );
      }
    }

    // Filter by countryId to avoid cross-country sequential ID collisions
    const election = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .findOne({ partyId, countryId: partyCountryId, position, status: "voting" });

    if (!election) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: `No active ${position} election for this party` },
        { status: 400 }
      );
    }

    const gameTime = await getGameTime();
    if (hasTurnBackedWindowClosed(election, gameTime.currentTurn, gameTime.effectiveNow)) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: `${position} election voting has already closed` },
        { status: 400 }
      );
    }

    // 24h new-character cooldown on leadership actions. Waived for founding
    // elections (the accelerated 12-turn chair race at iteration start) so
    // brand-new players can vote immediately.
    if (!election.founding) {
      const userDoc = await db
        .collection("users")
        .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: userDoc?.createdAt ?? new Date(0),
        characterCreatedAt: authUser.character.createdAt,
        partyJoinedAt: authUser.character.partyJoinedAt,
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

    // Must have been a party member for a minimum number of turns before
    // voting in leadership (see leadershipTenure.ts). Orthogonal to the 24h
    // new-character cooldown above; likewise waived for founding elections.
    if (!election.founding) {
      const tenure = getPartyTenure(authUser.character.partyJoinedTurn, gameTime.currentTurn);
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

    const candidate = await db
      .collection<NationalPartyCandidate>("nationalPartyCandidates")
      .findOne({ electionId: election._id, characterId: candidateObjectId, status: "active" });

    if (!candidate) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "Candidate not found or has withdrawn" }, { status: 400 });
    }

    const now = new Date(gameTime.effectiveNow);

    // For partyInfluence-weighted elections, snapshot the voter's partyInfluence at vote time
    let voterPartyInfluence: number | undefined;
    if (party.leadershipElectionMethod === "influence") {
      const char = await db
        .collection("characters")
        .findOne({ _id: authUser.character._id }, { projection: { partyInfluence: 1 } });
      voterPartyInfluence = (char?.partyInfluence as number | undefined) ?? 0;
    }

    const voteSet: Record<string, unknown> = { candidateId: candidateObjectId, votedAt: now };
    if (voterPartyInfluence !== undefined) voteSet.voterPartyInfluence = voterPartyInfluence;

    try {
      await db.collection<NationalPartyVote>("nationalPartyVotes").updateOne(
        { electionId: election._id, voterId: authUser.character._id },
        {
          $set: voteSet,
          $setOnInsert: { electionId: election._id, voterId: authUser.character._id },
        },
        { upsert: true }
      );
    } catch (error) {
      if (!isNationalPartyVoteDuplicateKey(error)) throw error;

      await db
        .collection<NationalPartyVote>("nationalPartyVotes")
        .updateOne(
          { electionId: election._id, voterId: authUser.character._id },
          { $set: voteSet }
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
