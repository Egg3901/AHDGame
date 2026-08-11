/**
 * GET/POST /api/unions/[id]/leader/vote — leadership election tallies and ballot.
 * Only organizers who funded a drive may vote once the union is organized enough.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
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
import type { Union } from "@/lib/db/types";
import type { UnionLeaderVote, UnionOrganizer } from "@/lib/db/types/union";
import { voteUnionLeader } from "@/lib/unions/commands/voteUnionLeader";
import {
  isUnionLeadershipElectionOpen,
  LEADERSHIP_ELECTION_MIN_PRESSURE,
} from "@/lib/unions/unionEconomy";
import { dedupeUnionLeaderVotes, tallyUnionLeaderVotes } from "@/lib/unions/unionLeadershipVote";

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

    const [votesRaw, organizerCount, user] = await Promise.all([
      db.collection<UnionLeaderVote>("unionLeaderVotes").find({ unionId: unionObjectId }).toArray(),
      db.collection<UnionOrganizer>("unionOrganizers").countDocuments({ unionId: unionObjectId }),
      getAuthUserWithCharacter(),
    ]);

    const votes = dedupeUnionLeaderVotes(votesRaw);
    const tally = tallyUnionLeaderVotes(votesRaw);
    const candidateIds = [...new Set(votes.map((v) => v.candidateCharacterId.toString()))];
    const charMap = await bulkFetchCharacterNames(db, candidateIds, { includeAvatar: true });

    const counts = new Map<string, number>();
    for (const vote of votes) {
      const cid = vote.candidateCharacterId.toString();
      counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }

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
    if (user?.character) {
      const organizer = await db.collection<UnionOrganizer>("unionOrganizers").findOne({
        unionId: unionObjectId,
        characterId: user.character._id,
      });
      canVote = !!organizer && isUnionLeadershipElectionOpen(union);
      const myVoteDoc = votes.find(
        (v) => v.voterCharacterId.toString() === user.character!._id.toString()
      );
      myVote = myVoteDoc?.candidateCharacterId.toString() ?? null;
    }

    return NextResponse.json({
      electionOpen: isUnionLeadershipElectionOpen(union),
      minPressure: LEADERSHIP_ELECTION_MIN_PRESSURE,
      membershipPressure: union.membershipPressure,
      organizerCount,
      tallies,
      myVote,
      canVote,
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
