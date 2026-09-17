import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  keyedInsertId,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Character, Union } from "@/lib/db/types";

/** Combined spend failed: funds or actions raced, or the character row is gone. */
export const FOUNDING_SPEND_INSUFFICIENT = "FOUNDING_SPEND_INSUFFICIENT";
/** Union insert failed: a legacy unique index still blocks the second union. */
export const FOUNDING_INSERT_BLOCKED = "FOUNDING_INSERT_BLOCKED";
/** Union insert failed another way (infra): the spend prefix was refunded. */
export const FOUNDING_INSERT_FAILED = "FOUNDING_INSERT_FAILED";
/** Leadership claim failed: a concurrent win elsewhere made the founder a leader. */
export const FOUNDING_LEADERSHIP_CHANGED = "FOUNDING_LEADERSHIP_CHANGED";

export interface UnionFoundingSpendInput {
  characterId: ObjectId;
  /**
   * Character campaign-funds field (`currencyBalances.campaign` post-forex,
   * `funds` pre-forex). Both costs come out of ONE guarded leg, so partial
   * payment is unrepresentable and a concurrent spend loses the race outright.
   */
  campaignFundsField: string;
  costFundsLocal: number;
  costActions: number;
  /** Union row to record; the `_id` derives from the idempotency key. */
  unionDoc: Omit<Union, "_id">;
  /** Pre-founding character `updatedAt`; the claim inverse restores it. */
  priorCharacterUpdatedAt: Date;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended founding
   * (e.g. `found-union:<country>:<sector>:<name>`). A retry presenting the
   * same key with a different fingerprint is rejected instead of returning
   * the stored outcome for the wrong founding.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same founding replays the stored outcome instead
   * of charging again. Omit to mint one: the founding is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new founding (still guarded by the atomic spend).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the combined
  // guarded spend (a raced balance was `Your campaign funds or action points
  // changed`, 409). The union insert distinguishes a legacy-index block (a
  // duplicate key with no row under OUR deterministic `_id` means some older
  // unique index rejected the second union, the historical contact-ops 409)
  // from other insert failures (the historical refunded 409). The terminal
  // leadership claim (a lost race was `You already lead a union`, 409)
  // unwinds the founding via compensation: the union row is deleted and the
  // spend refunded.
  if (step.index === 0) return new Error(`${FOUNDING_SPEND_INSUFFICIENT}:${outcome}`);
  if (step.name === "union-insert") {
    return outcome === "missing"
      ? new Error(`${FOUNDING_INSERT_BLOCKED}:${outcome}`)
      : new Error(`${FOUNDING_INSERT_FAILED}:${outcome}`);
  }
  return new Error(`${FOUNDING_LEADERSHIP_CHANGED}:${outcome}`);
}

/**
 * Found a union (combined actions+funds spend + union insert + leadership
 * claim) so the result is exactly-once on every topology (issue #1672). Step
 * order mirrors the historical write order: the spend lands first, the union
 * row second, the leadership claim last, and a later failure compensates the
 * applied prefix in reverse — the historical refund-on-failure, made
 * crash-safe.
 *
 * The union `_id` derives deterministically from the idempotency key, so a
 * client retry (or crash recovery) under the same key rebuilds the same
 * `_id` and the insert step converges instead of founding a second union.
 *
 * Under real transactions the spend, the insert, the claim, and the
 * idempotency receipt join the transaction and commit atomically, preserving
 * the old behavior. On a standalone deployment the fallback runs the same
 * writes as keyed idempotent steps: a crash between them leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged founding instead of charging for a union that never landed (or
 * landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyUnionFoundingSpend(
  db: Db,
  input: UnionFoundingSpendInput
): Promise<{ duplicate: boolean; unionId: ObjectId }> {
  if (!input.characterId) {
    throw new TypeError("Union founding spend needs characterId");
  }
  if (typeof input.campaignFundsField !== "string" || input.campaignFundsField.length === 0) {
    throw new TypeError("Union founding spend needs a campaign funds field");
  }
  if (!Number.isFinite(input.costFundsLocal) || input.costFundsLocal <= 0) {
    throw new RangeError("Union founding funds cost must be positive");
  }
  if (!Number.isFinite(input.costActions) || input.costActions <= 0) {
    throw new RangeError("Union founding action cost must be positive");
  }
  if (!input.unionDoc || typeof input.unionDoc !== "object") {
    throw new TypeError("Union founding spend needs a union document");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Union founding idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const unions = db.collection<Union>("unions");
  const now = input.now;
  const unionId = keyedInsertId(key, "union-founding");

  // The union insert and its inverse close over the deterministic `_id`.
  // A duplicate key on OUR `_id` is convergence (`already-applied`); a
  // duplicate key with no row under our `_id` is a legacy (countryId,
  // sectorType) unique index some worlds still carry, reported as `missing`
  // so the caller keeps the historical contact-ops message. Any other
  // survived insert error (a real crash runs no code at all) reports
  // `guard-rejected` so the spend prefix is compensated instead of stranded
  // charged-with-no-union. The inverse deletes exactly our row and lets an
  // unexpected throw escape: a failed undo is unknown state, so the receipt
  // must rest `in_progress` (fail open, retry converges) rather than settle
  // terminal as if the prefix were reversed.
  const unionInsertStep: MoneyFlowStep = {
    name: "union-insert",
    apply: async (stepOpts) => {
      const insertOpts = (stepOpts?.session ? { session: stepOpts.session } : undefined) as
        | { session: ClientSession }
        | undefined;
      try {
        await unions.insertOne({ _id: unionId, ...input.unionDoc } as Union, insertOpts);
        return "applied";
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code !== 11000) return "guard-rejected";
        const existing = await unions.findOne({ _id: unionId }, insertOpts);
        if (existing) return "already-applied";
        return "missing";
      }
    },
    revert: async (stepOpts) => {
      const deleteOpts = (stepOpts?.session ? { session: stepOpts.session } : undefined) as
        | { session: ClientSession }
        | undefined;
      const result = await unions.deleteOne(
        { _id: unionId, ownerId: input.characterId },
        deleteOpts
      );
      return result.deletedCount === 1 ? "applied" : "guard-rejected";
    },
  };

  // The leadership claim and its inverse close over the pre-founding
  // snapshot. The claim runs under a step-scoped key, NOT the flow key: the
  // founding-debit leg already recorded the flow key on this same character
  // document, so reusing it here would trip the `$ne: key` guard on every
  // attempt and misreport `already-applied` without ever writing
  // `unionLeaderOf`. The inverse clears exactly our claim and restores the
  // exact prior `updatedAt`, so a compensated founding leaves no phantom
  // leadership behind (mirroring the historical delete-plus-refund unwind).
  const leadershipClaimStep: MoneyFlowStep = {
    name: "leadership-claim",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        `${key}:leadership-claim`,
        {
          collection: characters,
          filter: {
            _id: input.characterId,
            $or: [{ unionLeaderOf: null }, { unionLeaderOf: { $exists: false } }],
          },
          update: {
            $set: { unionLeaderOf: unionId, updatedAt: now },
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        `${key}:compensate:leadership-claim`,
        {
          collection: characters,
          filter: { _id: input.characterId, unionLeaderOf: unionId },
          update: {
            $unset: { unionLeaderOf: "" },
            $set: { updatedAt: input.priorCharacterUpdatedAt },
          },
        },
        stepOpts ?? {}
      ),
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean, unionId };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "founding-debit",
          collection: characters,
          docId: input.characterId,
          field: input.campaignFundsField,
          delta: -input.costFundsLocal,
          minBalance: input.costFundsLocal,
          extraIncs: { actions: -input.costActions },
          extraFilter: { actions: { $gte: input.costActions } },
          set: { updatedAt: now },
        }),
        unionInsertStep,
        leadershipClaimStep,
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress", unionId };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
