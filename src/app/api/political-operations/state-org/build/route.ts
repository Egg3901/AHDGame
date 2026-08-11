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
  STATE_ORG_COST_FUNDS,
  STATE_ORG_MAX_LEVEL,
  STATE_ORG_PER_STATE_TURN_CAP,
} from "@/lib/electionEngine/constants";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import {
  loadUsPoliticalStateIds,
  unplayableTerritoryHomeError,
} from "@/lib/elections/usPoliticalHome";
import { isUsPoliticalState } from "@/lib/elections/statehoodAdmission";
import type { Character, CharacterStateOrg } from "@/lib/db/types";
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
 * Increments the authenticated US character's state-org level for the given
 * state by +1 (capped at STATE_ORG_MAX_LEVEL). Costs STATE_ORG_COST_ACTIONS
 * actions + STATE_ORG_COST_FUNDS (anchor units, forex-converted to local).
 *
 * Auth: requireAuthWithCharacter (must be a US character)
 * Errors: 400 (bad input / insufficient actions or funds / cap reached /
 *         throttled), 403 (non-US), 401, 409 (race), 500
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
        forbidden("State organization is currently a US-only feature").toJson(),
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
    if (!isUsPoliticalState(stateId, preset, admittedIds)) {
      return NextResponse.json(
        badRequest(unplayableTerritoryHomeError(stateId)).toJson(),
        { status: 400 }
      );
    }

    const freshChar = await db
      .collection<Character>("characters")
      .findOne(
        { _id: character._id },
        { projection: { actions: 1, funds: 1, currencyBalances: 1, countryId: 1 } }
      );
    if (!freshChar) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 404 });
    }
    if (freshChar.actions < STATE_ORG_COST_ACTIONS) {
      return NextResponse.json(
        badRequest(
          `Not enough actions — building state org costs ${STATE_ORG_COST_ACTIONS} (have ${freshChar.actions})`
        ).toJson(),
        { status: 400 }
      );
    }

    const forexEnabled = await isForexEnabled();
    const { rate: homeFxRate } = forexEnabled
      ? await loadCharacterFxRate(db, getHomeCurrency(freshChar))
      : { rate: 1 };
    // STATE_ORG_COST_FUNDS is anchor-denominated. Convert to local for the
    // gate + atomic $inc so both operate on currencyBalances.campaign.
    const costFundsLocal = forexEnabled ? STATE_ORG_COST_FUNDS * homeFxRate : STATE_ORG_COST_FUNDS;
    const balanceLocal = localCampaignBalance(freshChar, forexEnabled);
    if (balanceLocal < costFundsLocal) {
      return NextResponse.json(
        badRequest(
          `Not enough campaign funds — building state org costs $${STATE_ORG_COST_FUNDS.toLocaleString()}`
        ).toJson(),
        { status: 400 }
      );
    }

    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
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
          const debitResult = await db.collection<Character>("characters").updateOne(
            {
              _id: character._id,
              actions: { $gte: STATE_ORG_COST_ACTIONS },
              [campaignFundsField]: { $gte: costFundsLocal },
            },
            {
              $inc: {
                actions: -STATE_ORG_COST_ACTIONS,
                [campaignFundsField]: -costFundsLocal,
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
                  $and: [
                    {
                      $or: [
                        { level: { $exists: false } },
                        { level: { $lt: STATE_ORG_MAX_LEVEL } },
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
          const debitResult = await db.collection<Character>("characters").updateOne(
            {
              _id: character._id,
              actions: { $gte: STATE_ORG_COST_ACTIONS },
              [campaignFundsField]: { $gte: costFundsLocal },
            },
            {
              $inc: {
                actions: -STATE_ORG_COST_ACTIONS,
                [campaignFundsField]: -costFundsLocal,
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
                  $and: [
                    {
                      $or: [
                        { level: { $exists: false } },
                        { level: { $lt: STATE_ORG_MAX_LEVEL } },
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
            await db.collection<Character>("characters").updateOne(
              { _id: character._id },
              {
                $inc: {
                  actions: STATE_ORG_COST_ACTIONS,
                  [campaignFundsField]: costFundsLocal,
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
          badRequest("Your actions or campaign funds changed. Please try again.").toJson(),
          { status: 409 }
        );
      }
      if (msg === "ORG_RACE_OR_THROTTLE") {
        return NextResponse.json(
          badRequest(
            `Already built ${stateId} this turn (cap ${STATE_ORG_PER_STATE_TURN_CAP} per state per turn) or level cap reached`
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


