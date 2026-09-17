import { randomUUID } from "node:crypto";
import type { ClientSession, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import { TREASURY_TRANSFER_HISTORY_MAX } from "@/lib/constants/currencies";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank, TreasuryTransferRecord } from "@/lib/db/types/centralBank";

/** Thrown when another transfer holds the mutex or this turn already settled one. */
export class TreasuryTransferBusyError extends Error {
  constructor() {
    super("TREASURY_TRANSFER_BUSY");
    this.name = "TreasuryTransferBusyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface TreasuryTransferSpendInput {
  budgetId: string;
  bankId: string;
  /** Home-currency face value moved from federal surplus to CB reserveBalance. */
  amount: number;
  /**
   * Effective borrowing limit (see `effectiveBorrowingLimit`). When a number,
   * the budget debit is guarded on `surplus >= amount - debtCeiling`, exactly
   * matching the route's pre-check; omit when the limit does not apply.
   */
  debtCeiling?: number;
  currentTurn: number;
  /** Admins skip the one-transfer-per-turn gate (existing route contract). */
  isAdmin: boolean;
  /** Fully built history record; pushed verbatim on success. */
  record: TreasuryTransferRecord;
  /**
   * Caller-chosen fingerprint of the intended transfer
   * (e.g. `country:budget:amount:turn:actor`). A retry presenting the same
   * key with a different fingerprint is rejected instead of returning the
   * stored outcome for the wrong transfer.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same transfer replays the stored outcome instead
   * of moving money again. Omit to mint one: the transfer is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new transfer (still gated by the per-turn rule and the mutex).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical error surface: a rejected budget debit (a raced
  // surplus, a breached ceiling, or a missing row) was
  // "Transfer would breach the federal debt ceiling." (400). The terminal
  // reserve-credit step can only report applied/already-applied on success; a
  // missing bank row surfaces the historical claim-lost sentinel (500).
  if (step.name === "budget-debit") {
    return new Error("Transfer would breach the federal debt ceiling.");
  }
  return new Error(`TREASURY_TRANSFER_CLAIM_LOST:${outcome}`);
}

/**
 * Release a mutex claim this key owns. Key-scoped, so a failure path never
 * clears another attempt's live claim. No-op when the reserve-credit step
 * already released it on success (the common case) or when the claim never
 * landed. Best-effort outside a transaction: under real transactions the
 * claim joins the flow's transaction and aborts with it, making this a no-op.
 */
export async function releaseTreasuryTransferClaim(
  db: Db,
  bankId: string,
  key: string,
  session?: ClientSession
): Promise<void> {
  const opts = session ? { session } : {};
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bankId, treasuryTransferClaimKey: key },
    {
      $unset: { treasuryTransferInProgressAt: "", treasuryTransferClaimKey: "" },
      $set: { updatedAt: new Date() },
    },
    opts
  );
}

/**
 * Move federal surplus to the central bank FX reserve so the result is
 * exactly-once on every topology (issue #1672).
 *
 * The existing mutex (`treasuryTransferInProgressAt`) is preserved and
 * extended with the flow key (`treasuryTransferClaimKey`), so a crash between
 * the claim and the settlement is recognizable: a retry presenting the SAME
 * key re-adopts its own stale claim and reconciles the keyed legs instead of
 * failing against them, while a different key still sees the mutex as held.
 * The one-transfer-per-turn gate for non-admins is re-checked inside the flow
 * (after the receipt claim, like the player-ad window re-check) so a
 * concurrent submit cannot slip past the route's pre-check on either
 * topology; a gated-out attempt settles no receipt (TTL-cleaned) and throws
 * `TreasuryTransferBusyError`, preserving the historical 400.
 *
 * Under real transactions the claim, the legs, the history push, and the
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the budget debit and the reserve
 * credit leaves an `in_progress` receipt, and retrying with the same key
 * reconciles to exactly one transfer instead of debiting a surplus that never
 * landed (or crediting it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyTreasuryTransferSpend(
  db: Db,
  input: TreasuryTransferSpendInput
): Promise<{ duplicate: boolean; adopted: boolean; record: TreasuryTransferRecord }> {
  if (typeof input.budgetId !== "string" || input.budgetId.length === 0) {
    throw new TypeError("Treasury transfer spend needs a budgetId");
  }
  if (typeof input.bankId !== "string" || input.bankId.length === 0) {
    throw new TypeError("Treasury transfer spend needs a bankId");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new RangeError("Treasury transfer amount must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Treasury transfer idempotency key must be 1-128 characters");
  }

  const budgets = db.collection<FederalBudget>("federalBudget");
  const banks = db.collection<CentralBank>("centralBanks");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const debtFloor =
    typeof input.debtCeiling === "number" ? input.amount - input.debtCeiling : undefined;

  let adopted = false;
  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean, adopted, record: input.record };

    // Per-turn gate inside the flow so a concurrent submit cannot slip past
    // the route's pre-check on either topology. It runs only for fresh
    // claims: an `in-progress` claim is this same key's own crashed attempt,
    // whose history entry (if it landed before the crash) must not block its
    // recovery. A fresh key reaching here never settled a transfer, so a
    // same-turn history entry belongs to someone else's transfer.
    if (!input.isAdmin && claim === "fresh") {
      const bank = await banks.findOne({ _id: input.bankId } as Filter<CentralBank>, {
        projection: { treasuryTransferHistory: 1 },
        ...opts,
      });
      const history = bank?.treasuryTransferHistory ?? [];
      if (history.length > 0 && history[history.length - 1]!.turn === input.currentTurn) {
        // Settles no receipt (the throw leaves `in_progress`, TTL-cleaned);
        // retrying with the same key re-runs this gate and converges.
        throw new TreasuryTransferBusyError();
      }
    }

    // Mutex claim, adoptable by the same key: a crashed attempt's retry finds
    // its own `treasuryTransferClaimKey` and proceeds to reconcile the legs,
    // while any other key sees the mutex as held.
    const now = new Date();
    const claimedBefore = await banks.findOneAndUpdate(
      {
        _id: input.bankId,
        $or: [
          { treasuryTransferInProgressAt: { $exists: false } },
          { treasuryTransferClaimKey: key },
        ],
      } as Filter<CentralBank>,
      {
        $set: {
          treasuryTransferInProgressAt: now,
          treasuryTransferClaimKey: key,
          updatedAt: now,
        },
      },
      { returnDocument: "before", ...opts }
    );
    if (!claimedBefore) {
      throw new TreasuryTransferBusyError();
    }
    adopted = claimedBefore.treasuryTransferClaimKey === key;

    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "budget-debit",
          collection: budgets,
          docId: input.budgetId,
          field: "surplus",
          delta: -input.amount,
          extraIncs: {
            "spending.byCategory.fxReserveTransfer": input.amount,
            "spending.total": input.amount,
          },
          // The debt-floor guard rides as an extra filter (not minBalance,
          // which must be non-negative while the floor can sit below zero),
          // so the check and the debit are one atomic step. Dropped on
          // compensation so a refund is never guard-blocked.
          ...(debtFloor !== undefined
            ? { extraFilter: { surplus: { $gte: debtFloor } } as Filter<FederalBudget> }
            : {}),
          set: { updatedAt: now },
        }),
        {
          name: "reserve-credit",
          apply: (stepOpts) =>
            applyKeyedUpdate(
              key,
              {
                collection: banks,
                filter: { _id: input.bankId } as Filter<CentralBank>,
                update: {
                  $inc: { reserveBalance: input.amount },
                  $push: {
                    treasuryTransferHistory: {
                      $each: [input.record],
                      $slice: -TREASURY_TRANSFER_HISTORY_MAX,
                    },
                  },
                  $set: { updatedAt: new Date() },
                  // The success path releases the mutex in the SAME atomic
                  // write as the credit and the history push: no window where
                  // the money moved but the claim is still held.
                  $unset: { treasuryTransferInProgressAt: "", treasuryTransferClaimKey: "" },
                },
              },
              stepOpts ?? {}
            ),
          revert: (stepOpts) =>
            applyKeyedUpdate(
              `${key}:compensate:reserve-credit`,
              {
                collection: banks,
                filter: { _id: input.bankId } as Filter<CentralBank>,
                update: {
                  $inc: { reserveBalance: -input.amount },
                  // Exact-document pull: revert runs in the same attempt as
                  // the apply it undoes (this step is last, so nothing after
                  // it can fail in a later recovery), hence the same record
                  // object, hence an exact match that cannot catch a sibling
                  // transfer's entry.
                  $pull: { treasuryTransferHistory: input.record },
                  $set: { updatedAt: new Date() },
                },
              },
              stepOpts ?? {}
            ),
        },
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress", adopted, record: input.record };
  };

  try {
    return await runWithOptionalTransaction(
      async (session) => runSpend(session),
      async () => runSpend()
    );
  } catch (error) {
    // Failure paths must not leave our own claim held: the success path
    // already released it, so this is a no-op there and a targeted release
    // everywhere else (key-scoped: never another attempt's claim).
    await releaseTreasuryTransferClaim(db, input.bankId, key);
    throw error;
  }
}
