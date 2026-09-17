import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type {
  BargainingCampaign,
  BargainingEscalationLevel,
  BargainingMandate,
  CorporateSector,
  Union,
} from "@/lib/db/types";

/** Campaign claim failed: the dispute moved under the caller, or the row is gone. */
export const ESCALATION_CAMPAIGN_CHANGED = "CAMPAIGN_CHANGED";
/** Treasury debit failed: the strike fund raced below the cost, or the union row is gone. */
export const ESCALATION_INSUFFICIENT_TREASURY = "INSUFFICIENT_TREASURY";
/** Strike start failed: a local's strike state moved under the caller, or the row is gone. */
export const ESCALATION_SECTOR_CHANGED = "SECTOR_CHANGED";

export interface EscalationStrikeTarget {
  sectorId: ObjectId;
  priorStrikeStartedAtTurn: number | null;
  priorExpectationIndex: number | null;
  newExpectation: number;
}

export interface EscalationRecordedExpectation {
  sectorId: ObjectId;
  previousExpectationIndex: number | null;
}

export interface BargainingEscalationSpendInput {
  campaignId: ObjectId;
  unionId: ObjectId;
  currentTurn: number;
  now: Date;
  /** Pre-escalation campaign values the claim guards on. */
  priorEscalationLevel: BargainingEscalationLevel;
  priorLastActionTurn: number;
  /** Escalated values written by the claim. */
  nextEscalationLevel: BargainingEscalationLevel;
  nextMandate: BargainingMandate;
  /** Newly recorded shop-floor expectations (pushed by the claim, pulled by its inverse). */
  recordedExpectations: EscalationRecordedExpectation[];
  /** Pre-escalation campaign values the claim inverse restores. */
  priorMandate: BargainingMandate;
  priorCampaignUpdatedAt: Date;
  priorEscalationStartedAtTurn: number | null;
  priorMandateUpdatedAtTurn: number | null;
  /** Strike-fund cost. Zero skips the debit step (free rung, no balance moves). */
  cashCost: number;
  priorLastCalledStrikeTurn: number | null;
  priorUnionUpdatedAt: Date;
  strikes: EscalationStrikeTarget[];
  /**
   * Caller-chosen fingerprint of the intended escalation
   * (e.g. `union:campaign:turn:level:cost`). A retry presenting the same key
   * with a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong escalation.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same escalation replays the stored outcome instead
   * of charging again. Omit to mint one: the escalation is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new escalation (still guarded by the atomic campaign claim).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded campaign
  // claim (a lost race was `CAMPAIGN_CHANGED`, 409), index 1 the guarded
  // treasury debit when present (a raced fund was `INSUFFICIENT_TREASURY`,
  // 402), and the per-local strike steps after it (a moved local was
  // `SECTOR_CHANGED`, 409) with the applied prefix compensated.
  if (step.index === 0) return new Error(`${ESCALATION_CAMPAIGN_CHANGED}:${outcome}`);
  if (step.name === "treasury-debit")
    return new Error(`${ESCALATION_INSUFFICIENT_TREASURY}:${outcome}`);
  return new Error(`${ESCALATION_SECTOR_CHANGED}:${outcome}`);
}

/**
 * Charge a bargaining escalation (campaign claim + strike-fund debit + strike
 * starts) so the result is exactly-once on every topology (issue #1672).
 * Step order mirrors the historical write order: the campaign claim lands
 * first, the treasury debit second, the strike starts last, and a later
 * failure compensates the applied prefix in reverse.
 *
 * Under real transactions the claim, the debit, the strikes, and the
 * idempotency receipt join the transaction and commit atomically, preserving
 * the old behavior. On a standalone deployment the fallback runs the same
 * writes as keyed idempotent steps: a crash between them leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to
 * exactly one charged escalation instead of charging for strikes that never
 * started (or starting them twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new escalation needs a new key.
 *
 * Reporting note: the mandate and the strike plan are recomputed live before
 * the flow, so a same-key recovery retry may compute different values than
 * the ones already applied. The stored state always wins (steps converge);
 * the caller reports its recomputed plan, which matches the stored one
 * whenever nothing moved between the attempts.
 */
export async function applyBargainingEscalationSpend(
  db: Db,
  input: BargainingEscalationSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.campaignId || !input.unionId) {
    throw new TypeError("Bargaining escalation spend needs campaignId and unionId");
  }
  if (!Number.isFinite(input.cashCost) || input.cashCost < 0) {
    throw new RangeError("Bargaining escalation cash cost must be non-negative");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bargaining escalation idempotency key must be 1-128 characters");
  }

  const campaigns = db.collection<BargainingCampaign>("bargainingCampaigns");
  const unions = db.collection<Union>("unions");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = input.now;

  // The campaign claim and its inverse close over the pre-escalation
  // snapshot. The inverse restores the exact prior fields (mirroring the
  // historical manual revert, including the conditional $unset of fields the
  // claim introduced) and pulls exactly the expectations the claim pushed, so
  // a compensated escalation is invisible downstream.
  const campaignClaimStep: MoneyFlowStep = {
    name: "campaign-claim",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        key,
        {
          collection: campaigns,
          filter: {
            _id: input.campaignId,
            status: "dispute",
            escalationLevel: input.priorEscalationLevel,
            lastActionTurn: input.priorLastActionTurn,
          },
          update: {
            $set: {
              escalationLevel: input.nextEscalationLevel,
              escalationStartedAtTurn: input.currentTurn,
              lastActionTurn: input.currentTurn,
              mandate: input.nextMandate,
              mandateUpdatedAtTurn: input.currentTurn,
              updatedAt: now,
            },
            ...(input.recordedExpectations.length > 0 && {
              $push: { escalationExpectations: { $each: input.recordedExpectations } },
            }),
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        `${key}:compensate:campaign-claim`,
        {
          collection: campaigns,
          filter: {
            _id: input.campaignId,
            status: "dispute",
            escalationLevel: input.nextEscalationLevel,
            lastActionTurn: input.currentTurn,
          },
          update: {
            $set: {
              escalationLevel: input.priorEscalationLevel,
              lastActionTurn: input.priorLastActionTurn,
              mandate: input.priorMandate,
              updatedAt: input.priorCampaignUpdatedAt,
              ...(input.priorEscalationStartedAtTurn != null && {
                escalationStartedAtTurn: input.priorEscalationStartedAtTurn,
              }),
              ...(input.priorMandateUpdatedAtTurn != null && {
                mandateUpdatedAtTurn: input.priorMandateUpdatedAtTurn,
              }),
            },
            ...(input.recordedExpectations.length > 0 && {
              $pull: {
                escalationExpectations: {
                  sectorId: { $in: input.recordedExpectations.map((entry) => entry.sectorId) },
                },
              },
            }),
            ...((input.priorEscalationStartedAtTurn == null ||
              input.priorMandateUpdatedAtTurn == null) && {
              $unset: {
                ...(input.priorEscalationStartedAtTurn == null && { escalationStartedAtTurn: "" }),
                ...(input.priorMandateUpdatedAtTurn == null && { mandateUpdatedAtTurn: "" }),
              },
            }),
          },
        },
        stepOpts ?? {}
      ),
  };

  // The treasury debit and its inverse close over the pre-escalation union
  // snapshot. Unlike the generic leg inverse (which would keep the debit's
  // $set), the inverse restores the exact prior `lastCalledStrikeTurn` and
  // `updatedAt`, mirroring the historical manual refund.
  const treasuryDebitStep: MoneyFlowStep = {
    name: "treasury-debit",
    apply: (stepOpts) =>
      applyIdempotentLeg(
        key,
        {
          name: "treasury-debit",
          collection: unions,
          docId: input.unionId,
          field: "treasury",
          delta: -input.cashCost,
          minBalance: input.cashCost,
          set: { lastCalledStrikeTurn: input.currentTurn, updatedAt: now },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyIdempotentLeg(
        `${key}:compensate:treasury-debit`,
        {
          name: "treasury-debit",
          collection: unions,
          docId: input.unionId,
          field: "treasury",
          delta: input.cashCost,
          set: {
            lastCalledStrikeTurn: input.priorLastCalledStrikeTurn,
            updatedAt: input.priorUnionUpdatedAt,
          },
        },
        stepOpts ?? {}
      ),
  };

  const strikeSteps: MoneyFlowStep[] = input.strikes.map((target, targetIndex) => ({
    name: `strike-${targetIndex}`,
    apply: (stepOpts) =>
      applyKeyedUpdate(
        key,
        {
          collection: sectors,
          filter: { _id: target.sectorId, strikeStartedAtTurn: target.priorStrikeStartedAtTurn },
          update: {
            $set: {
              strikeStartedAtTurn: input.currentTurn,
              workerExpectationIndex: target.newExpectation,
              updatedAt: now,
            },
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        `${key}:compensate:strike-${targetIndex}`,
        {
          collection: sectors,
          filter: { _id: target.sectorId, strikeStartedAtTurn: input.currentTurn },
          update:
            target.priorExpectationIndex == null
              ? {
                  $set: { strikeStartedAtTurn: target.priorStrikeStartedAtTurn },
                  $unset: { workerExpectationIndex: "" },
                }
              : {
                  $set: {
                    strikeStartedAtTurn: target.priorStrikeStartedAtTurn,
                    workerExpectationIndex: target.priorExpectationIndex,
                  },
                },
        },
        stepOpts ?? {}
      ),
  }));

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        campaignClaimStep,
        // A free rung moves no balance, so there is no debit to guard,
        // compensate, or collide with: the claim and the strikes stand alone.
        ...(input.cashCost > 0 ? [treasuryDebitStep] : []),
        ...strikeSteps,
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
