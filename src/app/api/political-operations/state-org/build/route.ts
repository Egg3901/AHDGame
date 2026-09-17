import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, badRequest } from "@/lib/api/errors";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";
import {
  STATE_ORG_COST_ACTIONS,
  STATE_ORG_PER_STATE_TURN_CAP,
  stateOrgLevelCost,
} from "@/lib/electionEngine/constants";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  applyStateOrgBuildSpend,
  buildStateOrgBuildFingerprint,
  STATE_ORG_INSUFFICIENT_RESOURCES,
  STATE_ORG_RACE_OR_THROTTLE,
} from "@/lib/elections/stateOrgBuildSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";
import { getGameTime } from "@/lib/time/gameTime";
import {
  loadUsPoliticalStateIds,
  unplayableTerritoryHomeError,
} from "@/lib/elections/usPoliticalHome";
import { isUsResidentPoliticalRegion } from "@/lib/elections/statehoodAdmission";
import type { Campaign, Character } from "@/lib/db/types";

const VALID_US_STATES = new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId));

const schema = z.object({
  // Modern 50-state alphabet check only; era political gate runs after parse.
  stateId: z.string().refine((s) => VALID_US_STATES.has(s), {
    message: "Invalid US state code",
  }),
});

/**
 * POST /api/political-operations/state-org/build
 *
 * Increments the authenticated US character's Campaign Presence level for the
 * given state by +1. The level ladder is UNBOUNDED — what limits it is the
 * escalating price (`stateOrgLevelCost`) against a bonus curve that flattens
 * (`stateOrgBonusFraction`), so the marginal level gets rapidly worse value.
 *
 * Paid from the CAMPAIGN's own pools (`campaigns.actions` / `campaigns.funds`),
 * not the player's personal ones. Presence is campaign infrastructure and
 * should compete with the media / ground-game / opposition-research trees for
 * one budget. This also puts the price against the pot that actually holds the
 * money: live presidential treasuries run $196M-$284M, against which the old
 * flat $50k was ~0.02% and effectively free.
 *
 * Auth: requireAuthWithCharacter (must be a US character with a campaign)
 * Errors: 400 (bad input / no campaign / insufficient campaign actions or
 *         funds / throttled), 403 (non-US), 401, 409 (race), 500
 *
 * Crash-safe settlement (issue #1672): the campaign debit + org upsert run
 * as exactly-once money flow under the client's `Idempotency-Key` (minted
 * when absent). A retry with the same key replays the stored outcome instead
 * of charging again.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const limit = checkRateLimit(
      `election:${auth.user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const character = auth.user.character;
    if (character.countryId !== "US") {
      return NextResponse.json(
        forbidden("Campaign Presence is currently a US-only feature").toJson(),
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }
    const { stateId } = parsed.data;

    const db = await getDb();
    const { admittedIds, preset } = await loadUsPoliticalStateIds(db);
    if (!isUsResidentPoliticalRegion(stateId, preset, admittedIds)) {
      return NextResponse.json(
        badRequest(unplayableTerritoryHomeError(stateId)).toJson(),
        { status: 400 }
      );
    }

    const freshChar = await db
      .collection<Character>("characters")
      .findOne({ _id: character._id }, { projection: { countryId: 1 } });
    if (!freshChar) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 404 });
    }

    // Campaign Presence is campaign infrastructure and is paid for out of the
    // campaign's own pools. A character with no active campaign has nothing to
    // build presence FOR, so this is a clean 400 rather than a silent fallback
    // onto personal action points.
    const campaign = await db
      .collection<Campaign>("campaigns")
      .findOne(
        { candidateId: character._id, status: { $ne: "archived" } },
        { projection: { actions: 1, funds: 1 } }
      );
    if (!campaign) {
      return NextResponse.json(
        badRequest(
          "You need an active campaign to build Campaign Presence — it is funded by the campaign, not by you personally."
        ).toJson(),
        { status: 400 }
      );
    }
    if ((campaign.actions ?? 0) < STATE_ORG_COST_ACTIONS) {
      return NextResponse.json(
        badRequest(
          `Not enough campaign actions — building presence costs ${STATE_ORG_COST_ACTIONS} (campaign has ${campaign.actions ?? 0})`
        ).toJson(),
        { status: 400 }
      );
    }

    // Price the NEXT level off the current one — presence escalates, so the
    // cost is read before the gate and re-asserted inside the atomic update so
    // a racing build cannot buy a level at a stale (cheaper) price.
    const existing = await db
      .collection<CharacterStateOrg>("characterStateOrg")
      .findOne({ characterId: character._id, stateId }, { projection: { level: 1 } });
    const currentLevel = existing?.level ?? 0;
    const costFundsAnchor = stateOrgLevelCost(currentLevel);

    const forexEnabled = await isForexEnabled();
    const { rate: homeFxRate } = forexEnabled
      ? await loadCharacterFxRate(db, getHomeCurrency(freshChar))
      : { rate: 1 };
    // Anchor-denominated cost → the campaign treasury's own currency.
    const costFundsLocal = forexEnabled ? costFundsAnchor * homeFxRate : costFundsAnchor;
    if ((campaign.funds ?? 0) < costFundsLocal) {
      return NextResponse.json(
        badRequest(
          `Not enough campaign funds — level ${currentLevel + 1} in ${stateId} costs $${Math.round(costFundsAnchor).toLocaleString()} (campaign has $${Math.floor(campaign.funds ?? 0).toLocaleString()})`
        ).toJson(),
        { status: 400 }
      );
    }
    // The throttle is turn-based, not wall-clock. The current turn started at
    // the most recently processed turn boundary; a build that happened in the
    // current turn (updatedAt >= lastTurnProcessed) must wait until the next turn
    // advances lastTurnProcessed. This enforces "at most +1 per state per turn"
    // instead of the old 60-minute wall-clock window that locked players out for
    // the remainder of the current turn and part of the next one.
    const { lastTurnProcessed } = await getGameTime();
    const throttleCutoff = lastTurnProcessed;

    // Crash-safe spend (issue #1672): the guarded campaign debit and the
    // throttle + price-stability org upsert run as keyed idempotent steps.
    // A crash between them leaves an `in_progress` receipt that a same-key
    // retry reconciles; a lost throttle/level race compensates the debit and
    // surfaces as ORG_RACE_OR_THROTTLE, exactly like the historical refund.
    // The primitive reports the stored post-image, so no final re-read.
    let built: { level: number; totalInvested: number };
    try {
      const outcome = await applyStateOrgBuildSpend(db, {
        campaignId: campaign._id,
        characterId: character._id,
        stateId,
        currentLevel,
        actionCost: STATE_ORG_COST_ACTIONS,
        fundCostLocal: costFundsLocal,
        throttleCutoff,
        fingerprint: buildStateOrgBuildFingerprint({
          characterId: character._id,
          stateId,
          currentLevel,
          actionCost: STATE_ORG_COST_ACTIONS,
          fundCostLocal: costFundsLocal,
          throttleCutoff,
        }),
        ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
      });
      built = { level: outcome.level, totalInvested: outcome.totalInvested };
    } catch (error) {
      if (error instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "Build already settled; start a new attempt with a new key." },
          { status: 409 }
        );
      }
      if (error instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "Idempotency key was reused for a different build." },
          { status: 409 }
        );
      }
      const msg = error instanceof Error ? error.message : "";
      if (msg.startsWith(STATE_ORG_INSUFFICIENT_RESOURCES)) {
        return NextResponse.json(
          badRequest("Your campaign's actions or funds changed. Please try again.").toJson(),
          { status: 409 }
        );
      }
      if (msg.startsWith(STATE_ORG_RACE_OR_THROTTLE)) {
        return NextResponse.json(
          badRequest(
            `Already built ${stateId} this turn (cap ${STATE_ORG_PER_STATE_TURN_CAP} per state per turn), or another build landed first — reload for the current price`
          ).toJson(),
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      level: built.level,
      totalInvested: built.totalInvested,
      stateId,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

