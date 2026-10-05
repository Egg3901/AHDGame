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
import type { ElectionCandidate, Character, GameState } from "@/lib/db/types";
import { z } from "zod";

const schema = z.object({
  stateId: z.string().min(1),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/travel — Moves the authenticated presidential candidate's campaign focus to a target state.
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
      return errorResponse(400, "Travel is only available in presidential races");
    }

    if (election.status !== "active") {
      return errorResponse(400, "Election is not active");
    }

    const character = auth.user.character;

    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      characterId: character._id,
      status: "active",
    });

    if (!candidate) {
      return errorResponse(403, "You are not an active candidate in this election");
    }

    if (candidate.campaignSuspended) {
      return errorResponse(400, "Suspended campaigns cannot change travel focus");
    }

    // Cost scales with the target state's electoral-vote count — small states
    // (3-5 EV) cost 3 actions, huge states (>20 EV) cost 10. Mirrors real campaign
    // resource tradeoffs: Wyoming is cheap, California is expensive. EV counts are
    // preset-aware (1990 census for a 1991 game; 48-state map under 1953).
    const actionCost = getTravelActionCost(stateId, gameState?.preset);

    const now = new Date();
    const previousTravelFilter = candidate.travelState
      ? { travelState: candidate.travelState }
      : { travelState: { $exists: false } };

    // Crash-safe money flow (issue #1672): the actions debit is a keyed
    // idempotent leg and the travel-state write a keyed update, so a crash
    // between the sequential writes reconciles instead of charging for a
    // move that never landed.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return errorResponse(400, "Invalid Idempotency-Key header");
    }
    const flowKey = headerKey ?? randomUUID();
    const fingerprint = `${character._id.toHexString()}:${candidate._id.toHexString()}:travel:${stateId}:${actionCost}`;
    const characters = db.collection<Character>("characters");
    const candidates = db.collection<ElectionCandidate>("electionCandidates");
    const receipts = await getMoneyFlowReceiptsCollection(db);
    const previousReceipt = headerKey ? await receipts.findOne({ _id: flowKey }) : null;
    if (previousReceipt && previousReceipt.fingerprint !== fingerprint) {
      throw new MoneyFlowKeyConflictError(flowKey);
    }
    if (previousReceipt?.status === "completed") {
      return NextResponse.json({
        success: true,
        message: `Now campaigning in ${stateId}`,
        travelState: stateId,
        actionsCost: actionCost,
        duplicate: true,
      });
    }
    const recovering = previousReceipt?.status === "in_progress";
    if (!recovering && candidate.travelState === stateId) {
      return errorResponse(400, "You are already campaigning in this state");
    }
    if (!recovering) {
      const freshChar = await db
        .collection<Character>("characters")
        .findOne({ _id: character._id }, { projection: { actions: 1 } });
      if (!freshChar || freshChar.actions < actionCost) {
        return errorResponse(
          400,
          `Not enough actions. Travel to ${stateId} costs ${actionCost} actions.`
        );
      }
    }
    const mapTravelError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
      if (step.index === 0) return new Error("INSUFFICIENT_ACTIONS");
      if (outcome === "missing") return new Error("TRAVEL_CONFLICT");
      return new Error("TRAVEL_CONFLICT");
    };
    const runTravel = async (session?: ClientSession) => {
      const opts = session ? { session } : {};
      const claim = await claimMoneyFlowReceipt(receipts, flowKey, fingerprint, opts);
      if (claim === "duplicate") return claim;
      await runMoneyFlowSteps(
        receipts,
        flowKey,
        [
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
            name: "travel-state",
            apply: (stepOpts) =>
              applyKeyedUpdate(
                flowKey,
                {
                  collection: candidates,
                  filter: { _id: candidate._id, ...previousTravelFilter },
                  update: { $set: { travelState: stateId, traveledAt: now } },
                },
                stepOpts ?? {}
              ),
          },
        ],
        mapTravelError,
        opts
      );
      return claim;
    };

    let travelClaim: string;
    try {
      travelClaim = await runWithOptionalTransaction(
        async (session) => runTravel(session),
        async () => runTravel()
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_ACTIONS") {
        return errorResponse(
          400,
          `Not enough actions. Travel to ${stateId} costs ${actionCost} actions.`
        );
      }
      if ((error as Error).message === "TRAVEL_CONFLICT") {
        return errorResponse(
          409,
          "Your campaign travel state changed. Please refresh and try again."
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Now campaigning in ${stateId}`,
      travelState: stateId,
      actionsCost: actionCost,
      ...(travelClaim !== "fresh" ? { duplicate: true } : {}),
      electionType: election.electionType,
      phase: "general",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
