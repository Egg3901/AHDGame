import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { getElectoralVoteUnits, getTravelActionCost } from "@/lib/constants/states";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  makeLegStep,
  MoneyFlowKeyConflictError,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
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
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const { stateId } = parsed.data;
    const { id: electionId } = await params;

    const db = await getDb();
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    const validStates = new Set(getElectoralVoteUnits(gameState?.preset).map((u) => u.stateId));
    if (!validStates.has(stateId)) {
      return errorResponse(400, "Invalid US state code");
    }

    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      return resolved.reason === "invalid_id"
        ? errorResponse(400, "Invalid election ID")
        : errorResponse(404, "Election not found");
    }

    const election = resolved.election;

    if (election.electionType !== "president") {
      return errorResponse(400, "Running-mate travel is only available in presidential races");
    }

    if (election.status !== "active") {
      return errorResponse(400, "Election is not active");
    }

    // Surrogate travel opens in the general phase only (a running mate is a
    // general-phase concept). Turn-first (drift-immune) with a Date fallback.
    const gameTime = await getGameTime();
    if (!isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime)) {
      return errorResponse(
        400,
        "Running-mate surrogate travel opens once the general election begins"
      );
    }

    const character = auth.user.character;

    // Cross-country defense-in-depth: the running mate's character must be in
    // the same country as the race, even though the ticket link resolves.
    if (!auth.user.isAdmin && !isSameCountry(character, election)) {
      return errorResponse(403, "You cannot campaign for a ticket in another country");
    }

    // Resolve the ticket by the running-mate link: the mate has no candidate row
    // of their own; they act on the nominee's row.
    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      runningMateId: character._id,
      status: "active",
    });

    if (!candidate) {
      return errorResponse(403, "You are not the running mate on any ticket in this election");
    }

    if (candidate.campaignSuspended) {
      return errorResponse(400, "Suspended campaigns cannot change travel focus");
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
      return errorResponse(404, "Ticket campaign not found");
    }

    // Cost scales with the target state's electoral-vote count, mirroring the
    // nominee's own travel action cost. Spent from the VP's OWN action pool.
    const actionCost = getTravelActionCost(stateId, gameState?.preset);

    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return errorResponse(400, "Invalid Idempotency-Key header");
    }
    const flowKey = headerKey ?? randomUUID();
    const fingerprint = `${character._id.toHexString()}:${candidate._id.toHexString()}:rm-travel:${stateId}:${actionCost}`;
    const receipts = await getMoneyFlowReceiptsCollection(db);
    // A completed retry sees the destination and balances *after* the first
    // request. Read its receipt before checking those mutable preconditions.
    // An interrupted flow must likewise reach the keyed legs for recovery.
    const previousReceipt = headerKey ? await receipts.findOne({ _id: flowKey }) : null;
    if (previousReceipt && previousReceipt.fingerprint !== fingerprint) {
      throw new MoneyFlowKeyConflictError(flowKey);
    }
    if (previousReceipt?.status === "completed") {
      return NextResponse.json({
        success: true,
        message: `Running mate now campaigning in ${stateId}`,
        runningMateTravelState: stateId,
        actionsCost: actionCost,
        duplicate: true,
      });
    }
    const recovering = previousReceipt?.status === "in_progress";

    if (!recovering && candidate.runningMateTravelState === stateId) {
      return errorResponse(400, "The running mate is already campaigning in this state");
    }

    const freshChar = recovering
      ? null
      : await db
          .collection<Character>("characters")
          .findOne({ _id: character._id }, { projection: { actions: 1 } });

    if (!recovering && (!freshChar || freshChar.actions < actionCost)) {
      return errorResponse(
        400,
        `Not enough actions. Travel to ${stateId} costs ${actionCost} actions.`
      );
    }

    const now = new Date();
    const previousTravelFilter = candidate.runningMateTravelState
      ? { runningMateTravelState: candidate.runningMateTravelState }
      : // Not yet set: matches an explicit null or a missing field.
        { runningMateTravelState: { $in: [null] } };

    // Fast-path pool check. The pool draw itself is the first keyed leg of
    // the flow below, so a pool that drains between this read and the write
    // fails closed with SURROGATE_POOL_EMPTY instead of double-spending.
    // (Issue #1672: the old code drew the pool down outside the transaction
    // and hand-restored it on failure — a crash in between lost or
    // double-counted a pool action.)
    const poolAvailable = recovering
      ? null
      : await db
          .collection<Campaign>("campaigns")
          .findOne(
            { _id: campaign._id, runningMateSurrogateActionsRemaining: { $gte: 1 } },
            { projection: { _id: 1 } }
          );
    if (!recovering && !poolAvailable) {
      return errorResponse(409, "No running-mate surrogate actions remaining today.");
    }

    const characters = db.collection<Character>("characters");
    const campaigns = db.collection<Campaign>("campaigns");
    const candidates = db.collection<ElectionCandidate>("electionCandidates");
    const mapRmTravelError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
      if (step.index === 0) return new Error("SURROGATE_POOL_EMPTY");
      if (step.index === 1) return new Error("INSUFFICIENT_ACTIONS");
      if (outcome === "missing") return new Error("TRAVEL_CONFLICT");
      return new Error("TRAVEL_CONFLICT");
    };
    const runRmTravel = async (session?: ClientSession) => {
      const opts = session ? { session } : {};
      const claim = await claimMoneyFlowReceipt(receipts, flowKey, fingerprint, opts);
      if (claim === "duplicate") return claim;
      await runMoneyFlowSteps(
        receipts,
        flowKey,
        [
          makeLegStep(flowKey, {
            name: "surrogate-pool",
            collection: campaigns,
            docId: campaign._id,
            field: "runningMateSurrogateActionsRemaining",
            delta: -1,
            minBalance: 1,
            set: { updatedAt: now },
          }),
          makeLegStep(flowKey, {
            name: "actions-debit",
            collection: characters,
            docId: character._id,
            field: "actions",
            delta: -actionCost,
            minBalance: actionCost,
            set: { updatedAt: now },
          }),
          {
            name: "rm-travel-state",
            apply: (stepOpts) =>
              applyKeyedUpdate(
                flowKey,
                {
                  collection: candidates,
                  filter: { _id: candidate._id, ...previousTravelFilter },
                  update: {
                    $set: { runningMateTravelState: stateId, runningMateTraveledAt: now },
                  },
                },
                stepOpts ?? {}
              ),
          },
        ],
        mapRmTravelError,
        opts
      );
      return claim;
    };

    let rmTravelClaim: string;
    try {
      rmTravelClaim = await runWithOptionalTransaction(
        async (session) => runRmTravel(session),
        async () => runRmTravel()
      );
    } catch (error) {
      if ((error as Error).message === "SURROGATE_POOL_EMPTY") {
        return errorResponse(409, "No running-mate surrogate actions remaining today.");
      }
      if ((error as Error).message === "INSUFFICIENT_ACTIONS") {
        return errorResponse(
          400,
          `Not enough actions. Travel to ${stateId} costs ${actionCost} actions.`
        );
      }
      if ((error as Error).message === "TRAVEL_CONFLICT") {
        return errorResponse(
          409,
          "The ticket's surrogate travel state changed. Please refresh and try again."
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Running mate now campaigning in ${stateId}`,
      runningMateTravelState: stateId,
      actionsCost: actionCost,
      ...(rmTravelClaim !== "fresh" ? { duplicate: true } : {}),
      electionType: election.electionType,
      phase: "general",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
