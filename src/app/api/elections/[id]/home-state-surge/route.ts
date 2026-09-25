import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import type { Character, ElectionCandidate } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
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
import {
  PRIMARY_HOME_SURGE_COST_ACTIONS,
  PRIMARY_HOME_SURGE_COST_FUNDS,
  PRIMARY_HOME_SURGE_PCT,
} from "@/lib/electionEngine/constants";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/home-state-surge
//
// One-time per primary cycle. Charges PRIMARY_HOME_SURGE_COST_FUNDS and
// PRIMARY_HOME_SURGE_COST_ACTIONS, then stamps PRIMARY_HOME_SURGE_PCT onto the
// candidate as `primarySurgeBoost` and raises `primarySurgeUsed`.
//
// Those two fields are what the vote maths reads: both the stagger phase and
// the projection apply `homeStateSurgeMultiplier` for the candidate in their
// own home state. `primarySurgeUsed` is the gate, so `primaryResolution`
// clearing it at the end of the cycle is what ends the boost.
// Auth: requireAuthWithCharacter (must be an active presidential primary candidate)
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

    const { id: electionId } = await params;
    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      return resolved.reason === "invalid_id"
        ? NextResponse.json({ error: "Invalid election ID" }, { status: 400 })
        : NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const election = resolved.election;

    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Home-state surge is only available in presidential primaries" },
        { status: 400 }
      );
    }
    if (election.status !== "active") {
      return NextResponse.json({ error: "Election is not active" }, { status: 400 });
    }
    const gameTime = await getGameTime();
    const now = gameTime.effectiveNow;
    if (isPrimaryEnded(election, gameTime.currentTurn, gameTime)) {
      return NextResponse.json(
        { error: "Home-state surge is only available during the primary phase" },
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

    const freshChar = await db
      .collection<Character>("characters")
      .findOne(
        { _id: character._id },
        { projection: { actions: 1, funds: 1, currencyBalances: 1, homeState: 1, countryId: 1 } }
      );

    if (!freshChar) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    if (!freshChar.homeState) {
      return NextResponse.json(
        { error: "You must have a home state to surge it" },
        { status: 400 }
      );
    }
    const forexEnabled = await isForexEnabled();
    const { rate: homeFxRate } = forexEnabled
      ? await loadCharacterFxRate(db, getHomeCurrency(freshChar))
      : { rate: 1 };
    // PRIMARY_HOME_SURGE_COST_FUNDS is an ANCHOR-denominated constant. Convert
    // to LOCAL at the boundary so the gate and the $inc both operate in local
    // units against the canonical currencyBalances.campaign field.
    const costFundsLocal = forexEnabled
      ? PRIMARY_HOME_SURGE_COST_FUNDS * homeFxRate
      : PRIMARY_HOME_SURGE_COST_FUNDS;
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";

    // Crash-safe money flow (issue #1672): the combined actions+funds
    // debit is one keyed leg (same-document writes must share a leg — two
    // legs on one document under one key collide on the key guard) and the
    // surge flag a keyed update, so a crash between the sequential writes
    // reconciles instead of charging for a surge that never landed.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }
    const flowKey = headerKey ?? randomUUID();
    const fingerprint = `${character._id.toHexString()}:${candidate._id.toHexString()}:surge:${PRIMARY_HOME_SURGE_COST_ACTIONS}:${costFundsLocal}`;
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
        message: `Home-state surge activated in ${freshChar.homeState}. You gain +${PRIMARY_HOME_SURGE_PCT}% of the vote there until the primary resolves.`,
        homeState: freshChar.homeState,
        boostPct: PRIMARY_HOME_SURGE_PCT,
        cost: PRIMARY_HOME_SURGE_COST_FUNDS,
        duplicate: true,
      });
    }
    if (previousReceipt?.status !== "in_progress") {
      if (candidate.primarySurgeUsed) {
        return NextResponse.json(
          { error: "You have already used your home-state surge this primary cycle" },
          { status: 409 }
        );
      }
      if (freshChar.actions < PRIMARY_HOME_SURGE_COST_ACTIONS) {
        return NextResponse.json(
          { error: `Not enough actions. The surge costs ${PRIMARY_HOME_SURGE_COST_ACTIONS}.` },
          { status: 400 }
        );
      }
      const balanceLocal = freshChar.currencyBalances?.campaign ?? freshChar.funds ?? 0;
      if (balanceLocal < costFundsLocal) {
        return NextResponse.json(
          {
            error: `Not enough personal funds. The surge costs $${PRIMARY_HOME_SURGE_COST_FUNDS.toLocaleString()}.`,
          },
          { status: 400 }
        );
      }
    }
    const mapSurgeError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
      if (step.index === 0) return new Error("INSUFFICIENT_RESOURCES");
      if (outcome === "missing") return new Error("SURGE_CONFLICT");
      return new Error("SURGE_CONFLICT");
    };
    const runSurge = async (session?: ClientSession) => {
      const opts = session ? { session } : {};
      const claim = await claimMoneyFlowReceipt(receipts, flowKey, fingerprint, opts);
      if (claim === "duplicate") return claim;
      await runMoneyFlowSteps(
        receipts,
        flowKey,
        [
          makeLegStep(flowKey, {
            name: "surge-debit",
            collection: characters,
            docId: character._id,
            field: "actions",
            delta: -PRIMARY_HOME_SURGE_COST_ACTIONS,
            minBalance: PRIMARY_HOME_SURGE_COST_ACTIONS,
            extraIncs: { [campaignFundsField]: -costFundsLocal },
            extraFilter: { [campaignFundsField]: { $gte: costFundsLocal } },
            set: { updatedAt: now },
          }),
          {
            name: "surge-flag",
            apply: (stepOpts) =>
              applyKeyedUpdate(
                flowKey,
                {
                  collection: candidates,
                  filter: { _id: candidate._id, primarySurgeUsed: { $ne: true } },
                  update: {
                    $set: {
                      primarySurgeUsed: true,
                      primarySurgeBoost: PRIMARY_HOME_SURGE_PCT,
                      updatedAt: now,
                    },
                  },
                },
                stepOpts ?? {}
              ),
          },
        ],
        mapSurgeError,
        opts
      );
      return claim;
    };

    let surgeClaim: string;
    try {
      surgeClaim = await runWithOptionalTransaction(
        async (session) => runSurge(session),
        async () => runSurge()
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_RESOURCES") {
        return NextResponse.json(
          { error: "Your actions or campaign funds changed. Please try again." },
          { status: 409 }
        );
      }
      if ((error as Error).message === "SURGE_CONFLICT") {
        return NextResponse.json(
          { error: "You have already used your home-state surge this primary cycle" },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Home-state surge activated in ${freshChar.homeState}. You gain +${PRIMARY_HOME_SURGE_PCT}% of the vote there until the primary resolves.`,
      homeState: freshChar.homeState,
      boostPct: PRIMARY_HOME_SURGE_PCT,
      cost: PRIMARY_HOME_SURGE_COST_FUNDS,
      ...(surgeClaim !== "fresh" ? { duplicate: true } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
