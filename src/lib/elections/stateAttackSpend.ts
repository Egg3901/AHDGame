import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Campaign, Character, PrimaryStateAction } from "@/lib/db/types";

export interface StateAttackSpendInput {
  characterId: ObjectId;
  campaignId: ObjectId;
  /** Character actions the attack costs. */
  costActions: number;
  /** Campaign funds the attack costs, in the campaign's own currency. */
  costFundsLocal: number;
  /** Attack row to record; the `_id` is derived from the idempotency key. */
  action: Omit<PrimaryStateAction, "_id">;
  /**
   * Caller-chosen fingerprint of the intended attack
   * (e.g. `actor:target:state:kind:turn`). A retry presenting the same key
   * with a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong attack.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same attack replays the stored outcome instead of
   * charging again. Omit to mint one: the attack is still crash-safe within
   * the attempt, but a client retry mints a new key and is treated as a new
   * attack (still guarded by the live-attack check in the route).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded
  // character-actions debit, index 1 the guarded campaign-funds debit (a
  // raced balance and a missing row were both `INSUFFICIENT_RESOURCES`).
  // Index 2 is the terminal attack-row insert, which can only report
  // applied/already-applied (a duplicate `_id` IS the convergence case).
  if (step.index <= 1) return new Error("INSUFFICIENT_RESOURCES");
  return new Error(`STATE_ATTACK_CONFLICT:${outcome}`);
}

/**
 * Charge a primary state attack (character actions + campaign funds) and
 * record the attack row so the result is exactly-once on every topology
 * (issue #1672).
 *
 * Under real transactions the legs, the row insert, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the debits and the insert leaves
 * an `in_progress` receipt, and retrying with the same key reconciles to
 * exactly one charged attack instead of charging for an attack that never
 * landed (or landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyStateAttackSpend(
  db: Db,
  input: StateAttackSpendInput
): Promise<{ duplicate: boolean; actionId: ObjectId }> {
  if (!input.characterId || !input.campaignId) {
    throw new TypeError("State attack spend needs characterId and campaignId");
  }
  if (!Number.isFinite(input.costActions) || input.costActions <= 0) {
    throw new RangeError("State attack costActions must be positive");
  }
  if (!Number.isFinite(input.costFundsLocal) || input.costFundsLocal <= 0) {
    throw new RangeError("State attack costFundsLocal must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("State attack idempotency key must be 1-128 characters");
  }

  const characters = db.collection<Character>("characters");
  const campaigns = db.collection<Campaign>("campaigns");
  const actions = db.collection<PrimaryStateAction>("primaryStateActions");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const actionId = keyedInsertId(key, "state-attack");

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean, actionId };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "actions-debit",
          collection: characters,
          docId: input.characterId,
          field: "actions",
          delta: -input.costActions,
          minBalance: input.costActions,
          set: { updatedAt: new Date() },
        }),
        makeLegStep(key, {
          name: "funds-debit",
          collection: campaigns,
          docId: input.campaignId,
          field: "funds",
          delta: -input.costFundsLocal,
          minBalance: input.costFundsLocal,
          set: { updatedAt: new Date() },
        }),
        makeInsertStep("attack-row", actions, { ...input.action, _id: actionId }),
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress", actionId };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
