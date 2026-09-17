import type { ClientSession, Collection, Filter } from "mongodb";
import type { ObjectId } from "mongodb";

/**
 * Partial-write safety for money flows on deployments without transaction
 * support (issue #1672).
 *
 * INVARIANTS (read before adding a call site):
 *
 * 1. Every balance mutation MUST go through `applyIdempotentLeg`. The
 *    idempotency key is recorded on the account document in the SAME atomic
 *    single-document write as the balance change (`$inc` + `$push` with a
 *    `$ne: key` filter), so a crashed-and-retried leg applies at most once
 *    no matter how many times it is re-run. A leg applied any other way
 *    cannot be reconciled safely.
 * 2. Legs always run in order and never skip: leg N runs only after every
 *    earlier leg reported `applied` or `already-applied`. If a leg fails
 *    after earlier legs applied, the applied prefix is reversed with
 *    compensation legs (also keyed, so crash-safe) before the receipt
 *    settles. A flow therefore ends `completed` (every leg applied exactly
 *    once) or terminal without effect (`failed` when nothing applied,
 *    `compensated` when the prefix was reversed). Never a partial state.
 * 3. First attempt and crash recovery are the SAME operation
 *    (`runMoneyFlowLegs`): re-running legs after a crash converges instead
 *    of double-applying, because of invariant 1.
 * 4. One key = one attempt. A key that settled `failed`/`compensated` stays
 *    terminal; a retry with the same key throws `MoneyFlowTerminalError`
 *    (fail closed) and a new attempt needs a new key. A key reused with a
 *    different fingerprint throws `MoneyFlowKeyConflictError`.
 * 5. Under real transactions this module is behavior-preserving: legs and
 *    receipt writes accept the caller's session and join the transaction,
 *    so commit/abort keeps the old atomicity. The key guard is harmless
 *    there (a re-invoked transaction callback re-applies cleanly).
 *
 * COVERAGE (issue #1672): migrated call sites use
 * `src/lib/character/campaignTransfer.ts`. Every other
 * `runWithOptionalTransaction` money-flow site (party/region donations and
 * recruitment, treasury transfer, bonds, forex orders/direct, election
 * spending, canvassing, player ads, union/corporate/campaign/index-fund
 * flows) still runs the legacy debit-first-plus-compensation fallback and is
 * NOT crash-safe between writes. Migrating a site means expressing its
 * balance writes as legs here; sites whose credit side is not a keyed
 * single-document `$inc` cannot use this module until it is.
 *
 * Operations note: receipts accumulate one small document per keyed flow. A
 * TTL index on `createdAt` should be added through the normal index-seeding
 * path; this module never creates indexes at runtime.
 */

export const NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION = "nonAtomicMoneyFlowReceipts";

/** Cap on stored keys per account document; bounds growth, not correctness. */
export const MAX_APPLIED_MONEY_FLOW_KEYS = 100;

export type MoneyFlowReceiptStatus = "in_progress" | "completed" | "failed" | "compensated";

export interface MoneyFlowReceipt {
  /** Idempotency key supplied by the caller. */
  _id: string;
  status: MoneyFlowReceiptStatus;
  /**
   * Caller-chosen fingerprint of the intended transfer
   * (e.g. `sender:target:amount:field`). A retry presenting the same key
   * with a different fingerprint is rejected instead of returning the
   * stored outcome for the wrong transfer.
   */
  fingerprint: string;
  /** Sentinel error code when the flow settled without completing. */
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Account documents that can carry keyed money-flow legs. */
export interface MoneyFlowAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

export type MoneyFlowLegOutcome = "applied" | "already-applied" | "missing" | "guard-rejected";

export interface MoneyFlowLeg<TDoc extends MoneyFlowAccount> {
  /** Stable name used in compensation keys (`${key}:compensate:${name}`). */
  name: string;
  collection: Collection<TDoc>;
  docId: ObjectId;
  /** Dotted balance field, e.g. `currencyBalances.campaign`. */
  field: string;
  /** Negative for a debit, positive for a credit. */
  delta: number;
  /**
   * Debit guard: the balance must be at least this before the write. Omit
   * for pure credits. Lives in the same filter as the key guard, so the
   * check and the mutation are one atomic step.
   */
  minBalance?: number;
}

export type MoneyFlowClaim = "fresh" | "in-progress" | "duplicate";

export class MoneyFlowKeyConflictError extends Error {
  readonly key: string;
  constructor(key: string) {
    super("Idempotency key was reused for a different transfer");
    this.name = "MoneyFlowKeyConflictError";
    this.key = key;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MoneyFlowTerminalError extends Error {
  readonly key: string;
  readonly status: MoneyFlowReceiptStatus;
  constructor(key: string, status: MoneyFlowReceiptStatus, detail?: string) {
    super(
      `Transfer already settled as ${status}; start a new attempt with a new key` +
        (detail ? `: ${detail}` : "")
    );
    this.name = "MoneyFlowTerminalError";
    this.key = key;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface MoneyFlowOptions {
  session?: ClientSession;
}

function sessionOpt(options: MoneyFlowOptions): { session: ClientSession } | undefined {
  return options.session ? { session: options.session } : undefined;
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

function validateKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 128) {
    throw new RangeError("Money flow idempotency key must be 1-128 characters");
  }
}

function validateLeg<TDoc extends MoneyFlowAccount>(leg: MoneyFlowLeg<TDoc>): void {
  if (!leg || typeof leg.name !== "string" || leg.name.length === 0) {
    throw new TypeError("Money flow leg needs a non-empty name");
  }
  if (!leg.collection || typeof leg.collection.updateOne !== "function") {
    throw new TypeError(`Money flow leg "${leg.name}" needs a collection`);
  }
  if (!leg.docId) {
    throw new TypeError(`Money flow leg "${leg.name}" needs a docId`);
  }
  if (typeof leg.field !== "string" || leg.field.length === 0) {
    throw new TypeError(`Money flow leg "${leg.name}" needs a balance field`);
  }
  if (!Number.isFinite(leg.delta) || leg.delta === 0) {
    throw new RangeError(`Money flow leg "${leg.name}" needs a finite non-zero delta`);
  }
  if (leg.minBalance !== undefined && (!Number.isFinite(leg.minBalance) || leg.minBalance < 0)) {
    throw new RangeError(`Money flow leg "${leg.name}" needs a finite non-negative minBalance`);
  }
}

/**
 * Apply one balance leg at most once per key. The `$ne: key` guard, the
 * optional `$gte` balance guard, the `$inc`, and the key record are a single
 * atomic update, so concurrent or retried applications cannot double-apply.
 * A `matchedCount === 0` is disambiguated with one projected read:
 * missing document, already applied, or guard rejected.
 */
export async function applyIdempotentLeg<TDoc extends MoneyFlowAccount>(
  key: string,
  leg: MoneyFlowLeg<TDoc>,
  options: MoneyFlowOptions = {}
): Promise<MoneyFlowLegOutcome> {
  validateKey(key);
  validateLeg(leg);
  const filter = {
    _id: leg.docId,
    appliedMoneyFlowKeys: { $ne: key },
    ...(leg.minBalance !== undefined ? { [leg.field]: { $gte: leg.minBalance } } : {}),
  } as Filter<TDoc>;
  const update = {
    $inc: { [leg.field]: leg.delta },
    $push: {
      appliedMoneyFlowKeys: {
        $each: [key],
        $slice: -MAX_APPLIED_MONEY_FLOW_KEYS,
      },
    },
  } as unknown as Parameters<Collection<TDoc>["updateOne"]>[1];
  const result = await leg.collection.updateOne(filter, update, sessionOpt(options));
  if (result.matchedCount === 1) return "applied";

  const existing = await leg.collection.findOne({ _id: leg.docId } as Filter<TDoc>, {
    projection: { appliedMoneyFlowKeys: 1 },
    ...sessionOpt(options),
  });
  if (!existing) return "missing";
  if (existing.appliedMoneyFlowKeys?.includes(key)) return "already-applied";
  return "guard-rejected";
}

/**
 * Claim the receipt for a key. `fresh` means this call owns the attempt;
 * `in-progress` means a previous attempt crashed (or a duplicate request is
 * racing) and the caller must reconcile by re-running the legs;
 * `duplicate` means the flow already completed. Terminal failures throw
 * `MoneyFlowTerminalError` (fail closed); key reuse with a different
 * fingerprint throws `MoneyFlowKeyConflictError`.
 */
export async function claimMoneyFlowReceipt(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  fingerprint: string,
  options: MoneyFlowOptions = {}
): Promise<MoneyFlowClaim> {
  validateKey(key);
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    throw new TypeError("Money flow claim needs a non-empty fingerprint");
  }
  const now = new Date();
  try {
    await receipts.insertOne(
      { _id: key, status: "in_progress", fingerprint, createdAt: now, updatedAt: now },
      sessionOpt(options)
    );
    return "fresh";
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const existing = await receipts.findOne(
    { _id: key } as Filter<MoneyFlowReceipt>,
    sessionOpt(options)
  );
  if (!existing) {
    throw new Error("MONEY_FLOW_RECEIPT_LOST");
  }
  if (existing.fingerprint !== fingerprint) {
    throw new MoneyFlowKeyConflictError(key);
  }
  if (existing.status === "completed") return "duplicate";
  if (existing.status === "in_progress") return "in-progress";
  throw new MoneyFlowTerminalError(key, existing.status, existing.error);
}

async function settleMoneyFlowReceipt(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  status: Extract<MoneyFlowReceiptStatus, "completed" | "failed" | "compensated">,
  error: string | undefined,
  options: MoneyFlowOptions
): Promise<void> {
  await receipts.updateOne(
    { _id: key } as Filter<MoneyFlowReceipt>,
    {
      $set: {
        status,
        updatedAt: new Date(),
        ...(error !== undefined ? { error } : {}),
      },
    },
    sessionOpt(options)
  );
}

/**
 * Run legs in order to exactly one terminal state. Idempotent: safe both as
 * the first attempt and as crash recovery, because every leg is keyed
 * (invariant 1). On a leg failure the already-applied prefix is reversed
 * with compensation keys before settling, so the receipt never rests
 * partial. Throws the caller's mapped error for the failed leg.
 */
export async function runMoneyFlowLegs<TDoc extends MoneyFlowAccount>(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  legs: Array<MoneyFlowLeg<TDoc>>,
  mapLegError: (index: number, outcome: MoneyFlowLegOutcome) => Error,
  options: MoneyFlowOptions = {}
): Promise<void> {
  validateKey(key);
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new TypeError("Money flow needs at least one leg");
  }
  legs.forEach(validateLeg);

  for (let index = 0; index < legs.length; index += 1) {
    const outcome = await applyIdempotentLeg(key, legs[index]!, options);
    if (outcome === "applied" || outcome === "already-applied") continue;

    if (index === 0) {
      const error = mapLegError(index, outcome);
      await settleMoneyFlowReceipt(receipts, key, "failed", error.message, options);
      throw error;
    }

    for (let back = index - 1; back >= 0; back -= 1) {
      const forward = legs[back]!;
      const reversal = await applyIdempotentLeg(
        `${key}:compensate:${forward.name}`,
        { ...forward, delta: -forward.delta, minBalance: undefined },
        options
      );
      if (reversal !== "applied" && reversal !== "already-applied") {
        const error = mapLegError(index, outcome);
        await settleMoneyFlowReceipt(
          receipts,
          key,
          "failed",
          `UNCOMPENSATED:${forward.name}:${reversal}`,
          options
        );
        throw error;
      }
    }
    const error = mapLegError(index, outcome);
    await settleMoneyFlowReceipt(receipts, key, "compensated", error.message, options);
    throw error;
  }

  await settleMoneyFlowReceipt(receipts, key, "completed", undefined, options);
}
