import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { getGameTime } from "@/lib/time/gameTime";
import { buildContingentHouseVoteView } from "@/lib/elections/contingentHouseVoteView";
import { CONTINGENT_EXCLUDED_HOUSE_STATE } from "@/lib/elections/contingentConstants";
import type { ElectedOfficial, ElectionVoteTally } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Per-viewer by construction (own seat and own choice): never a shared cache.
const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/elections/[id]/contingent-vote: the open House vote after a contingent deadlock.
// Auth: optional; a signed-in House member also gets their own choice.
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id: electionId } = await params;
    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") return errorResponse(400, "Invalid election ID");
      return errorResponse(404, "Election not found");
    }
    const election = resolved.election;
    const tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: election._id });
    if (election.electionType !== "president" || !tally?.contingentHouseVote) {
      return NextResponse.json({ vote: null }, { headers: NO_STORE });
    }

    const [{ currentTurn }, user] = await Promise.all([
      getGameTime(),
      getAuthUserWithCharacter().catch(() => null),
    ]);
    const vote = await buildContingentHouseVoteView(
      db,
      election,
      tally,
      currentTurn,
      user?.character?._id ?? null
    );
    return NextResponse.json({ vote }, { headers: NO_STORE });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/elections/[id]/contingent-vote: A sitting US House member backs one of the candidates in the open House vote, replacing any earlier choice.
// Auth: requireHumanSessionWithCharacter (bot tokens rejected)
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const character = auth.user.character;

    const { id: electionId } = await params;
    const parsed = await parseJsonBody(request, z.object({ candidateId: schemas.objectId }));
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { candidateId } = parsed.data;

    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") return errorResponse(400, "Invalid election ID");
      return errorResponse(404, "Election not found");
    }
    const election = resolved.election;
    if (election.electionType !== "president") {
      return errorResponse(400, "The House vote only applies to presidential elections");
    }
    assertSameCountry(character, election, {
      message: "You cannot vote in elections from other countries",
    });

    const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
    const tally = await tallies.findOne(
      { electionId: election._id },
      { projection: { contingentHouseVote: 1 } }
    );
    const vote = tally?.contingentHouseVote;
    if (!vote) return errorResponse(404, "There is no House vote for this election");
    const { currentTurn } = await getGameTime();
    if (vote.status !== "open" || currentTurn >= vote.closesTurn) {
      return errorResponse(409, "The House vote has closed");
    }
    if (!vote.eligibleCandidateIds.includes(candidateId)) {
      return errorResponse(400, "That candidate is not on the House ballot");
    }

    const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne(
      {
        countryId: election.countryId ?? "US",
        officeType: "house",
        characterId: character._id,
      },
      { projection: { state: 1 } }
    );
    if (!seat) return errorResponse(403, "Only sitting House members can vote");
    if (seat.state === CONTINGENT_EXCLUDED_HOUSE_STATE) {
      return errorResponse(403, "The District of Columbia does not cast a delegation vote");
    }

    // One atomic write keyed by the member, so concurrent votes and re-votes
    // never overwrite each other's entries. The filter re-checks the window.
    const written = await tallies.updateOne(
      {
        electionId: election._id,
        "contingentHouseVote.status": "open",
        "contingentHouseVote.closesTurn": { $gt: currentTurn },
        "contingentHouseVote.eligibleCandidateIds": candidateId,
      },
      {
        $set: {
          [`contingentHouseVote.votes.${character._id.toString()}`]: candidateId,
          updatedAt: new Date(),
        },
      }
    );
    if (written.matchedCount !== 1) return errorResponse(409, "The House vote has closed");

    recordAudit({
      source: "api",
      action: "election.contingent_vote",
      category: "election",
      subject: { type: "election", id: election._id, name: `president: ${election.state}` },
      refs: { electionId: election._id },
      meta: { candidateId },
      outcome: "ok",
    });

    return NextResponse.json({ success: true, choiceId: candidateId }, { headers: NO_STORE });
  } catch (error) {
    return handleRouteError(error);
  }
}
