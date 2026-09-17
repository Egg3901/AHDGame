import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Character, Union } from "@/lib/db/types";

/** Funder debit failed: campaign funds raced, or the character row is gone. */
export const UNION_FUND_DEBIT_INSUFFICIENT = "UNION_FUND_DEBIT_INSUFFICIENT";
/** Treasury credit failed: the union row is gone (debit refunded by compensation). */
export const UNION_FUND_CREDIT_FAILED = "UNION_FUND_CREDIT_FAILED";

export interface UnionTreasuryFundingSpendInput {
  characterId: ObjectId;
  unionId: ObjectId;
  /**
   * Character campaign-funds field (`currencyBalances.campaign` post-forex,
   * `funds` pre-forex). Personal wealth is deliberately not a route in (see
   * the command), so the leg guards exactly this field.
   */
  campaignFundsField: string;
  /** Whole-unit contribution resolved by the caller. */
  contribution: number;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended contribution
   * (e.g. `fund:<character>:<union>:<amount>`). A retry presenting the same
   * key with a different fingerprint is rejected instead of returning the
   * stored outcome for the wrong contribution.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same contribution replays the stored outcome
   * instead of charging again. Omit to mint one: the contribution is still
   * crash-safe within the attempt, but a client retry mints a new key and is
   * treated as a new contribution (still guarded by the atomic debit).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded
  // campaign-funds debit (a raced balance was the 402 shortfall message).
  // Index 1 is the terminal treasury credit, which can only fail when the
  // union row is gone — the old code refunded the debit and answered 500,
  // and compensation does the refund here.
  if (step.index === 0) {
    return outcome === "missing"
      ? new Error(`${UNION_FUND_DEBIT_INSUFFICIENT}:character-missing`)
      : new Error(`${UNION_FUND_DEBIT_INSUFFICIENT}:${outcome}`);
  }
  return new Error(`${UNION_FUND_CREDIT_FAILED}:${outcome}`);
}

/**
 * Move campaign funds into a union treasury (funder debit + treasury credit)
 * so the result is exactly-once on every topology (issue #1672).
 *
 * Under real transactions the debit, the credit, and the idempotency receipt
 * join the transaction and commit atomically, preserving the old behavior.
 * On a standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between the debit and the credit leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged contribution instead of charging for money that never landed
 * (or landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyUnionTreasuryFundingSpend(
  db: Db,
  input: UnionTreasuryFundingSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.characterId || !input.unionId) {
    throw new TypeError("Union treasury funding spend needs characterId and unionId");
  }
  if (typeof input.campaignFundsField !== "string" || input.campaignFundsField.length === 0) {
    throw new TypeError("Union treasury funding spend needs a campaign funds field");
  }
  if (!Number.isFinite(input.contribution) || input.contribution <= 0) {
    throw new RangeError("Union treasury contribution must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Union treasury funding idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const unions = db.collection<Union>("unions");
  const now = input.now;

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "funder-debit",
          collection: characters,
          docId: input.characterId,
          field: input.campaignFundsField,
          delta: -input.contribution,
          minBalance: input.contribution,
          set: { updatedAt: now },
        }),
        {
          // Terminal step: nothing runs after it, so it carries no inverse.
          // A survived credit error (a real crash runs no code at all, so
          // anything observed here is a failure the process lived through)
          // reports `guard-rejected` so the debit prefix is compensated
          // instead of stranded charged-with-no-credit.
          name: "treasury-credit",
          apply: (stepOpts) =>
            applyKeyedUpdate(
              key,
              {
                collection: unions,
                filter: { _id: input.unionId },
                update: {
                  $inc: { treasury: input.contribution },
                  $set: { updatedAt: now },
                },
              },
              stepOpts ?? {}
            ),
        },
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
