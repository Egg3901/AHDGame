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
import {
  PRIMARY_HOME_SURGE_COST_ACTIONS,
  PRIMARY_HOME_SURGE_COST_FUNDS,
  PRIMARY_HOME_SURGE_PCT,
} from "@/lib/electionEngine/constants";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/home-state-surge — One-time per primary cycle, bumps the candidate's home-state party org by +HOME_STATE_SURGE_BOOST for the remainder of the primary.
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

    if (candidate.primarySurgeUsed) {
      return NextResponse.json(
        { error: "You have already used your home-state surge this primary cycle" },
        { status: 409 }
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
    if (freshChar.actions < PRIMARY_HOME_SURGE_COST_ACTIONS) {
      return NextResponse.json(
        { error: `Not enough actions — surge costs ${PRIMARY_HOME_SURGE_COST_ACTIONS}` },
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
    const balanceLocal = freshChar.currencyBalances?.campaign ?? freshChar.funds ?? 0;
    if (balanceLocal < costFundsLocal) {
      return NextResponse.json(
        {
          error: `Not enough personal funds — surge costs $${PRIMARY_HOME_SURGE_COST_FUNDS.toLocaleString()}`,
        },
        { status: 400 }
      );
    }

    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";

    try {
      await runWithOptionalTransaction(
        async (session) => {
          const debitResult = await db.collection<Character>("characters").updateOne(
            {
              _id: character._id,
              actions: { $gte: PRIMARY_HOME_SURGE_COST_ACTIONS },
              [campaignFundsField]: { $gte: costFundsLocal },
            },
            {
              $inc: {
                actions: -PRIMARY_HOME_SURGE_COST_ACTIONS,
                [campaignFundsField]: -costFundsLocal,
              },
              $set: { updatedAt: now },
            },
            { session }
          );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

          const candidateUpdate = await db
            .collection<ElectionCandidate>("electionCandidates")
            .updateOne(
              { _id: candidate._id, primarySurgeUsed: { $ne: true } },
              {
                $set: {
                  primarySurgeUsed: true,
                  primarySurgeBoost: PRIMARY_HOME_SURGE_PCT,
                  updatedAt: now,
                },
              },
              { session }
            );
          if (candidateUpdate.modifiedCount === 0) throw new Error("SURGE_CONFLICT");
        },
        async () => {
          const debitResult = await db.collection<Character>("characters").updateOne(
            {
              _id: character._id,
              actions: { $gte: PRIMARY_HOME_SURGE_COST_ACTIONS },
              [campaignFundsField]: { $gte: costFundsLocal },
            },
            {
              $inc: {
                actions: -PRIMARY_HOME_SURGE_COST_ACTIONS,
                [campaignFundsField]: -costFundsLocal,
              },
              $set: { updatedAt: now },
            }
          );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

          try {
            const candidateUpdate = await db
              .collection<ElectionCandidate>("electionCandidates")
              .updateOne(
                { _id: candidate._id, primarySurgeUsed: { $ne: true } },
                {
                  $set: {
                    primarySurgeUsed: true,
                    primarySurgeBoost: PRIMARY_HOME_SURGE_PCT,
                    updatedAt: now,
                  },
                }
              );
            if (candidateUpdate.modifiedCount === 0) throw new Error("SURGE_CONFLICT");
          } catch (error) {
            await db.collection<Character>("characters").updateOne(
              { _id: character._id },
              {
                $inc: {
                  actions: PRIMARY_HOME_SURGE_COST_ACTIONS,
                  [campaignFundsField]: costFundsLocal,
                },
                $set: { updatedAt: new Date() },
              }
            );
            throw error;
          }
        }
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
      message: `Home-state surge activated in ${freshChar.homeState} — +${PRIMARY_HOME_SURGE_PCT}% votes for you in that state until primary resolves.`,
      homeState: freshChar.homeState,
      boostPct: PRIMARY_HOME_SURGE_PCT,
      cost: PRIMARY_HOME_SURGE_COST_FUNDS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
