import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { getElectoralVoteUnits, getTravelActionCost } from "@/lib/constants/states";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { isSameCountry } from "@/lib/api/sameCountry";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";
import type { Campaign, ElectionCandidate, Character, GameState } from "@/lib/db/types";
import { z } from "zod";

const schema = z.object({
  stateId: z.string().min(1),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/running-mate/travel: Moves the ticket's running-mate surrogate campaign focus to a target state.
// Auth: requireAuthWithCharacter (must be the ticket's running mate)
// Errors: 400, 401, 403, 404, 409, 429
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
        { error: "Running-mate travel is only available in presidential races" },
        { status: 400 }
      );
    }

    if (election.status !== "active") {
      return NextResponse.json({ error: "Election is not active" }, { status: 400 });
    }

    // Surrogate travel opens in the general phase only (a running mate is a
    // general-phase concept). Turn-first (drift-immune) with a Date fallback.
    const gameTime = await getGameTime();
    if (!isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime)) {
      return NextResponse.json(
        { error: "Running-mate surrogate travel opens once the general election begins" },
        { status: 400 }
      );
    }

    const character = auth.user.character;

    // Cross-country defense-in-depth: the running mate's character must be in
    // the same country as the race, even though the ticket link resolves.
    if (!auth.user.isAdmin && !isSameCountry(character, election)) {
      return NextResponse.json(
        { error: "You cannot campaign for a ticket in another country" },
        { status: 403 }
      );
    }

    // Resolve the ticket by the running-mate link: the mate has no candidate row
    // of their own; they act on the nominee's row.
    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      runningMateId: character._id,
      status: "active",
    });

    if (!candidate) {
      return NextResponse.json(
        { error: "You are not the running mate on any ticket in this election" },
        { status: 403 }
      );
    }

    if (candidate.campaignSuspended) {
      return NextResponse.json(
        { error: "Suspended campaigns cannot change travel focus" },
        { status: 400 }
      );
    }

    if (candidate.runningMateTravelState === stateId) {
      return NextResponse.json(
        { error: "The running mate is already campaigning in this state" },
        { status: 400 }
      );
    }

    // The ticket's Campaign holds the shared per-day surrogate pool.
    const campaign = await db.collection<Campaign>("campaigns").findOne(
      {
        electionId: election._id,
        candidateId: candidate.characterId,
        status: { $ne: "archived" },
      },
      { projection: { _id: 1 } }
    );
    if (!campaign) {
      return NextResponse.json({ error: "Ticket campaign not found" }, { status: 404 });
    }

    // Cost scales with the target state's electoral-vote count, mirroring the
    // nominee's own travel action cost. Spent from the VP's OWN action pool.
    const actionCost = getTravelActionCost(stateId, gameState?.preset);

    const freshChar = await db
      .collection<Character>("characters")
      .findOne({ _id: character._id }, { projection: { actions: 1 } });

    if (!freshChar || freshChar.actions < actionCost) {
      return NextResponse.json(
        { error: `Not enough actions. Travel to ${stateId} costs ${actionCost} actions.` },
        { status: 400 }
      );
    }

    const now = new Date();
    const previousTravelFilter = candidate.runningMateTravelState
      ? { runningMateTravelState: candidate.runningMateTravelState }
      : // Not yet set: matches an explicit null or a missing field.
        { runningMateTravelState: { $in: [null] } };

    // Draw down the shared surrogate pool BEFORE debiting the VP's actions,
    // guarded by $gte so a depleted pool blocks the visit with no side effects.
    const poolResult = await db
      .collection<Campaign>("campaigns")
      .updateOne(
        { _id: campaign._id, runningMateSurrogateActionsRemaining: { $gte: 1 } },
        { $inc: { runningMateSurrogateActionsRemaining: -1 }, $set: { updatedAt: now } }
      );
    if (poolResult.modifiedCount === 0) {
      return NextResponse.json(
        { error: "No running-mate surrogate actions remaining today." },
        { status: 409 }
      );
    }

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
              { _id: candidate._id, ...previousTravelFilter },
              { $set: { runningMateTravelState: stateId, runningMateTraveledAt: now } },
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
                { _id: candidate._id, ...previousTravelFilter },
                { $set: { runningMateTravelState: stateId, runningMateTraveledAt: now } }
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
      // Restore the surrogate pool debit on any downstream failure.
      await db
        .collection<Campaign>("campaigns")
        .updateOne({ _id: campaign._id }, { $inc: { runningMateSurrogateActionsRemaining: 1 } });
      if ((error as Error).message === "INSUFFICIENT_ACTIONS") {
        return NextResponse.json(
          { error: `Not enough actions. Travel to ${stateId} costs ${actionCost} actions.` },
          { status: 400 }
        );
      }
      if ((error as Error).message === "TRAVEL_CONFLICT") {
        return NextResponse.json(
          { error: "The ticket's surrogate travel state changed. Please refresh and try again." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Running mate now campaigning in ${stateId}`,
      runningMateTravelState: stateId,
      actionsCost: actionCost,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
