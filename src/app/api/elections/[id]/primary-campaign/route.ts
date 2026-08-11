import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { getElectoralVoteUnits, getTravelActionCost } from "@/lib/constants/states";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { ElectionCandidate, Character, GameState } from "@/lib/db/types";
import { z } from "zod";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";

const schema = z.object({
  stateId: z.string().min(1),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/primary-campaign — Set the authenticated presidential candidate's campaigning state during the primary phase. Badge-only, not a relocation.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `election:${auth.user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { stateId } = parsed.data;
    const { id: electionId } = await params;

    const db = await getDb();
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    const validStates = new Set(getElectoralVoteUnits(gameState?.preset).map((u) => u.stateId));
    if (!validStates.has(stateId)) {
      return NextResponse.json({ error: "Invalid US state code" }, { status: 400 });
    }

    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      return resolved.reason === "invalid_id"
        ? NextResponse.json({ error: "Invalid election ID" }, { status: 400 })
        : NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const election = resolved.election;

    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Primary campaigning is only available in presidential races" },
        { status: 400 }
      );
    }

    if (election.status !== "active") {
      return NextResponse.json({ error: "Election is not active" }, { status: 400 });
    }

    const gameTime = await getGameTime();
    const now = gameTime.effectiveNow;
    // Primary-only — once the primary has closed (turn-first), candidates
    // should use /travel instead.
    if (isPrimaryEnded(election, gameTime.currentTurn, gameTime)) {
      return NextResponse.json(
        { error: "Primary campaigning is only available during the primary phase" },
        { status: 400 }
      );
    }

    const character = auth.user.character;

    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      characterId: character._id,
      status: "active",
    });

    if (!candidate) {
      return NextResponse.json(
        { error: "You are not an active candidate in this election" },
        { status: 403 }
      );
    }

    if (candidate.campaignSuspended) {
      return NextResponse.json(
        { error: "Suspended campaigns cannot change primary campaign state" },
        { status: 400 }
      );
    }

    if (candidate.primaryCampaignState === stateId) {
      return NextResponse.json(
        { error: "You are already campaigning in this state" },
        { status: 400 }
      );
    }

    // Action cost scales by target state's EV count (3-10 actions). EV counts
    // are preset-aware (1990 census for a 1991 game; 48-state map under 1953).
    const actionCost = getTravelActionCost(stateId, gameState?.preset);

    const freshChar = await db
      .collection<Character>("characters")
      .findOne({ _id: character._id }, { projection: { actions: 1 } });

    if (!freshChar || freshChar.actions < actionCost) {
      return NextResponse.json(
        {
          error: `Not enough actions. Primary campaigning in ${stateId} costs ${actionCost} actions.`,
        },
        { status: 400 }
      );
    }

    const previousCampaignFilter = candidate.primaryCampaignState
      ? { primaryCampaignState: candidate.primaryCampaignState }
      : { primaryCampaignState: { $exists: false } };

    // Reset ticks to 0 when state changes — in-state bonus only applies to the
    // currently-camped state, so a move erases prior accumulation.
    try {
      await runWithOptionalTransaction(
        async (session) => {
          const debitResult = await db
            .collection<Character>("characters")
            .updateOne(
              { _id: character._id, actions: { $gte: actionCost } },
              { $inc: { actions: -actionCost }, $set: { updatedAt: now } },
              { session }
            );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_ACTIONS");

          const candidateUpdate = await db
            .collection<ElectionCandidate>("electionCandidates")
            .updateOne(
              { _id: candidate._id, ...previousCampaignFilter },
              {
                $set: {
                  primaryCampaignState: stateId,
                  primaryCampaignedAt: now,
                  primaryCampaignTicks: 0,
                },
              },
              { session }
            );
          if (candidateUpdate.modifiedCount === 0) throw new Error("TRAVEL_CONFLICT");
        },
        async () => {
          const debitResult = await db
            .collection<Character>("characters")
            .updateOne(
              { _id: character._id, actions: { $gte: actionCost } },
              { $inc: { actions: -actionCost }, $set: { updatedAt: now } }
            );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_ACTIONS");

          try {
            const candidateUpdate = await db
              .collection<ElectionCandidate>("electionCandidates")
              .updateOne(
                { _id: candidate._id, ...previousCampaignFilter },
                {
                  $set: {
                    primaryCampaignState: stateId,
                    primaryCampaignedAt: now,
                    primaryCampaignTicks: 0,
                  },
                }
              );
            if (candidateUpdate.modifiedCount === 0) throw new Error("TRAVEL_CONFLICT");
          } catch (error) {
            await db
              .collection<Character>("characters")
              .updateOne(
                { _id: character._id },
                { $inc: { actions: actionCost }, $set: { updatedAt: new Date() } }
              );
            throw error;
          }
        }
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_ACTIONS") {
        return NextResponse.json(
          {
            error: `Not enough actions. Primary campaigning in ${stateId} costs ${actionCost} actions.`,
          },
          { status: 400 }
        );
      }
      if ((error as Error).message === "TRAVEL_CONFLICT") {
        return NextResponse.json(
          { error: "Your primary campaign state changed. Please refresh and try again." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Now campaigning in ${stateId} during the primary`,
      primaryCampaignState: stateId,
      actionsCost: actionCost,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
