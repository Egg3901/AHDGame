import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Campaign, Character } from "@/lib/db/types";

/** Character debit failed: actions or campaign funds raced, or the row is gone. */
export const STRENGTH_DEBIT_INSUFFICIENT = "STRENGTH_DEBIT_INSUFFICIENT";
/** Campaign credit failed: the campaign row is gone (debit refunded by compensation). */
export const STRENGTH_CAMPAIGN_MISSING = "STRENGTH_CAMPAIGN_MISSING";
/** Audit-row insert failed after the spend landed (prefix compensated, fail closed). */
export const STRENGTH_ACTIVITY_FAILED = "STRENGTH_ACTIVITY_FAILED";

export interface CampaignStrengthSpendInput {
  characterId: ObjectId;
  campaignId: ObjectId;
  /**
   * Character balance field the cost guards on (`currencyBalances.campaign`
   * post-forex, `funds` pre-forex). The never-forex `actions` debit rides in
   * the same atomic leg via `extraIncs`, so a buyer can never pay funds and
   * keep the actions (or the reverse).
   */
  fundsField: string;
  /** Local-currency funds cost resolved from the pre-spend quote. */
  costFundsLocal: number;
  costActions: number;
  strengthAdded: number;
  /** Campaign `updatedAt` before the spend; the credit inverse restores it. */
  priorCampaignUpdatedAt: Date;
  now: Date;
  /** Audit row recorded exactly once per key; the `_id` derives from the key. */
  activityEntry: Record<string, unknown>;
  /**
   * Caller-chosen fingerprint of the intended purchase
   * (e.g. `campaign-strength:<campaign>:<character>:<clicks>:<per-click>`).
   * Built from stable request inputs, never from the resolved quote: the
   * quote depends on live campaign strength, so a same-key crash recovery
   * that recomputes it must converge on the stored steps (key guards), not
   * fail closed on a fingerprint mismatch. The caller reports its recomputed
   * quote, matching the stored one whenever nothing moved between attempts.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same purchase replays the stored outcome instead
   * of charging again. Omit to mint one: the purchase is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new purchase (still guarded by the atomic debit).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded
  // character debit (a raced balance was `Insufficient resources`, 400; a
  // vanished row was `Character not found`, 404). Index 1 is the campaign
  // credit, which can only fail when the campaign row is gone — the old code
  // refunded the debit and answered 404, and compensation does the refund
  // here. Index 2 is the terminal audit insert: a survived insert error (a
  // real crash runs no code at all) compensates the spend prefix instead of
  // stranding charged-for-nothing strength.
  if (step.index === 0) {
    return outcome === "missing"
      ? new Error(`${STRENGTH_DEBIT_INSUFFICIENT}:character-missing`)
      : new Error(`${STRENGTH_DEBIT_INSUFFICIENT}:${outcome}`);
  }
  if (step.index === 1) return new Error(`${STRENGTH_CAMPAIGN_MISSING}:${outcome}`);
  return new Error(`${STRENGTH_ACTIVITY_FAILED}:${outcome}`);
}

/**
 * Move a campaign-strength purchase (character debit + campaign credit with
 * audit row) so the result is exactly-once on every topology (issue #1672).
 *
 * Under real transactions the debit, the credit, the audit insert, and the
 * idempotency receipt join the transaction and commit atomically, preserving
 * the old behavior. On a standalone deployment the fallback runs the same
 * writes as keyed idempotent steps: a crash between them leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged purchase instead of charging for strength that never landed
 * (or landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyCampaignStrengthSpend(
  db: Db,
  input: CampaignStrengthSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.characterId || !input.campaignId) {
    throw new TypeError("Campaign strength spend needs characterId and campaignId");
  }
  if (typeof input.fundsField !== "string" || input.fundsField.length === 0) {
    throw new TypeError("Campaign strength spend needs a funds field");
  }
  if (!Number.isFinite(input.costFundsLocal) || input.costFundsLocal <= 0) {
    throw new RangeError("Campaign strength funds cost must be positive");
  }
  if (!Number.isFinite(input.costActions) || input.costActions <= 0) {
    throw new RangeError("Campaign strength action cost must be positive");
  }
  if (!Number.isFinite(input.strengthAdded) || input.strengthAdded <= 0) {
    throw new RangeError("Campaign strength gain must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Campaign strength idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const campaigns = db.collection<Campaign>("campaigns");
  const activityLog = db.collection("activityLog");
  const now = input.now;

  // The campaign credit and its inverse close over the pre-spend snapshot.
  // The inverse negates the exact credited gain and restores the exact prior
  // `updatedAt`, so a compensated purchase is invisible downstream.
  const campaignCreditStep: MoneyFlowStep = {
    name: "campaign-credit",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        key,
        {
          collection: campaigns,
          filter: { _id: input.campaignId },
          update: {
            $inc: { campaignStrength: input.strengthAdded },
            $set: { updatedAt: now },
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", "campaign-credit"),
        {
          collection: campaigns,
          filter: { _id: input.campaignId },
          update: {
            $inc: { campaignStrength: -input.strengthAdded },
            $set: { updatedAt: input.priorCampaignUpdatedAt },
          },
        },
        stepOpts ?? {}
      ),
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "character-debit",
          collection: characters,
          docId: input.characterId,
          field: input.fundsField,
          delta: -input.costFundsLocal,
          minBalance: input.costFundsLocal,
          extraIncs: { actions: -input.costActions },
          extraFilter: { actions: { $gte: input.costActions } },
          set: { updatedAt: now },
        }),
        campaignCreditStep,
        // Terminal step: nothing runs after it, so it carries no inverse. A
        // survived insert error reports `guard-rejected` so the spend prefix
        // is compensated instead of stranded charged-with-no-audit-row; the
        // caller maps the step to its own error. Duplicate `_id` still
        // converges to `already-applied` inside `insertKeyedDoc`.
        makeInsertStep("activity-record", activityLog, {
          _id: keyedInsertId(key, "campaign-strength"),
          ...input.activityEntry,
        }),
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
