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
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Character } from "@/lib/db/types";

export interface CentralBankNomination {
  characterId: ObjectId;
  characterName: string;
  nominatedBy: ObjectId;
  nominatedByName: string;
  nominatedAt: Date;
}

export interface NominateSpendInput {
  /** `_id` of the central bank document receiving the nomination. */
  bankId: string;
  /** Character spending the action point. */
  nominatorId: ObjectId;
  nomination: CentralBankNomination;
  /**
   * Caller-chosen fingerprint of the intended nomination
   * (`bank:target`). Must exclude volatile reads: a retry re-reads them,
   * and a fingerprint that moves per attempt would false-conflict.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same nomination replays the stored outcome
   * instead of charging again. Omit to mint one.
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: a raced action balance reads
  // as insufficient actions, a raced nominations array as a conflict.
  if (step.name === "nominator-actions") return new Error("INSUFFICIENT_ACTIONS");
  return new Error(`NOMINATION_CONFLICT:${outcome}`);
}

/**
 * Spend one action point and record a central-bank chair nomination so the
 * result is exactly-once on every topology (issue #1672).
 *
 * Under real transactions the debit, the nomination push, and the
 * idempotency receipt join the transaction and commit atomically, preserving
 * the old behavior. On a standalone deployment the fallback runs the same
 * writes as keyed idempotent steps: a crash between the debit and the push
 * leaves an `in_progress` receipt, and retrying with the same key
 * reconciles to exactly one charged nomination instead of charging for a
 * nomination that never landed (or pushing it twice). The push is terminal,
 * so it carries no inverse; a failure there compensates the debit.
 */
export async function applyNominateSpend(
  db: Db,
  input: NominateSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.bankId) {
    throw new TypeError("Nominate spend needs bankId");
  }
  if (!input.nominatorId) {
    throw new TypeError("Nominate spend needs nominatorId");
  }
  if (!input.nomination) {
    throw new TypeError("Nominate spend needs a nomination");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Nominate idempotency key must be 1-128 characters");
  }

  const characters = db.collection<Character>("characters");
  const centralBanks = db.collection<CentralBank>("centralBanks");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = new Date();

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "nominator-actions",
          collection: characters,
          docId: input.nominatorId,
          field: "actions",
          delta: -1,
          minBalance: 1,
        }),
        {
          name: "nomination-push",
          apply: (stepOpts) =>
            applyKeyedUpdate(
              key,
              {
                collection: centralBanks,
                filter: {
                  _id: input.bankId,
                  "nominations.characterId": { $ne: input.nomination.characterId },
                },
                update: {
                  $push: { nominations: input.nomination },
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
