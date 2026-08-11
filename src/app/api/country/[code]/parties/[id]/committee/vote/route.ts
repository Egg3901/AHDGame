import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { z } from "zod";
import { MAX_VOTES_PER_VOTER } from "@/lib/nationalCommitteeElections";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { isNationalCommitteeVoteDuplicateKey } from "@/lib/elections/duplicateKey";
import type {
  NationalCommitteeElection,
  NationalCommitteeCandidate,
  NationalCommitteeVote,
} from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { hasTurnBackedWindowClosed } from "@/lib/time/turnBackedWindow";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/committee/vote — Cast votes for candidates in the national committee election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/parties/[id]/committee/vote
 *
 * Vote for candidates in the National Committee election.
 * body: { candidateIds: string[] } - Array of character IDs to vote for (max 6)
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const db = await getDb();

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    // Must match both party AND country to avoid cross-country collisions
    const partyCountryId = party.countryId ?? "US";
    if (authUser.character.party !== partyId || !isSameCountry(authUser.character, party)) {
      return NextResponse.json(
        { error: "You must be a member of this party to vote" },
        { status: 403 }
      );
    }

    // 24h new-character cooldown on committee actions.
    const userDoc = await db
      .collection("users")
      .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
    const cooldown = isInNewCharacterCooldown({
      userCreatedAt: userDoc?.createdAt ?? new Date(0),
      characterCreatedAt: authUser.character.createdAt,
      partyJoinedAt: authUser.character.partyJoinedAt,
    });
    if (cooldown.blocked) {
      return NextResponse.json(
        {
          error: "New characters can't vote in committee elections for 24 hours. Try again later.",
          unblockAt: cooldown.unblockAt.toISOString(),
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(
      request,
      z.object({
        candidateIds: z.array(schemas.objectId).max(MAX_VOTES_PER_VOTER, {
          message: `You can vote for at most ${MAX_VOTES_PER_VOTER} candidates`,
        }),
      })
    );
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { candidateIds } = parsed.data;

    // Find active election for this party in this country
    const election = await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .findOne({ partyId, countryId: partyCountryId, status: "voting" });

    if (!election) {
      return NextResponse.json({ error: "No active committee election" }, { status: 400 });
    }

    const gameTime = await getGameTime();
    if (hasTurnBackedWindowClosed(election, gameTime.currentTurn, gameTime.effectiveNow)) {
      return NextResponse.json(
        { error: "Committee election voting has already closed" },
        { status: 400 }
      );
    }

    const now = new Date(gameTime.effectiveNow);
    const voterId = authUser.character._id;

    // Parse and validate candidate IDs
    const candidateObjectIds: ObjectId[] = [];
    for (const id of candidateIds) {
      try {
        candidateObjectIds.push(new ObjectId(id));
      } catch {
        return NextResponse.json({ error: `Invalid candidate ID: ${id}` }, { status: 400 });
      }
    }

    // Remove duplicates
    const uniqueIds = [...new Set(candidateObjectIds.map((id) => id.toString()))].map(
      (id) => new ObjectId(id)
    );

    // Filter to only active candidates — silently drop any IDs for candidates who
    // have withdrawn or left the party. Without this, a single stale ID in the
    // submission would block the player from changing any of their votes.
    let validIds: ObjectId[] = [];
    if (uniqueIds.length > 0) {
      const activeCandidates = await db
        .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
        .find({
          electionId: election._id,
          characterId: { $in: uniqueIds },
          status: "active",
        })
        .toArray();
      const activeIdSet = new Set(activeCandidates.map((c) => c.characterId.toString()));
      validIds = uniqueIds.filter((id) => activeIdSet.has(id.toString()));
    }

    // Upsert vote (replace previous votes)
    try {
      await db.collection<NationalCommitteeVote>("nationalCommitteeVotes").updateOne(
        { electionId: election._id, voterId },
        {
          $set: {
            candidateIds: validIds,
            votedAt: now,
          },
          $setOnInsert: {
            electionId: election._id,
            voterId,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (!isNationalCommitteeVoteDuplicateKey(error)) throw error;

      await db.collection<NationalCommitteeVote>("nationalCommitteeVotes").updateOne(
        { electionId: election._id, voterId },
        {
          $set: {
            candidateIds: validIds,
            votedAt: now,
          },
        }
      );
    }

    const voteCount = validIds.length;

    return NextResponse.json({
      success: true,
      message:
        voteCount > 0
          ? `Your votes for ${voteCount} candidate${voteCount > 1 ? "s" : ""} have been recorded`
          : "Your votes have been cleared",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
