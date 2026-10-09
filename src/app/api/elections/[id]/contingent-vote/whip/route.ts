import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { getGameTime } from "@/lib/time/gameTime";
import {
  FREE_VOTE,
  coalitionWhipKey,
  partyWhipKey,
} from "@/lib/elections/contingentHouseStandings";
import type { Coalition, ElectionVoteTally, PoliticalParty } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NO_STORE = { "Cache-Control": "private, no-store" };

const bodySchema = z.object({
  scope: z.enum(["party", "coalition"]),
  /** Party or coalition sequential id; optional when the caller chairs exactly one of that scope. */
  sequentialId: z.number().int().positive().optional(),
  /** A candidacy id, "free" for a free vote, or "clear" to remove the whip. */
  candidateId: z.union([schemas.objectId, z.enum([FREE_VOTE, "clear"])]),
});

// POST /api/elections/[id]/contingent-vote/whip: A party chair whips their party's House members; a coalition chair whips every member party without its own whip.
// Auth: requireHumanSessionWithCharacter; the caller must chair the party or coalition
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const character = auth.user.character;

    const { id: electionId } = await params;
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { scope, candidateId } = parsed.data;

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
      message: "You cannot whip in elections from other countries",
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
    if (candidateId !== FREE_VOTE && candidateId !== "clear") {
      if (!vote.eligibleCandidateIds.includes(candidateId)) {
        return errorResponse(400, "That candidate is not on the House ballot");
      }
    }

    // The caller must chair the group they whip for.
    const countryId = election.countryId ?? "US";
    const wanted = parsed.data.sequentialId;
    const chaired: Array<{ sequentialId: number; name: string }> =
      scope === "party"
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .find({ countryId, chairId: character._id })
            .project<Pick<PoliticalParty, "sequentialId" | "name">>({ sequentialId: 1, name: 1 })
            .toArray()
        : await db
            .collection<Coalition>("coalitions")
            .find({ countryId, chairCharacterId: character._id })
            .project<Pick<Coalition, "sequentialId" | "name">>({ sequentialId: 1, name: 1 })
            .toArray();
    const group = wanted
      ? chaired.find((g) => g.sequentialId === wanted)
      : chaired.length === 1
        ? chaired[0]
        : undefined;
    if (!group) {
      return errorResponse(
        403,
        scope === "party"
          ? "Only the party chair can set a party whip"
          : "Only the coalition chair can set a coalition whip"
      );
    }

    const key =
      scope === "party" ? partyWhipKey(group.sequentialId) : coalitionWhipKey(group.sequentialId);
    const now = new Date();
    // One atomic write per whip key; the filter re-checks that the window is open.
    const written = await tallies.updateOne(
      {
        electionId: election._id,
        "contingentHouseVote.status": "open",
        "contingentHouseVote.closesTurn": { $gt: currentTurn },
      },
      candidateId === "clear"
        ? { $unset: { [`contingentHouseVote.whips.${key}`]: "" }, $set: { updatedAt: now } }
        : {
            $set: {
              [`contingentHouseVote.whips.${key}`]: {
                candidateId,
                setBy: character._id.toString(),
                setByName: character.name,
                setAt: now,
                turn: currentTurn,
              },
              updatedAt: now,
            },
          }
    );
    if (written.matchedCount !== 1) return errorResponse(409, "The House vote has closed");

    recordAudit({
      source: "api",
      action: "election.contingent_whip",
      category: "election",
      subject: { type: "election", id: election._id, name: `president: ${election.state}` },
      refs: { electionId: election._id },
      meta: { scope, group: group.name, candidateId },
      outcome: "ok",
    });

    return NextResponse.json(
      { success: true, key, candidateId: candidateId === "clear" ? null : candidateId },
      { headers: NO_STORE }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
