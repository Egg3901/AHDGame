import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { getStateDemographicTurnoutCollection } from "@/lib/db/collections";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Election } from "@/lib/db/types";
import { applyDiminishingReturns } from "@/lib/utils/diminishingReturns";
import { resolveCanvassGroup } from "@/lib/demographics/countryDemographics";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { resolveCanvassState, CANVASS_ELIGIBILITY_MESSAGE } from "@/lib/canvassing/eligibility";
import { getGameTime } from "@/lib/time/gameTime";

const COST_FUNDS = 100;
const COST_ACTIONS = 1;

const MAX_CANVASS_BATCH = 50;

// POST /api/canvassing — Canvasses a demographic group in the character's active campaign state (home state by default; presidential candidates use travelState/primaryCampaignState) to boost voter turnout modifiers
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const body = await req.json();
    const { stateId, category, group, count: rawCount } = body;
    const count = Math.max(1, Math.min(MAX_CANVASS_BATCH, Math.floor(rawCount ?? 1)));

    // Validate inputs
    if (!stateId || !category || !group) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate category and group against the character's own country demographics.
    // The submitted category is the modifier bucket key (US Layer-1 dimension or
    // "<cc>_voterGroups"); resolveCanvassGroup rejects cross-country / unknown pairs.
    const resolved = resolveCanvassGroup(user.character.countryId, category, group);
    if (!resolved) {
      return NextResponse.json({ error: "Invalid demographic group" }, { status: 400 });
    }
    const { economicLean, socialLean, categoryKey: modifierCategoryKey } = resolved;

    const db = await getDb();

    // Resolve canvass eligibility — presidential candidates use travel/primary state,
    // everyone else uses home state. Returns blocked when a presidential candidate
    // hasn't set their travel/primary state yet.
    const eligibility = await resolveCanvassState(db, user.character);
    if (!eligibility.ok) {
      return NextResponse.json(
        { error: CANVASS_ELIGIBILITY_MESSAGE[eligibility.reason] },
        { status: 403 }
      );
    }
    if (eligibility.stateId !== stateId) {
      return NextResponse.json(
        { error: "You can only canvass in your active campaign state" },
        { status: 403 }
      );
    }

    const totalFundsCost = COST_FUNDS * count;
    const totalActionsCost = COST_ACTIONS * count;

    const forexEnabled = await isForexEnabled();
    // COST_FUNDS is an ANCHOR-denominated constant. Campaign funds are decoupled
    // from live forex: convert to LOCAL at the frozen base INITIAL_RATES scale so
    // the gate and the $inc both operate on local-unit balances.
    const campaignRate = forexEnabled ? campaignLocalRate(user.character.countryId ?? "US") : 1;
    const totalFundsCostLocal = forexEnabled ? totalFundsCost * campaignRate : totalFundsCost;
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const balanceLocal = localCampaignBalance(user.character, forexEnabled);

    // Check funds and actions for the full batch
    if (balanceLocal < totalFundsCostLocal) {
      return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
    }

    if (user.character.actions < totalActionsCost) {
      return NextResponse.json({ error: "Insufficient actions" }, { status: 400 });
    }

    // Check if there's an active election in this state
    const isActiveCampaign = await checkActiveCampaignSeason(stateId);

    // Apply canvassing effect immediately (simplified - no action queue)
    const turnoutCollection = await getStateDemographicTurnoutCollection();
    const turnoutData = await turnoutCollection.findOne({ _id: stateId });

    if (!turnoutData) {
      return NextResponse.json({ error: "State turnout data not found" }, { status: 404 });
    }

    // Calculate base boost (same for all iterations)
    const BASE_BOOST = 0.05;
    const charPosition = user.character.policies;
    const distance =
      Math.abs(charPosition.economic - economicLean) + Math.abs(charPosition.social - socialLean);
    const alignmentMultiplier = Math.max(0.1, 1.0 - distance * 0.15);
    const seasonMultiplier = isActiveCampaign ? 2.0 : 1.0;
    const boost = BASE_BOOST * alignmentMultiplier * seasonMultiplier;

    // Apply boost iteratively with diminishing returns for each canvass
    const categoryModifiers = turnoutData.modifiers[modifierCategoryKey];
    let currentModifier = categoryModifiers?.[group] ?? 0;
    let totalBoost = 0;

    for (let i = 0; i < count; i++) {
      const adjustedBoost = applyDiminishingReturns(currentModifier, boost);
      currentModifier = Math.max(-20, Math.min(20, currentModifier + adjustedBoost));
      totalBoost += adjustedBoost;
    }

    const characterSpendFilter = {
      _id: user.character._id,
      actions: { $gte: totalActionsCost },
      [campaignFundsField]: { $gte: totalFundsCostLocal },
    };
    const turnoutFilter = { _id: stateId, lastUpdated: turnoutData.lastUpdated };
    const turnoutUpdate = {
      $set: {
        [`modifiers.${modifierCategoryKey}.${group}`]: currentModifier,
        lastUpdated: new Date(),
      },
    };

    try {
      await runWithOptionalTransaction(
        async (session) => {
          const spendResult = await db.collection("characters").updateOne(
            characterSpendFilter,
            {
              $inc: {
                [campaignFundsField]: -totalFundsCostLocal,
                actions: -totalActionsCost,
              },
            },
            { session }
          );
          if (spendResult.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

          const turnoutResult = await turnoutCollection.updateOne(turnoutFilter, turnoutUpdate, {
            session,
          });
          if (turnoutResult.modifiedCount === 0) throw new Error("TURNOUT_CONFLICT");
        },
        async () => {
          const spendResult = await db.collection("characters").updateOne(characterSpendFilter, {
            $inc: {
              [campaignFundsField]: -totalFundsCostLocal,
              actions: -totalActionsCost,
            },
          });
          if (spendResult.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

          try {
            const turnoutResult = await turnoutCollection.updateOne(turnoutFilter, turnoutUpdate);
            if (turnoutResult.modifiedCount === 0) throw new Error("TURNOUT_CONFLICT");
          } catch (error) {
            await db.collection("characters").updateOne(
              { _id: user.character._id },
              {
                $inc: {
                  [campaignFundsField]: totalFundsCostLocal,
                  actions: totalActionsCost,
                },
              }
            );
            throw error;
          }
        }
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_RESOURCES") {
        return NextResponse.json(
          { error: "Your available actions or funds changed. Please try again." },
          { status: 409 }
        );
      }
      if ((error as Error).message === "TURNOUT_CONFLICT") {
        return NextResponse.json(
          { error: "State turnout changed while canvassing. Please refresh and try again." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message:
        count > 1
          ? `Canvassed ${group} voters in ${stateId} ${count} times`
          : `Canvassing ${group} voters in ${stateId}`,
      count,
      effect: {
        boost: totalBoost.toFixed(3),
        newModifier: currentModifier.toFixed(2),
        campaignSeasonActive: isActiveCampaign,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Check if there's an active election in the state (within 4 turns of election day).
 * Campaign season provides 2x effectiveness for canvassing.
 */
async function checkActiveCampaignSeason(stateId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const { currentTurn, effectiveNow: now } = await getGameTime();

    // Check for elections ending within the next 4 turns. Turn-first
    // (drift-immune, freezes on pause) with a Date fallback for un-backfilled
    // docs. 1 turn = 1 game-hour.
    const fourTurnsAhead = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    const activeElection = await db.collection<Election>("elections").findOne({
      state: stateId,
      status: "active",
      $or: [
        { endTurn: { $gte: currentTurn, $lte: currentTurn + 4 } },
        { endTurn: { $exists: false }, endTime: { $gte: now, $lte: fourTurnsAhead } },
      ],
    });

    return activeElection !== null;
  } catch (error) {
    console.error("[Canvassing API] Error checking campaign season:", error);
    return false;
  }
}
