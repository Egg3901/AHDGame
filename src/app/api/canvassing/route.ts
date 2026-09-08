import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import {
  addTurnoutBoost,
  canvassingBoost,
  targetAudience,
  audienceTurnout,
  CAMPAIGN_RULES_VERSION,
} from "@/lib/campaignTargeting/rules";
import { loadCampaignAudience } from "@/lib/campaignTargeting/audience";
import { calculateCanvassingBoost } from "@/lib/turn/demographicTurnoutCalculations";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { getStateDemographicTurnoutCollection } from "@/lib/db/collections";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Campaign, Election } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { applyDiminishingReturns } from "@/lib/utils/diminishingReturns";
import { resolveCanvassGroup } from "@/lib/demographics/countryDemographics";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  resolveCanvassState,
  resolveRunningMateCanvassState,
  CANVASS_ELIGIBILITY_MESSAGE,
} from "@/lib/canvassing/eligibility";
import { getGameTime } from "@/lib/time/gameTime";

const COST_FUNDS = 100;
const COST_ACTIONS = 1;

const MAX_CANVASS_BATCH = 50;
const canvassSchema = z.object({
  stateId: z.string().min(1).max(100),
  category: z
    .string()
    .regex(/^[a-zA-Z0-9_]+$/)
    .max(100),
  group: z
    .string()
    .regex(/^[a-zA-Z0-9_]+$/)
    .max(100),
  count: z.number().int().min(1).max(MAX_CANVASS_BATCH).default(1),
});

// GET /api/canvassing: current eligible targets and a turnout preview.
// Auth: requireAuthWithCharacter; errors: 400, 401, 403, 404.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const mate = await resolveRunningMateCanvassState(db, auth.user.character);
    const eligibility = mate.ok ? mate : await resolveCanvassState(db, auth.user.character);
    if (!eligibility.ok)
      return NextResponse.json(
        { error: CANVASS_ELIGIBILITY_MESSAGE[eligibility.reason] },
        { status: 403 }
      );
    const stateId = eligibility.stateId;
    const turnoutData = await (
      await getStateDemographicTurnoutCollection()
    ).findOne({ _id: stateId });
    if (!turnoutData)
      return NextResponse.json({ error: "State turnout data not found" }, { status: 404 });
    const audience = await loadCampaignAudience(
      db,
      auth.user.character.countryId,
      stateId,
      turnoutData
    );
    const targets = new Map<string, { dimension: string; bucket: string }>();
    for (const cell of audience?.cells ?? [])
      for (const [dimension, bucket] of Object.entries(cell.buckets))
        targets.set(`${dimension}:${bucket}`, { dimension, bucket });
    const target = {
      dimension: req.nextUrl.searchParams.get("category") ?? "",
      bucket: req.nextUrl.searchParams.get("group") ?? "",
    };
    const count = z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_CANVASS_BATCH)
      .safeParse(req.nextUrl.searchParams.get("count") ?? 1);
    if (!count.success)
      return NextResponse.json({ error: "Invalid canvassing count" }, { status: 400 });
    const info = audience ? targetAudience(audience.cells, target) : null;
    let preview = null;
    if (audience && info) {
      const closing = await checkActiveCampaignSeason(stateId, auth.user.character.countryId);
      const campaignModifiers = structuredClone(
        turnoutData.campaignModifiers ?? turnoutData.modifiers
      );
      const buckets = (campaignModifiers[target.dimension] ??= {});
      const before = buckets[target.bucket] ?? 0;
      const position = auth.user.character.policies;
      buckets[target.bucket] = addTurnoutBoost(
        before,
        canvassingBoost(
          { economicLean: position.economic, socialLean: position.social },
          info.position,
          closing
        ),
        count.data
      );
      const after = audience.build({ ...turnoutData, campaignModifiers });
      preview = {
        bucketBoost: buckets[target.bucket] - before,
        turnoutBefore: audienceTurnout(audience.cells, target),
        turnoutAfter: audienceTurnout(after?.campaignCells ?? [], target),
        closing,
      };
    }
    const forex = await isForexEnabled();
    const fundsCost = COST_FUNDS * (forex ? campaignLocalRate(auth.user.character.countryId) : 1);
    return NextResponse.json(
      { stateId, targets: [...targets.values()], preview, fundsCost },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

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

    const parsed = await parseJsonBody(req, canvassSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { stateId, category, group, count } = parsed.data;
    const resolved = resolveCanvassGroup(user.character.countryId, category, group);
    const modifierCategoryKey = resolved?.categoryKey ?? category;

    const db = await getDb();

    // Running-mate surrogate branch takes precedence when the acting character
    // is the running mate on an active general-phase presidential ticket and is
    // canvassing that ticket's travel state. The surrogate spends the VP's own
    // actions/funds (like any canvass) AND draws down the ticket's shared
    // per-day surrogate pool. Otherwise fall through to the normal home / own
    // candidacy eligibility.
    const mateEligibility = await resolveRunningMateCanvassState(db, user.character);
    const usingSurrogate = mateEligibility.ok && mateEligibility.stateId === stateId;
    let surrogateCampaignId: ObjectId | null = null;
    if (usingSurrogate && mateEligibility.ok) {
      const ticketCampaign = await db.collection<Campaign>("campaigns").findOne(
        {
          electionId: mateEligibility.electionId,
          candidateId: mateEligibility.nomineeCharacterId,
          status: { $ne: "archived" },
        },
        { projection: { _id: 1 } }
      );
      if (!ticketCampaign) {
        return NextResponse.json({ error: "Ticket campaign not found" }, { status: 404 });
      }
      surrogateCampaignId = ticketCampaign._id;
    } else {
      // Resolve canvass eligibility: presidential candidates use travel/primary
      // state, everyone else uses home state. Returns blocked when a presidential
      // candidate hasn't set their travel/primary state yet.
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
    const isActiveCampaign = await checkActiveCampaignSeason(stateId, user.character.countryId);

    // Apply canvassing effect immediately (simplified - no action queue)
    const turnoutCollection = await getStateDemographicTurnoutCollection();
    const turnoutData = await turnoutCollection.findOne({ _id: stateId });

    if (!turnoutData) {
      return NextResponse.json({ error: "State turnout data not found" }, { status: 404 });
    }

    const audience = await loadCampaignAudience(db, user.character.countryId, stateId, turnoutData);
    const target = { dimension: category, bucket: group };
    const targetInfo = audience ? targetAudience(audience.cells, target) : null;
    if (!resolved && !targetInfo)
      return NextResponse.json({ error: "Invalid demographic group" }, { status: 400 });
    const charPosition = user.character.policies;
    const candidatePosition = {
      economicLean: charPosition.economic,
      socialLean: charPosition.social,
    };
    const targetPosition = targetInfo?.position ?? {
      economicLean: resolved!.economicLean,
      socialLean: resolved!.socialLean,
    };
    const boost = resolved
      ? calculateCanvassingBoost(
          charPosition,
          { economic: resolved.economicLean, social: resolved.socialLean },
          isActiveCampaign
        )
      : 0;
    const campaignModifiers = structuredClone(
      turnoutData.campaignModifiers ?? turnoutData.modifiers
    );
    const modernCategory = (campaignModifiers[modifierCategoryKey] ??= {});
    const beforeModifier = modernCategory[group] ?? 0;
    modernCategory[group] = addTurnoutBoost(
      beforeModifier,
      canvassingBoost(candidatePosition, targetPosition, isActiveCampaign),
      count
    );
    const afterAudience = audience?.build({ ...turnoutData, campaignModifiers });
    const turnoutBefore = targetInfo && audience ? audienceTurnout(audience.cells, target) : null;
    const turnoutAfter =
      targetInfo && afterAudience?.campaignCells
        ? audienceTurnout(afterAudience.campaignCells, target)
        : null;

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
        campaignModifiers,
        lastUpdated: new Date(),
      },
    };

    // Surrogate branch: draw down the ticket's shared per-day pool BEFORE the
    // personal spend, guarded by $gte so a depleted pool blocks the canvass with
    // no character debit. On any downstream failure the pool is restored (mirror
    // of the character/turnout rollback below).
    if (surrogateCampaignId) {
      const poolResult = await db.collection<Campaign>("campaigns").updateOne(
        {
          _id: surrogateCampaignId,
          runningMateSurrogateActionsRemaining: { $gte: totalActionsCost },
        },
        {
          $inc: { runningMateSurrogateActionsRemaining: -totalActionsCost },
          $set: { updatedAt: new Date() },
        }
      );
      if (poolResult.modifiedCount === 0) {
        return NextResponse.json(
          { error: "No running-mate surrogate actions remaining today." },
          { status: 409 }
        );
      }
    }

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
      // Restore the surrogate pool debit if the personal spend / turnout write
      // failed after we drew it down.
      if (surrogateCampaignId) {
        await db
          .collection<Campaign>("campaigns")
          .updateOne(
            { _id: surrogateCampaignId },
            { $inc: { runningMateSurrogateActionsRemaining: totalActionsCost } }
          );
      }
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
        boost: (modernCategory[group] - beforeModifier).toFixed(3),
        newModifier: modernCategory[group].toFixed(2),
        legacyBoost: totalBoost.toFixed(3),
        legacyModifier: currentModifier.toFixed(2),
        campaignRulesVersion: CAMPAIGN_RULES_VERSION,
        turnoutBefore,
        turnoutAfter,
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
async function checkActiveCampaignSeason(stateId: string, countryId?: string): Promise<boolean> {
  try {
    const db = await getDb();
    const { currentTurn, effectiveNow: now } = await getGameTime();

    // Check for elections ending within the next 4 turns. Turn-first
    // (drift-immune, freezes on pause) with a Date fallback for un-backfilled
    // docs. 1 turn = 1 game-hour.
    const fourTurnsAhead = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const endingSoon = {
      $or: [
        { endTurn: { $gte: currentTurn, $lte: currentTurn + 4 } },
        { endTurn: { $exists: false }, endTime: { $gte: now, $lte: fourTurnsAhead } },
      ],
    };

    // In-season when a state-level race in this state is near its finish OR a
    // NATIONAL presidential race for this state's country is near — the latter
    // fixes the old miss where a presidential contest (stored `state:"US"`,
    // never `state:"CA"`) never counted its states as in campaign season.
    const location: Record<string, unknown>[] = [{ state: stateId }];
    if (countryId) {
      location.push({ electionType: "president", countryId });
    }

    const activeElection = await db.collection<Election>("elections").findOne({
      status: "active",
      $and: [endingSoon, { $or: location }],
    });

    return activeElection !== null;
  } catch (error) {
    console.error("[Canvassing API] Error checking campaign season:", error);
    return false;
  }
}
