import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
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
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
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
    //
    // Crash-safe money flow (issue #1672): the actions debit is a keyed
    // idempotent leg and the campaign-state write a keyed update, so a crash
    // between the sequential writes reconciles instead of charging for a
    // move that never landed.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }
    const flowKey = headerKey ?? randomUUID();
    const fingerprint = `${character._id.toHexString()}:${candidate._id.toHexString()}:primary:${stateId}:${actionCost}`;
    const characters = db.collection<Character>("characters");
    const candidates = db.collection<ElectionCandidate>("electionCandidates");
    const receipts = await getMoneyFlowReceiptsCollection(db);
    const mapCampaignError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
      if (step.index === 0) return new Error("INSUFFICIENT_ACTIONS");
      if (outcome === "missing") return new Error("TRAVEL_CONFLICT");
      return new Error("TRAVEL_CONFLICT");
    };
    const runCampaignMove = async (session?: ClientSession) => {
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
            name: "primary-campaign-state",
            apply: (stepOpts) =>
              applyKeyedUpdate(
                flowKey,
                {
                  collection: candidates,
                  filter: { _id: candidate._id, ...previousCampaignFilter },
                  update: {
                    $set: {
                      primaryCampaignState: stateId,
                      primaryCampaignedAt: now,
                      primaryCampaignTicks: 0,
                    },
                  },
                },
                stepOpts ?? {}
              ),
          },
        ],
        mapCampaignError,
        opts
      );
      return claim;
    };

    let campaignClaim: string;
    try {
      campaignClaim = await runWithOptionalTransaction(
        async (session) => runCampaignMove(session),
        async () => runCampaignMove()
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
      ...(campaignClaim !== "fresh" ? { duplicate: true } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
