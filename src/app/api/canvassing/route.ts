import { loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import { z } from "zod";
import { canUseNativeCanvassTargets } from "@/lib/canvassing/campaignContext";
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
import { randomUUID } from "node:crypto";
import { applyCanvassSpend } from "@/lib/canvassing/canvassSpend";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import { MoneyFlowKeyConflictError } from "@/lib/db/nonAtomicMoneyFlow";
import {
  resolveCanvassState,
  resolveRunningMateCanvassState,
  CANVASS_ELIGIBILITY_MESSAGE,
} from "@/lib/canvassing/eligibility";
import { getGameTime } from "@/lib/time/gameTime";

const COST_FUNDS = 100;
const COST_ACTIONS = 1;

const MAX_CANVASS_BATCH = 50;
const electionIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/)
  .optional();
const canvassSchema = z.object({
  electionId: electionIdSchema,
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
    const previewRate = checkRateLimit(`canvassing-preview:${auth.user.userId}`, 30, 60_000);
    if (!previewRate.ok) return rateLimitResponse(previewRate.retryAfter);
    const db = await getDb();
    const mate = await resolveRunningMateCanvassState(db, auth.user.character);
    const eligibility = mate.ok ? mate : await resolveCanvassState(db, auth.user.character);
    if (!eligibility.ok)
      return NextResponse.json(
        { error: CANVASS_ELIGIBILITY_MESSAGE[eligibility.reason] },
        { status: 403 }
      );
    const stateId = eligibility.stateId;
    const electionId = electionIdSchema.safeParse(
      req.nextUrl.searchParams.get("electionId") ?? undefined
    );
    if (!electionId.success)
      return NextResponse.json({ error: "Invalid election" }, { status: 400 });
    const nativeAllowed = await canUseNativeCanvassTargets(
      db,
      auth.user.character.countryId ?? "US",
      stateId,
      electionId.data ?? (mate.ok ? mate.electionId.toString() : undefined)
    );
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
        if (nativeAllowed || resolveCanvassGroup(auth.user.character.countryId, dimension, bucket))
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
    if (nativeAllowed && audience && info) {
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
    const campaignRates = await loadCampaignCurrencyRates(db);
    const fundsCost =
      COST_FUNDS * (forex ? campaignLocalRate(auth.user.character.countryId, campaignRates) : 1);
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
    const { stateId, category, group, count, electionId } = parsed.data;
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

    const nativeAllowed = await canUseNativeCanvassTargets(
      db,
      user.character.countryId ?? "US",
      stateId,
      electionId ??
        (usingSurrogate && mateEligibility.ok ? mateEligibility.electionId.toString() : undefined)
    );
    if (!resolved && !nativeAllowed)
      return NextResponse.json(
        {
          error:
            "This race uses legacy canvassing groups. Choose one of its original demographic groups.",
        },
        { status: 400 }
      );

    const totalFundsCost = COST_FUNDS * count;
    const totalActionsCost = COST_ACTIONS * count;

    const forexEnabled = await isForexEnabled();
    // COST_FUNDS is an ANCHOR-denominated constant. Campaign funds are decoupled
    // from live forex: convert to LOCAL at the frozen world-seeded currency basis so
    // the gate and the $inc both operate on local-unit balances.
    const campaignRates = await loadCampaignCurrencyRates(db);
    const campaignRate = forexEnabled
      ? campaignLocalRate(user.character.countryId ?? "US", campaignRates)
      : 1;
    const totalFundsCostLocal = forexEnabled ? totalFundsCost * campaignRate : totalFundsCost;
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const balanceLocal = localCampaignBalance(user.character, forexEnabled);

    // Crash-safe spend (issue #1672): the optional surrogate-pool draw and the
    // character funds+actions debit are keyed idempotent legs and the turnout
    // boost a terminal keyed write, so a crash between the sequential writes
    // reconciles to exactly one charged canvass instead of charging for a
    // boost that never landed. `Idempotency-Key` replays the stored outcome
    // without charging again.
    const headerKey = req.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }
    const flowKey = headerKey ?? randomUUID();
    const fingerprint = `${user.character._id.toHexString()}:${stateId}:${modifierCategoryKey}:${group}:${count}`;
    const receipts = await getMoneyFlowReceiptsCollection(db);
    // A completed retry sees balances and pools *after* the first request, so
    // read its receipt before the mutable balance checks below. An
    // interrupted flow must likewise reach the keyed spend for recovery.
    const previousReceipt = headerKey ? await receipts.findOne({ _id: flowKey }) : null;
    if (previousReceipt && previousReceipt.fingerprint !== fingerprint) {
      throw new MoneyFlowKeyConflictError(flowKey);
    }
    const resuming =
      previousReceipt?.status === "completed" || previousReceipt?.status === "in_progress";

    // Check funds and actions for the full batch. Skipped when resuming a
    // keyed attempt: the first request already passed these, and the balances
    // it left behind must not fail its own retry.
    if (!resuming) {
      if (balanceLocal < totalFundsCostLocal) {
        return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
      }

      if (user.character.actions < totalActionsCost) {
        return NextResponse.json({ error: "Insufficient actions" }, { status: 400 });
      }
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
    const turnoutBefore =
      nativeAllowed && targetInfo && audience ? audienceTurnout(audience.cells, target) : null;
    const turnoutAfter =
      nativeAllowed && targetInfo && afterAudience?.campaignCells
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

    let duplicate = false;
    try {
      ({ duplicate } = await applyCanvassSpend(db, {
        characterId: user.character._id,
        campaignFundsField,
        totalFundsCostLocal,
        totalActionsCost,
        ...(surrogateCampaignId ? { surrogateCampaignId } : {}),
        turnout: {
          stateId,
          lastUpdated: turnoutData.lastUpdated,
          modifierPath: `modifiers.${modifierCategoryKey}.${group}`,
          modifierValue: currentModifier,
          campaignModifiers,
        },
        fingerprint,
        idempotencyKey: flowKey,
      }));
    } catch (error) {
      if ((error as Error).message === "SURROGATE_DEPLETED") {
        return NextResponse.json(
          { error: "No running-mate surrogate actions remaining today." },
          { status: 409 }
        );
      }
      if ((error as Error).message === "INSUFFICIENT_RESOURCES") {
        return NextResponse.json(
          { error: "Your available actions or funds changed. Please try again." },
          { status: 409 }
        );
      }
      if ((error as Error).message.startsWith("TURNOUT_CONFLICT")) {
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
      ...(duplicate ? { duplicate: true } : {}),
      effect: {
        boost: (nativeAllowed ? modernCategory[group] - beforeModifier : totalBoost).toFixed(3),
        newModifier: (nativeAllowed ? modernCategory[group] : currentModifier).toFixed(2),
        legacyBoost: totalBoost.toFixed(3),
        legacyModifier: currentModifier.toFixed(2),
        campaignRulesVersion: nativeAllowed ? CAMPAIGN_RULES_VERSION : 0,
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
