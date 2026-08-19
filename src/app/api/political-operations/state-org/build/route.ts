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
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import {
  loadUsPoliticalStateIds,
  unplayableTerritoryHomeError,
} from "@/lib/elections/usPoliticalHome";
import { isUsResidentPoliticalRegion } from "@/lib/elections/statehoodAdmission";
import type { Campaign, Character, CharacterStateOrg } from "@/lib/db/types";
import { MongoServerError } from "mongodb";

const VALID_US_STATES = new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId));

/**
 * The characterStateOrg upsert filter (below) carries throttle + level
 * conditions beyond the unique-index key { characterId, stateId }. When a doc
 * already exists but no longer matches those conditions (e.g. it was updated
 * within the throttle window), `upsert: true` attempts an INSERT, which the
 * unique index rejects with E11000. That is the throttle/race loser — surface
 * it as ORG_RACE_OR_THROTTLE (clean 409) rather than an unhandled 500.
 */
function isStateOrgDuplicateKey(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000 &&
    (!!error.keyPattern?.characterId ||
      !!error.keyPattern?.stateId ||
      /\bcharacterStateOrg\b/.test(error.message))
  );
}

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
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

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
    const now = new Date();
    // The throttle is turn-based, not wall-clock. The current turn started at
    // the most recently processed turn boundary; a build that happened in the
    // current turn (updatedAt >= lastTurnProcessed) must wait until the next turn
    // advances lastTurnProcessed. This enforces "at most +1 per state per turn"
    // instead of the old 60-minute wall-clock window that locked players out for
    // the remainder of the current turn and part of the next one.
    const { lastTurnProcessed } = await getGameTime();
    const throttleCutoff = lastTurnProcessed;

    // Atomic guard: the upsert filter requires the doc to be absent OR at a
    // level < MAX AND last-updated before the start of the current turn. Combined
    // with the unique index on { characterId, stateId } seeded in core.ts, this
    // eliminates the read-then-write TOCTOU window — two parallel requests
    // serialize through the upsert and only one increments the level. A racing
    // partner whose filter no longer matches (because the first request just
    // updated the doc) returns null from findOneAndUpdate → we refund and 409.
    try {
      await runWithOptionalTransaction(
        async (session) => {
          const debitResult = await db.collection<Campaign>("campaigns").updateOne(
            {
              _id: campaign._id,
              actions: { $gte: STATE_ORG_COST_ACTIONS },
              funds: { $gte: costFundsLocal },
            },
            {
              $inc: {
                actions: -STATE_ORG_COST_ACTIONS,
                funds: -costFundsLocal,
              },
              $set: { updatedAt: now },
            },
            { session }
          );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

          let orgUpdate;
          try {
            orgUpdate = await db
              .collection<CharacterStateOrg>("characterStateOrg")
              .findOneAndUpdate(
                {
                  characterId: character._id,
                  stateId,
                  $or: [
                    { updatedAt: { $exists: false } },
                    { updatedAt: { $lt: throttleCutoff } },
                  ],
                  // No level ceiling. This asserts the level is still the one
                  // we priced, so a racing build cannot buy a level at a stale
                  // (cheaper) price on the escalating cost curve.
                  $and: [
                    {
                      $or: [
                        { level: { $exists: false } },
                        { level: currentLevel },
                      ],
                    },
                  ],
                },
                {
                  $inc: { level: 1, totalInvested: STATE_ORG_COST_ACTIONS },
                  $set: { updatedAt: now },
                  $setOnInsert: { characterId: character._id, stateId },
                },
                { upsert: true, returnDocument: "after", session }
              );
          } catch (error) {
            if (isStateOrgDuplicateKey(error)) throw new Error("ORG_RACE_OR_THROTTLE");
            throw error;
          }
          if (!orgUpdate) throw new Error("ORG_RACE_OR_THROTTLE");
        },
        async () => {
          const debitResult = await db.collection<Campaign>("campaigns").updateOne(
            {
              _id: campaign._id,
              actions: { $gte: STATE_ORG_COST_ACTIONS },
              funds: { $gte: costFundsLocal },
            },
            {
              $inc: {
                actions: -STATE_ORG_COST_ACTIONS,
                funds: -costFundsLocal,
              },
              $set: { updatedAt: now },
            }
          );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_RESOURCES");

          try {
            const orgUpdate = await db
              .collection<CharacterStateOrg>("characterStateOrg")
              .findOneAndUpdate(
                {
                  characterId: character._id,
                  stateId,
                  $or: [
                    { updatedAt: { $exists: false } },
                    { updatedAt: { $lt: throttleCutoff } },
                  ],
                  // No level ceiling. This asserts the level is still the one
                  // we priced, so a racing build cannot buy a level at a stale
                  // (cheaper) price on the escalating cost curve.
                  $and: [
                    {
                      $or: [
                        { level: { $exists: false } },
                        { level: currentLevel },
                      ],
                    },
                  ],
                },
                {
                  $inc: { level: 1, totalInvested: STATE_ORG_COST_ACTIONS },
                  $set: { updatedAt: now },
                  $setOnInsert: { characterId: character._id, stateId },
                },
                { upsert: true, returnDocument: "after" }
              );
            if (!orgUpdate) throw new Error("ORG_RACE_OR_THROTTLE");
          } catch (error) {
            await db.collection<Campaign>("campaigns").updateOne(
              { _id: campaign._id },
              {
                $inc: {
                  actions: STATE_ORG_COST_ACTIONS,
                  funds: costFundsLocal,
                },
                $set: { updatedAt: new Date() },
              }
            );
            if (isStateOrgDuplicateKey(error)) throw new Error("ORG_RACE_OR_THROTTLE");
            throw error;
          }
        }
      );
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === "INSUFFICIENT_RESOURCES") {
        return NextResponse.json(
          badRequest("Your campaign's actions or funds changed. Please try again.").toJson(),
          { status: 409 }
        );
      }
      if (msg === "ORG_RACE_OR_THROTTLE") {
        return NextResponse.json(
          badRequest(
            `Already built ${stateId} this turn (cap ${STATE_ORG_PER_STATE_TURN_CAP} per state per turn), or another build landed first — reload for the current price`
          ).toJson(),
          { status: 409 }
        );
      }
      throw error;
    }

    // Re-read the post-image after both paths complete. We can't reliably
    // close-over the value from inside runWithOptionalTransaction, so the
    // returned shape is sourced from a fresh findOne — single round trip
    // and avoids transaction-vs-callback bookkeeping.
    const final = await db
      .collection<CharacterStateOrg>("characterStateOrg")
      .findOne(
        { characterId: character._id, stateId },
        { projection: { level: 1, totalInvested: 1 } }
      );
    return NextResponse.json({
      level: final?.level ?? 1,
      totalInvested: final?.totalInvested ?? STATE_ORG_COST_ACTIONS,
      stateId,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

