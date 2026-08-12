/**
 * GET/POST /api/unions/[id]/leader/vote — leadership election tallies and ballot.
 * Only organizers who funded a drive may vote once the union is organized enough.
 */
import { NextResponse } from "next/server";
import { ObjectId, type Filter } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { bulkFetchCharacterNames } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import type { Character, Union } from "@/lib/db/types";
import type { UnionLeaderVote, UnionOrganizer } from "@/lib/db/types/union";
import { voteUnionLeader } from "@/lib/unions/commands/voteUnionLeader";
import {
  isUnionLeadershipElectionOpen,
  LEADERSHIP_ELECTION_MIN_STRENGTH,
  unionStrength,
} from "@/lib/unions/unionEconomy";
import {
  dedupeUnionLeaderVotes,
  loadUnionVoteWeights,
  tallyUnionLeaderVoteWeights,
  tallyUnionLeaderVotes,
} from "@/lib/unions/unionLeadershipVote";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const voteSchema = z.object({
  candidateCharacterId: schemas.objectId,
});

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid union ID" }, { status: 400 });
    }

    const db = await getDb();
    const unionObjectId = new ObjectId(id);
    const union = await db.collection<Union>("unions").findOne({ _id: unionObjectId });
    if (!union) {
      return NextResponse.json({ error: "Union not found" }, { status: 404 });
    }

    const [votesRaw, organizerDocs, user, weights] = await Promise.all([
      db.collection<UnionLeaderVote>("unionLeaderVotes").find({ unionId: unionObjectId }).toArray(),
      // The full roster, not just a count. Legacy organizers carry no `strength`
      // field and are dropped from the weight map, but they still belong on the
      // membership list, so read the documents rather than reusing the map.
      db
        .collection<UnionOrganizer>("unionOrganizers")
        .find(
          { unionId: unionObjectId },
          { projection: { characterId: 1, strength: 1, organizeCount: 1 } }
        )
        .toArray(),
      getAuthUserWithCharacter(),
      loadUnionVoteWeights(db, unionObjectId),
    ]);
    const organizerCount = organizerDocs.length;

    const votes = dedupeUnionLeaderVotes(votesRaw);
    const tally = tallyUnionLeaderVotes(votesRaw, weights);
    const leaderCharacterId = union.ownerId?.toString() ?? null;
    const nameLookupIds = [
      ...new Set([
        ...votes.map((v) => v.candidateCharacterId.toString()),
        ...organizerDocs.map((o) => o.characterId.toString()),
        ...(leaderCharacterId ? [leaderCharacterId] : []),
      ]),
    ];
    const charMap = await bulkFetchCharacterNames(db, nameLookupIds, { includeAvatar: true });

    // Ballots are weighted by banked organizing strength, so the number next to
    // a candidate is strength backing them, not a headcount.
    const counts = tallyUnionLeaderVoteWeights(votesRaw, weights);

    const tallies = [...counts.entries()]
      .map(([characterId, voteCount]) => ({
        characterId,
        name: charMap.get(characterId)?.name ?? "Unknown",
        sequentialId: charMap.get(characterId)?.sequentialId,
        avatarUrl: charMap.get(characterId)?.avatarUrl,
        votes: voteCount,
      }))
      .sort((a, b) => b.votes - a.votes);

    let myVote: string | null = null;
    let canVote = false;
    let myVotingPower = 0;
    if (user?.character) {
      myVotingPower = weights.get(user.character._id.toString()) ?? 0;
      canVote = myVotingPower > 0 && isUnionLeadershipElectionOpen(union);
      const myVoteDoc = votes.find(
        (v) => v.voterCharacterId.toString() === user.character!._id.toString()
      );
      myVote = myVoteDoc?.candidateCharacterId.toString() ?? null;
    }

    const candidateCountryFilter: Filter<Character> =
      union.countryId === "US"
        ? { $or: [{ countryId: "US" as const }, { countryId: { $exists: false } }] }
        : { countryId: union.countryId };
    const candidates = canVote
      ? await db
          .collection<Character>("characters")
          .find(
            {
              $and: [
                candidateCountryFilter,
                {
                  $or: [
                    { unionLeaderOf: null },
                    { unionLeaderOf: { $exists: false } },
                    { unionLeaderOf: union._id },
                  ],
                },
              ],
            },
            { projection: { name: 1, sequentialId: 1, avatarUrl: 1 } }
          )
          .sort({ name: 1 })
          .limit(250)
          .toArray()
      : [];

    // Roster with influence. Organizing was previously a black box: the page
    // showed a headcount and your own weight, so you could not tell who else
    // held sway in the union or how far behind you were.
    const totalBankedStrength = organizerDocs.reduce(
      (sum, organizer) => sum + Math.max(0, organizer.strength ?? 0),
      0
    );
    const organizers = organizerDocs
      .map((organizer) => {
        const characterId = organizer.characterId.toString();
        const strength = Math.max(0, organizer.strength ?? 0);
        return {
          characterId,
          name: charMap.get(characterId)?.name ?? "Unknown",
          sequentialId: charMap.get(characterId)?.sequentialId ?? null,
          avatarUrl: charMap.get(characterId)?.avatarUrl ?? null,
          strength,
          organizeCount: organizer.organizeCount ?? 0,
          influencePct: totalBankedStrength > 0 ? (strength / totalBankedStrength) * 100 : 0,
          isLeader: characterId === leaderCharacterId,
        };
      })
      .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));

    return NextResponse.json({
      electionOpen: isUnionLeadershipElectionOpen(union),
      minStrength: LEADERSHIP_ELECTION_MIN_STRENGTH,
      strength: unionStrength(union),
      membershipPressure: union.membershipPressure,
      organizerCount,
      organizers,
      totalBankedStrength,
      leader: leaderCharacterId
        ? {
            characterId: leaderCharacterId,
            name: charMap.get(leaderCharacterId)?.name ?? "Unknown",
            sequentialId: charMap.get(leaderCharacterId)?.sequentialId ?? null,
            avatarUrl: charMap.get(leaderCharacterId)?.avatarUrl ?? null,
          }
        : null,
      tallies,
      myVote,
      canVote,
      myVotingPower,
      candidates: candidates.map((candidate) => ({
        characterId: candidate._id.toString(),
        name: candidate.name,
        sequentialId: candidate.sequentialId ?? null,
        avatarUrl: candidate.avatarUrl ?? null,
      })),
      totalVoters: votes.length,
      pendingLeaderCharacterId: union.pendingLeaderCharacterId?.toString() ?? null,
      leadingCandidateId: tally?.leaderId ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid union ID" }, { status: 400 });
    }

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const union = await db.collection<Union>("unions").findOne({ _id: new ObjectId(id) });
    if (!union) {
      return NextResponse.json({ error: "Union not found" }, { status: 404 });
    }

    const result = await voteUnionLeader(
      db,
      character,
      union,
      new ObjectId(parsed.data.candidateCharacterId)
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      pendingLeaderCharacterId: result.pendingLeaderCharacterId,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
