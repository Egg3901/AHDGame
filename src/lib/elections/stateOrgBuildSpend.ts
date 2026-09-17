import { randomUUID } from "node:crypto";
import type { ClientSession, Collection, Db, Filter, ObjectId } from "mongodb";
import { MongoServerError } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  MAX_APPLIED_MONEY_FLOW_KEYS,
  claimMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Campaign, CharacterStateOrg } from "@/lib/db/types";

/** Campaign debit failed: actions or funds raced below the priced cost. */
export const STATE_ORG_INSUFFICIENT_RESOURCES = "INSUFFICIENT_RESOURCES";
/** Org upsert lost the throttle/level race (or hit the E11000 duplicate key). */
export const STATE_ORG_RACE_OR_THROTTLE = "ORG_RACE_OR_THROTTLE";

export interface StateOrgBuildSpendInput {
  campaignId: ObjectId;
  characterId: ObjectId;
  stateId: string;
  /** Level the price was computed off (the guard re-asserts it). */
  currentLevel: number;
  /** Campaign-action cost per +1 level (STATE_ORG_COST_ACTIONS). */
  actionCost: number;
  /** Priced cash cost in the campaign treasury's own currency (may be fractional under FX). */
  fundCostLocal: number;
  /** Turn-based throttle cutoff (lastTurnProcessed): builds at/after it lose. */
  throttleCutoff: Date;
  /**
   * Caller-chosen fingerprint of the intended build
   * (e.g. `char:state:pricedLevel:costLocal:cutoffMs`). A retry presenting
   * the same key with a different fingerprint is rejected instead of
   * returning the stored outcome for the wrong build.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same build replays the stored outcome instead of
   * charging again. Omit to mint one: the build is still crash-safe within
   * the attempt, but a client retry mints a new key and is treated as a new
   * build (still guarded by the atomic debit + throttle/level claim).
   */
  idempotencyKey?: string;
}

export interface StateOrgBuildOutcome {
  duplicate: boolean;
  level: number;
  totalInvested: number;
}

export function buildStateOrgBuildFingerprint(input: {
  characterId: ObjectId;
  stateId: string;
  currentLevel: number;
  actionCost: number;
  fundCostLocal: number;
  throttleCutoff: Date;
}): string {
  return [
    input.characterId.toString(),
    input.stateId,
    `level:${input.currentLevel}`,
    `actions:${input.actionCost}`,
    `funds:${input.fundCostLocal}`,
    `cutoff:${input.throttleCutoff.getTime()}`,
  ].join(":");
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded campaign
  // debit (a raced balance was `INSUFFICIENT_RESOURCES`, 409), index 1 the
  // guarded org upsert (a lost throttle/level race was
  // `ORG_RACE_OR_THROTTLE`, 409). The old fallback refunded the debit and
  // threw; the flow compensates the debit prefix instead.
  if (step.index === 0) return new Error(`${STATE_ORG_INSUFFICIENT_RESOURCES}:${outcome}`);
  return new Error(`${STATE_ORG_RACE_OR_THROTTLE}:${outcome}`);
}

/**
 * The `characterStateOrg` upsert filter carries throttle + level conditions
 * beyond the unique-index key { characterId, stateId }. When a doc already
 * exists but no longer matches those conditions (e.g. it was updated within
 * the throttle window), `upsert: true` attempts an INSERT, which the unique
 * index rejects with E11000. That is the throttle/race loser, not a server
 * error — the step disambiguates it into already-applied / guard-rejected.
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

/**
 * Buy +1 Campaign Presence level (campaign actions + treasury debit, org
 * upsert) so the result is exactly-once on every topology (issue #1672).
 * Step order mirrors the historical write order: the campaign debit lands
 * first, the org upsert second, and an upsert failure compensates the debit.
 *
 * Under real transactions the debit, the org write, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the debit and the upsert leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged level instead of spending for a level that never landed (or
 * landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 *
 * The org step is terminal (nothing runs after it), so it carries no revert:
 * a failed upsert compensates the debit prefix and settles `compensated`.
 * Reporting always follows the stored doc: on replay or crash-recovery the
 * flow re-reads the org row and reports the stored level/totalInvested
 * rather than recomputing them.
 */
export async function applyStateOrgBuildSpend(
  db: Db,
  input: StateOrgBuildSpendInput
): Promise<StateOrgBuildOutcome> {
  if (!input.campaignId) {
    throw new TypeError("State-org build spend needs campaignId");
  }
  if (!input.characterId) {
    throw new TypeError("State-org build spend needs characterId");
  }
  if (typeof input.stateId !== "string" || input.stateId.length === 0) {
    throw new TypeError("State-org build spend needs stateId");
  }
  if (!Number.isFinite(input.currentLevel) || input.currentLevel < 0) {
    throw new RangeError("State-org build current level must be non-negative");
  }
  if (!Number.isFinite(input.actionCost) || input.actionCost <= 0) {
    throw new RangeError("State-org build action cost must be positive");
  }
  if (!Number.isFinite(input.fundCostLocal) || input.fundCostLocal <= 0) {
    throw new RangeError("State-org build fund cost must be positive");
  }
  if (!(input.throttleCutoff instanceof Date) || Number.isNaN(input.throttleCutoff.getTime())) {
    throw new TypeError("State-org build spend needs throttleCutoff");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("State-org build idempotency key must be 1-128 characters");
  }

  const campaigns = db.collection<Campaign>("campaigns");
  const orgs = db.collection<CharacterStateOrg>("characterStateOrg");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = new Date();

  const readStoredOutcome = async (
    opts: { session?: ClientSession },
    fallbackLevel: number
  ): Promise<StateOrgBuildOutcome> => {
    const stored = await orgs.findOne(
      { characterId: input.characterId, stateId: input.stateId },
      { ...opts, projection: { level: 1, totalInvested: 1 } }
    );
    return {
      duplicate: true,
      level: stored?.level ?? fallbackLevel,
      totalInvested: stored?.totalInvested ?? input.actionCost,
    };
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") {
      return readStoredOutcome(opts, input.currentLevel + 1);
    }

    let builtLevel = input.currentLevel + 1;
    let builtTotalInvested = input.actionCost;

    // Terminal org step: the historical findOneAndUpdate upsert with its
    // throttle + price-stability guards, plus the key guard so a crashed-
    // and-retried build converges instead of stacking a second level. A
    // same-key retry whose key is already recorded misses the `$ne: key`
    // filter, falls into the upsert-insert path, hits E11000 on the unique
    // index, and disambiguates to already-applied below.
    const orgBuildStep: MoneyFlowStep = {
      name: "org-build",
      apply: async (stepOpts) => {
        const filter = {
          characterId: input.characterId,
          stateId: input.stateId,
          $or: [{ updatedAt: { $exists: false } }, { updatedAt: { $lt: input.throttleCutoff } }],
          $and: [
            {
              $or: [{ level: { $exists: false } }, { level: input.currentLevel }],
            },
          ],
          appliedMoneyFlowKeys: { $ne: key },
        } as Filter<CharacterStateOrg>;
        const update = {
          $inc: { level: 1, totalInvested: input.actionCost },
          $set: { updatedAt: now },
          $setOnInsert: { characterId: input.characterId, stateId: input.stateId },
          $push: {
            appliedMoneyFlowKeys: {
              $each: [key],
              $slice: -MAX_APPLIED_MONEY_FLOW_KEYS,
            },
          },
        } as unknown as Parameters<Collection<CharacterStateOrg>["findOneAndUpdate"]>[1];
        const stepSession = stepOpts?.session ? { session: stepOpts.session } : {};
        let doc: CharacterStateOrg | null;
        try {
          doc = await orgs.findOneAndUpdate(filter, update, {
            upsert: true,
            returnDocument: "after",
            ...stepSession,
          });
        } catch (error) {
          if (!isStateOrgDuplicateKey(error)) throw error;
          return disambiguateOrgBuild(stepSession);
        }
        if (!doc) {
          // Unreachable with upsert:true on a live collection, but a null
          // post-image means the guards no longer match: fail as the race
          // loser (compensate the debit) exactly like the historical path.
          return disambiguateOrgBuild(stepSession);
        }
        builtLevel = doc.level;
        builtTotalInvested = doc.totalInvested;
        return "applied" as const;
      },
    };

    const disambiguateOrgBuild = async (stepSession: {
      session?: ClientSession;
    }): Promise<MoneyFlowLegOutcome> => {
      const existing = await orgs.findOne(
        { characterId: input.characterId, stateId: input.stateId },
        { ...stepSession, projection: { appliedMoneyFlowKeys: 1, level: 1, totalInvested: 1 } }
      );
      if (!existing) return "guard-rejected";
      const keys = (existing as unknown as { appliedMoneyFlowKeys?: unknown }).appliedMoneyFlowKeys;
      if (Array.isArray(keys) && keys.includes(key)) {
        builtLevel = existing.level;
        builtTotalInvested = existing.totalInvested;
        return "already-applied";
      }
      return "guard-rejected";
    };

    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "campaign-debit",
          collection: campaigns,
          docId: input.campaignId,
          field: "funds",
          delta: -input.fundCostLocal,
          minBalance: input.fundCostLocal,
          extraIncs: { actions: -input.actionCost },
          extraFilter: { actions: { $gte: input.actionCost } },
          set: { updatedAt: now },
        }),
        orgBuildStep,
      ],
      mapSpendError,
      opts
    );
    if (claim === "in-progress") {
      // Crash-recovery retry: the steps converged onto the first attempt's
      // outcome. Report the stored doc, not the recomputed post-image.
      return readStoredOutcome(opts, builtLevel);
    }
    return { duplicate: false, level: builtLevel, totalInvested: builtTotalInvested };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
