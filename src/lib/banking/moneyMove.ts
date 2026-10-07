/**
 * One way to move money across documents on a database with no transactions.
 *
 * ## The failure this exists to stop
 *
 * Standalone Mongo has no multi-document transaction. Every banking flow that
 * touched two documents therefore had its own hand-rolled ordering rule, and
 * the rules disagreed. Some wrote the debit first, some the credit; some
 * stamped an idempotency key after the money moved, which is the worst of the
 * three because a retry after a crash re-runs the whole move and pays twice.
 * The charter switch and the admin unwind managed something worse still: they
 * credited the central bank's money pool with the deposit book while leaving
 * the matching cash in the bank, so the same money existed in two places.
 *
 * Three rules, enforced by this module rather than remembered at each call site:
 *
 * 1. **The key is claimed BEFORE any money moves.** An `insertOne` on a unique
 *    `_id` is the claim. A retry loses the insert and returns the recorded
 *    result instead of moving anything.
 * 2. **Legs must net to zero.** A move that creates or destroys money has to
 *    say so explicitly with a `mint` or `burn` leg, which is recorded and
 *    auditable, rather than being an arithmetic slip nobody notices for fifteen
 *    patches.
 * 3. **Debits are guarded in the write.** Each debit leg carries its own filter
 *    requiring the balance to be there, so it can never drive a balance
 *    negative on a stale read. A leg that fails to apply stops the move and
 *    leaves it `partial` for {@link listUnfinishedMoneyMoves}, which is a visible,
 *    repairable state rather than silent money loss.
 *
 * At-most-once, not at-least-once, and deliberately so: the two failure modes
 * are not symmetric. A double payment silently creates money and cannot be
 * detected after the fact, while a half-applied move is recorded as `partial`
 * with the legs that landed, which an operator can see and finish.
 */

import { isDeepStrictEqual } from "node:util";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  NET_TOLERANCE,
  legsNet,
  moneyMoveValuationError,
  type ValueLegKind,
} from "@/lib/banking/rules/invariants";
import { validEquityCustodyMutation } from "./rules/equityCustody";
import { countBankingEvent } from "@/lib/banking/telemetry";

/** Collection holding the claim records. Also the repair queue. */
export const MONEY_MOVE_COLLECTION = "bankMoneyMoves";

/**
 * Money leaves a balance (`debit`, always guarded by a sufficiency filter),
 * arrives at one (`credit`), enters the world (`mint`: deposit insurance
 * backstop, central-bank liquidity) or leaves it (`burn`: write-off, uninsured
 * loss). The kinds and their signs are defined once, in the invariant catalog,
 * so the primitive and the checks that audit it cannot disagree.
 */
export type MoneyMoveLegKind = ValueLegKind;

export interface MoneyMoveLeg {
  kind: MoneyMoveLegKind;
  /** Positive magnitude. The sign is the leg kind's job, not the caller's. */
  amount: number;
  /** Frozen native-currency valuation for cross-currency transfers. */
  valuation?: { currencyCode: string; localPerAnchor: number };
  /** Collection the balance lives in. Omit for `mint` / `burn`. */
  collection?: string;
  /**
   * Document selector. Omit for `mint` / `burn`.
   *
   * Loosely typed on purpose: the balances this moves live in five collections
   * with three different `_id` types (ObjectId, currency code, country id), and
   * a generic parameter per leg would buy nothing but ceremony.
   */
  filter?: Record<string, unknown>;
  /** Dotted path of the numeric balance field. Omit for `mint` / `burn`. */
  path?: string;
  /** Additional `$set` applied with the same write (timestamps, status flips). */
  set?: Record<string, unknown>;
  /** What this leg is, for the audit record. */
  note: string;
}

/**
 * Where one side of a movement lands.
 *
 * Named because the same flow can have different destinations: a loan payment
 * to a live bank credits its vault, and the same payment to a bank that has
 * already been wound up credits whoever stood behind it. Passing the target in
 * is what stops that becoming two copies of the servicing code.
 */
export interface MoneyTarget {
  collection: string;
  filter: Record<string, unknown>;
  path: string;
  note: string;
}

export interface MoneyMove {
  /** Stable idempotency key. Same key = same move, forever. */
  key: string;
  /** What kind of flow this is, for the repair queue. */
  kind: string;
  turn?: number;
  /** Stable terms that distinguish a valued replay from a changed quote. */
  quoteIdentity?: unknown;
  legs: MoneyMoveLeg[];
  /**
   * Extra fields stored on the claim record in the same insert as the claim.
   * The settlement journal keeps its projections here, so a crash anywhere
   * after the claim leaves a record that already says what remains to do.
   */
  record?: Record<string, unknown>;
}

export type MoneyMoveStatus = "applied" | "partial" | "replayed" | "rejected";

export interface MoneyMoveResult {
  status: MoneyMoveStatus;
  /** Legs that were written. Index into `move.legs`. */
  applied: number[];
  /** Populated when a guarded debit did not apply, or the legs did not net. */
  error?: string;
}

export interface MoneyMoveRecordLeg {
  kind: MoneyMoveLegKind;
  amount: number;
  valuation?: { currencyCode: string; localPerAnchor: number };
  note: string;
  applied: boolean;
  refusal?: string;
  /**
   * The leg's target, kept on the record so a move that crashed between two
   * legs can be finished from the record alone. Absent on `mint` / `burn` and
   * on records written before targets were recorded (those are operator repairs).
   */
  collection?: string;
  filter?: Record<string, unknown>;
  path?: string;
  set?: Record<string, unknown>;
}

interface MoneyMoveRecord {
  genericMoneyMoveVersion?: number;
  moneyMoveBindingError?: string;
  atomicDocument?: unknown;
  legacyInterestBatch?: unknown;
  locSettlement?: unknown;
  treasuryReserveTransfer?: unknown;
  politicalMediaOrder?: unknown;
  quoteIdentity?: unknown;
  _id: string;
  kind: string;
  turn?: number;
  status: MoneyMoveStatus;
  legs: MoneyMoveRecordLeg[];
  /** Added by the settlement journal in the original claim, never a second record. */
  projections?: { applied?: boolean; appliedAt?: Date | null }[];
  retryCreditLegOnGuardFailure?: boolean;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

/** Re-exported so existing callers keep one import for the primitive. */
export { legsNet };

export type MoneyMoveClaim =
  | { status: "claimed"; legs: MoneyMoveLeg[] }
  | { status: "replayed" }
  | { status: "rejected"; error: string };

function valuedQuoteConflict(
  existing: MoneyMoveRecord | null,
  legs: readonly MoneyMoveLeg[],
  quoteIdentity: unknown
): boolean {
  if (!existing) return false;
  const hasValuation =
    existing.legs.some((leg) => leg.valuation) || legs.some((leg) => leg.valuation);
  if (!hasValuation) return false;
  const sameLegs =
    existing.legs.length === legs.length &&
    existing.legs.every((leg, index) => {
      const proposed = legs[index];
      return (
        proposed !== undefined &&
        leg.kind === proposed.kind &&
        leg.amount === proposed.amount &&
        isDeepStrictEqual(leg.valuation ?? null, proposed.valuation ?? null) &&
        leg.collection === proposed.collection &&
        leg.path === proposed.path &&
        isDeepStrictEqual(leg.filter ?? null, proposed.filter ?? null) &&
        isDeepStrictEqual(leg.set ?? null, proposed.set ?? null)
      );
    });
  return !sameLegs || !isDeepStrictEqual(existing.quoteIdentity ?? null, quoteIdentity ?? null);
}

function valuedQuoteConflictResult(key: string): MoneyMoveResult {
  return {
    status: "rejected",
    applied: [],
    error: `Money move ${key} already owns a different valued settlement quote.`,
  };
}

/**
 * Claim the key WITHOUT moving anything.
 *
 * Most flows should use {@link applyMoneyMove}, which claims and moves in one
 * call. This exists for the one shape that cannot: a leg whose counterparty is
 * thousands of documents with a different amount each, like paying deposit
 * interest to every saver at a bank. Turning that into one guarded `updateOne`
 * per depositor would cost a round trip per player per bank per turn, so the
 * caller keeps its `bulkWrite` and takes the two properties that actually
 * matter from here: the key is claimed before any money moves, and the legs are
 * recorded and checked to net to zero.
 *
 * Contract: a caller that gets `claimed` MUST finish with
 * {@link completeMoneyMove}, passing an error if it could not apply everything.
 * A claim that is never completed stays in the repair queue, which is the
 * correct place for a flow that stopped half way.
 */
export async function claimMoneyMove(db: Db, move: MoneyMove): Promise<MoneyMoveClaim> {
  if (move.legs.some((leg) => !Number.isFinite(leg.amount) || leg.amount < 0))
    return { status: "rejected", error: "Cash leg amount must be finite and nonnegative." };
  const valuationError = moneyMoveValuationError(move.legs);
  if (valuationError) return { status: "rejected", error: valuationError };
  if (move.legs.some((leg) => leg.kind === "asset" && !validEquityCustodyMutation(leg)))
    return {
      status: "rejected",
      error: "Equity custody must preserve shares without changing cash.",
    };
  const legs = move.legs.filter((leg) => Math.max(0, leg.amount) > 0 || leg.kind === "asset");
  if (legs.length === 0) return { status: "claimed", legs: [] };

  const net = legsNet(legs);
  if (Math.abs(net) > NET_TOLERANCE) {
    // Refuse rather than move: an unbalanced move is the exact bug class this
    // module exists to make impossible, so it must never be half-written.
    return {
      status: "rejected",
      error: `Money move ${move.key} does not net to zero (net ${net}).`,
    };
  }

  const record: MoneyMoveRecord = {
    ...(move.record ?? {}),
    ...(move.quoteIdentity !== undefined ? { quoteIdentity: move.quoteIdentity } : {}),
    _id: move.key,
    kind: move.kind,
    turn: move.turn,
    status: "partial",
    legs: legs.map((leg) => ({
      kind: leg.kind,
      amount: Math.max(0, leg.amount),
      ...(leg.valuation ? { valuation: leg.valuation } : {}),
      note: leg.note,
      applied: false,
      ...(leg.collection ? { collection: leg.collection } : {}),
      ...(leg.filter ? { filter: leg.filter } : {}),
      ...(leg.path ? { path: leg.path } : {}),
      ...(leg.set ? { set: leg.set } : {}),
    })),
    createdAt: new Date(),
  };

  try {
    await db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION).insertOne(record);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 11000) {
      // Duplicate key: somebody else owns this move. Never a reason to move money.
      return { status: "replayed" };
    }
    // Network, write-concern, and server failures do not prove that another
    // caller owns the key. Reporting them as replays silently drops the move.
    throw error;
  }
  return { status: "claimed", legs };
}

/**
 * Close a claimed move.
 *
 * `appliedLegs` is the indexes of the legs that landed, so a half-applied move
 * records WHICH half. An operator repairing it needs that; "something failed"
 * is not a repair instruction.
 */
export async function completeMoneyMove(
  db: Db,
  key: string,
  appliedLegs: number[],
  error?: string,
  status: MoneyMoveStatus = error ? "partial" : "applied"
): Promise<void> {
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  // Each leg's durable target stamp is the witness. Completion only marks
  // confirmed legs; rereading and replacing the whole array can overwrite a
  // concurrent recovery stamp and costs a round trip for every fresh move.
  const appliedFields = Object.fromEntries(
    appliedLegs.map((index) => [`legs.${index}.applied`, true])
  );
  await records.updateOne(
    { _id: key, status: "partial" },
    {
      $set: {
        status,
        completedAt: new Date(),
        ...(error ? { error } : {}),
        ...appliedFields,
      },
    }
  );
}

/**
 * Claim the key, then move the money.
 *
 * Returns `replayed` without touching a balance when the key is already known,
 * which is what makes every caller safe to retry.
 */
export async function applyMoneyMove(db: Db, move: MoneyMove): Promise<MoneyMoveResult> {
  const valuationError = moneyMoveValuationError(move.legs);
  const invalid = move.legs.find((leg) => {
    if (!Number.isFinite(leg.amount) || leg.amount < 0) return true;
    if (leg.kind === "asset") return !validEquityCustodyMutation(leg);
    if (leg.kind === "mint" || leg.kind === "burn" || leg.amount === 0) return false;
    return (
      !leg.collection ||
      !leg.path ||
      !leg.filter ||
      [leg.path, ...Object.keys(leg.set ?? {})].some(reservedLegPath)
    );
  });
  if (valuationError) return { status: "rejected", applied: [], error: valuationError };
  if (invalid)
    return {
      status: "rejected",
      applied: [],
      error:
        "Money movement requires finite amounts, target selectors and unreserved balance fields.",
    };
  const prepared = move.legs.map((leg) => ({ ...leg }));
  const unbound = prepared.filter(
    (leg) =>
      (leg.amount > 0 || leg.kind === "asset") &&
      (leg.kind === "debit" || leg.kind === "credit" || leg.kind === "asset") &&
      !(
        typeof leg.filter?._id === "string" ||
        typeof leg.filter?._id === "number" ||
        leg.filter?._id instanceof ObjectId
      )
  );
  let bindingError: string | undefined;
  if (unbound.length) {
    // Preserve selectors such as countryId in the public API, but freeze the
    // selected document before claiming cash. Replays use the original binding
    // even if a previous write changed the caller's selector fields.
    const prior = await db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION).findOne(
      {
        _id: move.key,
      },
      { projection: { _id: 1, legs: 1, quoteIdentity: 1 } }
    );
    if (prior) {
      if (valuedQuoteConflict(prior, prepared, move.quoteIdentity))
        return valuedQuoteConflictResult(move.key);
      if (move.turn !== undefined) countBankingEvent(db, move.turn, "replayedSettlements");
      return { status: "replayed", applied: [] };
    }
    for (const leg of unbound) {
      const target = await db
        .collection(leg.collection!)
        .findOne(leg.filter!, { projection: { _id: 1 } });
      if (!target) {
        bindingError = `Money move ${move.key} (${leg.note}) has no matching target.`;
        break;
      }
      leg.filter = { ...leg.filter, _id: target._id };
    }
  }
  const claim = await claimMoneyMove(db, {
    ...move,
    legs: prepared,
    record: {
      ...move.record,
      genericMoneyMoveVersion: 2,
      ...(bindingError ? { moneyMoveBindingError: bindingError } : {}),
    },
  });
  if (claim.status === "replayed") {
    const existing = await db
      .collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: move.key }, { projection: { legs: 1, quoteIdentity: 1 } });
    if (valuedQuoteConflict(existing, prepared, move.quoteIdentity))
      return valuedQuoteConflictResult(move.key);
    if (move.turn !== undefined) countBankingEvent(db, move.turn, "replayedSettlements");
    return { status: "replayed", applied: [] };
  }
  if (claim.status === "rejected") {
    const existing = await db
      .collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: move.key }, { projection: { legs: 1, quoteIdentity: 1 } });
    if (valuedQuoteConflict(existing, prepared, move.quoteIdentity))
      return valuedQuoteConflictResult(move.key);
    if (move.turn !== undefined) countBankingEvent(db, move.turn, "rejectedSettlements");
    return { status: "rejected", applied: [], error: claim.error };
  }
  if (bindingError) {
    await completeMoneyMove(db, move.key, [], bindingError, "rejected");
    return { status: "rejected", applied: [], error: bindingError };
  }
  if (claim.legs.length === 0) return { status: "applied", applied: [] };
  return executeMoneyMove(db, move.key, false);
}

/**
 * Documents a settlement touches carry the keys of the writes that landed on
 * them, so a write can be recognised as already applied from the document
 * itself. That is what closes the window between a leg landing and its stamp
 * on the record: a crash there leaves the record saying "not applied" while
 * the document says "applied", and the document wins.
 */
export const SETTLED_KEYS_FIELD = "settledKeys";
export const SETTLED_KEYS_CAP = 200;

/** The stamp one leg leaves on the document it moves money in. */
export function legStamp(key: string, index: number): string {
  return `${key}#leg${index}`;
}

/** Debits, equity custody, then credits, each group in the caller's order. */
function legOrder(legs: { kind: MoneyMoveLegKind }[]): number[] {
  return [...legs.keys()].sort((a, b) => {
    const rank = (k: number) => (legs[k].kind === "debit" ? 0 : legs[k].kind === "asset" ? 1 : 2);
    return rank(a) - rank(b) || a - b;
  });
}

/** Target evidence cannot expire until the original journal acknowledges it. */
const PENDING_LEG = "pendingMoneyMoveReceipt";
const LEG_REVISION = "moneyMoveRevision";
function reservedLegPath(path: string): boolean {
  return [PENDING_LEG, LEG_REVISION, SETTLED_KEYS_FIELD, "_id"].some(
    (reserved) => path === reserved || path.startsWith(`${reserved}.`)
  );
}
interface LegReceipt {
  key: string;
  index: number;
  generation: number;
  outcome: "applied" | "rejected";
  error?: string;
}
interface LegTarget {
  _id: unknown;
  settledKeys?: string[];
  pendingMoneyMoveReceipt?: LegReceipt;
  moneyMoveRevision?: number;
}

/** Acknowledge one immutable target outcome, then release only its own receipt. */
async function acknowledgeLeg(
  db: Db,
  collection: string,
  id: unknown,
  receipt: LegReceipt
): Promise<void> {
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  const path = `legs.${receipt.index}`;
  const field = receipt.outcome === "applied" ? `${path}.applied` : `${path}.refusal`;
  const acknowledged = await records.updateOne(
    {
      _id: receipt.key,
      status: "partial",
      [`${path}.collection`]: collection,
      [`${path}.filter._id`]: id,
      [`${path}.applied`]: false,
      [`${path}.refusal`]: { $exists: false },
    },
    { $set: { [field]: receipt.outcome === "applied" ? true : receipt.error } }
  );
  if (!acknowledged.matchedCount) {
    const saved = await records.findOne({ _id: receipt.key }, { projection: { legs: 1 } });
    const leg = saved?.legs[receipt.index];
    if (
      !leg ||
      leg.collection !== collection ||
      !isDeepStrictEqual(leg.filter?._id, id) ||
      (receipt.outcome === "applied" ? !leg.applied : leg.refusal !== receipt.error)
    )
      throw new Error("Money movement target outcome requires journal reconciliation");
  }
  await db
    .collection<LegTarget>(collection)
    .updateOne({ _id: id, [PENDING_LEG]: receipt } as Filter<LegTarget>, {
      $unset: { [PENDING_LEG]: "" },
    });
}

/**
 * Read the target generation BEFORE reading the journal. If another worker
 * acknowledges and releases delivery after that read, its generation change
 * defeats our cash CAS. If it finished before that read, the fresh journal
 * already records the outcome. A bounded history is never the sole witness.
 */
async function applyLeg(
  db: Db,
  key: string,
  i: number,
  leg: MoneyMoveRecordLeg
): Promise<string | null> {
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  const path = `legs.${i}`;
  if (leg.kind === "mint" || leg.kind === "burn") {
    await records.updateOne(
      { _id: key, status: "partial" },
      { $set: { [`${path}.applied`]: true } }
    );
    return null;
  }
  if (!leg.collection || (leg.kind !== "asset" && !leg.path) || leg.filter?._id === undefined)
    return `Leg ${i} of ${key} requires a stable target id; reconcile by hand.`;
  if (leg.kind === "asset" && !validEquityCustodyMutation(leg))
    return `Leg ${i} of ${key} is not a valid equity custody update.`;
  if ([...(leg.path ? [leg.path] : []), ...Object.keys(leg.set ?? {})].some(reservedLegPath))
    return `Leg ${i} of ${key} attempts to change reserved settlement metadata.`;

  const target = db.collection<LegTarget>(leg.collection);
  const id = { _id: leg.filter._id } as Filter<LegTarget>;
  const stamp = legStamp(key, i);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await target.findOne(id, {
      projection: { [PENDING_LEG]: 1, [LEG_REVISION]: 1, settledKeys: 1 },
    });
    const record = await records.findOne(
      { _id: key },
      {
        projection: {
          status: 1,
          genericMoneyMoveVersion: 1,
          retryCreditLegOnGuardFailure: 1,
          legs: 1,
        },
      }
    );
    const saved = record?.legs[i];
    if (!saved) return `Leg ${i} of ${key} is missing from its journal.`;
    const receipt = current?.pendingMoneyMoveReceipt;
    if (receipt) {
      // A completed cash leg may belong to a command outside this queue page.
      // Help acknowledge that exact leg, so older waiters cannot starve it.
      await acknowledgeLeg(db, leg.collection, leg.filter._id, receipt);
      if (receipt.key === key && receipt.index === i)
        return receipt.outcome === "applied" ? null : receipt.error!;
      continue;
    }
    if (saved.applied) return null;
    if (saved.refusal) {
      if (
        leg.kind !== "credit" ||
        record.retryCreditLegOnGuardFailure !== true ||
        record.status !== "partial"
      )
        return saved.refusal;
      await records.updateOne(
        {
          _id: key,
          status: "partial",
          [`${path}.applied`]: false,
          [`${path}.refusal`]: saved.refusal,
        },
        { $unset: { [`${path}.refusal`]: "" } }
      );
      continue;
    }
    if (record?.status !== "partial") return `Money move ${key} is already ${record?.status}.`;
    if (!current) return `Leg ${i} of ${key} has no target; reconciliation is required.`;
    if (record.genericMoneyMoveVersion !== 2) {
      if (current.settledKeys?.includes(stamp)) {
        await records.updateOne(
          { _id: key, status: "partial" },
          { $set: { [`${path}.applied`]: true } }
        );
        return null;
      }
      return `Legacy leg ${i} of ${key} has no surviving delivery proof; reconcile by hand.`;
    }
    const revision = current.moneyMoveRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
      return `Leg ${i} of ${key} has an invalid target generation.`;
    const guard = {
      ...id,
      [LEG_REVISION]: current.moneyMoveRevision ?? { $exists: false },
      [PENDING_LEG]: { $exists: false },
    };
    const amount = Math.max(0, leg.amount);
    const delivered: LegReceipt = { key, index: i, generation: revision + 1, outcome: "applied" };
    const write = await target.updateOne(
      {
        $and: [
          leg.filter,
          guard,
          ...(leg.kind === "debit" ? [{ [leg.path!]: { $gte: amount } }] : []),
        ],
      } as Filter<LegTarget>,
      {
        $inc: {
          ...(leg.kind === "asset" ? {} : { [leg.path!]: leg.kind === "debit" ? -amount : amount }),
          [LEG_REVISION]: 1,
        },
        $set: { updatedAt: new Date(), ...leg.set, [PENDING_LEG]: delivered },
        $push: { settledKeys: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
      }
    );
    if (write.matchedCount) {
      await acknowledgeLeg(db, leg.collection, leg.filter._id, delivered);
      return null;
    }
    // Refusal competes on the same unconsumed generation as delivery. A late
    // worker cannot reject cash that another worker has already delivered.
    const refused: LegReceipt = {
      key,
      index: i,
      generation: revision + 1,
      outcome: "rejected",
      error: `Leg ${i} of ${key} (${leg.note}) did not apply: the balance moved or the guard failed.`,
    };
    const stopped = await target.updateOne(guard, {
      $inc: { [LEG_REVISION]: 1 },
      $set: { [PENDING_LEG]: refused },
    });
    if (stopped.matchedCount) {
      await acknowledgeLeg(db, leg.collection, leg.filter._id, refused);
      return refused.error!;
    }
  }
  return `Leg ${i} of ${key} changed during delivery; retry this command.`;
}

/** Below this many eligible credit legs a move keeps the per-leg path. */
export const BATCHED_CREDIT_MIN_LEGS = 4;

/**
 * Deliver a move's credit legs in a fixed number of round trips instead of
 * five per leg. Every write is the one {@link applyLeg} would make: the same
 * revision CAS, the same pending receipt and settled-key stamp, acknowledged
 * the same way. Only the round trips are shared. Targets are read before the
 * journal, as in applyLeg. A leg this pass cannot confirm (guard miss,
 * contended or repeated target, pending receipt) is left untouched for the
 * per-leg path, which finishes it from the receipts exactly as it would after
 * a crash. Returns the indices it delivered.
 */
async function deliverCreditLegsInBatch(
  db: Db,
  key: string,
  indices: number[],
  legs: MoneyMoveRecordLeg[]
): Promise<Set<number>> {
  const delivered = new Set<number>();
  // A fan-out pays one kind of holder. Batch the collection with the most
  // eligible payees; legs elsewhere, and any repeated target, stay per-leg.
  const byCollection = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const i of indices) {
    const leg = legs[i];
    if (leg.kind !== "credit" || !leg.collection || !leg.path || leg.filter?._id === undefined)
      continue;
    if ([leg.path, ...Object.keys(leg.set ?? {})].some(reservedLegPath)) continue;
    const targetKey = `${leg.collection}\u0000${String(leg.filter._id)}`;
    if (seen.has(targetKey)) continue;
    seen.add(targetKey);
    byCollection.set(leg.collection, [...(byCollection.get(leg.collection) ?? []), i]);
  }
  const [collection, group] = [...byCollection.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0] ?? ["", []];
  if (group.length < BATCHED_CREDIT_MIN_LEGS) return delivered;

  const targets = db.collection<LegTarget>(collection);
  const ids = group.map((i) => legs[i].filter!._id);
  const rows = await targets
    .find({ _id: { $in: ids } } as unknown as Filter<LegTarget>, {
      projection: { [PENDING_LEG]: 1, [LEG_REVISION]: 1 },
    })
    .toArray();
  const current = new Map<number, LegTarget>();
  for (const i of group) {
    const row = rows.find((r) => isDeepStrictEqual(r._id, legs[i].filter!._id));
    if (row) current.set(i, row);
  }
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  const record = await records.findOne(
    { _id: key },
    { projection: { status: 1, genericMoneyMoveVersion: 1, legs: 1 } }
  );
  if (record?.status !== "partial" || record.genericMoneyMoveVersion !== 2) return delivered;

  const receipts = new Map<number, LegReceipt>();
  const writes = [];
  for (const i of group) {
    const saved = record.legs[i];
    const target = current.get(i);
    if (!saved || saved.applied || saved.refusal || !target || target.pendingMoneyMoveReceipt)
      continue;
    const revision = target.moneyMoveRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
      continue;
    const leg = legs[i];
    const receipt: LegReceipt = { key, index: i, generation: revision + 1, outcome: "applied" };
    receipts.set(i, receipt);
    writes.push({
      updateOne: {
        filter: {
          $and: [
            leg.filter,
            {
              _id: leg.filter!._id,
              [LEG_REVISION]: target.moneyMoveRevision ?? { $exists: false },
              [PENDING_LEG]: { $exists: false },
            },
          ],
        } as Filter<LegTarget>,
        update: {
          $inc: { [leg.path!]: Math.max(0, leg.amount), [LEG_REVISION]: 1 },
          $set: { updatedAt: new Date(), ...leg.set, [PENDING_LEG]: receipt },
          $push: { settledKeys: { $each: [legStamp(key, i)], $slice: -SETTLED_KEYS_CAP } },
        },
      },
    });
  }
  if (!writes.length) return delivered;
  await targets.bulkWrite(writes, { ordered: false });

  // Which writes landed: the target now carries exactly our receipt.
  const landed = await targets
    .find(
      {
        _id: { $in: [...receipts.keys()].map((i) => legs[i].filter!._id) },
        [`${PENDING_LEG}.key`]: key,
      } as unknown as Filter<LegTarget>,
      { projection: { [PENDING_LEG]: 1 } }
    )
    .toArray();
  for (const row of landed) {
    const receipt = row.pendingMoneyMoveReceipt;
    if (receipt && receipts.get(receipt.index)?.generation === receipt.generation)
      delivered.add(receipt.index);
  }
  if (!delivered.size) return delivered;

  // Acknowledge in the journal with one write. If anything moved underneath
  // (another worker acknowledged a leg first), fall back to the per-leg
  // acknowledgement, which verifies each outcome before releasing it.
  const filter: Record<string, unknown> = { _id: key, status: "partial" };
  const set: Record<string, boolean> = {};
  for (const i of delivered) {
    filter[`legs.${i}.collection`] = collection;
    filter[`legs.${i}.filter._id`] = legs[i].filter!._id;
    filter[`legs.${i}.applied`] = false;
    filter[`legs.${i}.refusal`] = { $exists: false };
    set[`legs.${i}.applied`] = true;
  }
  const acknowledged = await records.updateOne(filter as Filter<MoneyMoveRecord>, { $set: set });
  if (!acknowledged.matchedCount) {
    for (const i of delivered)
      await acknowledgeLeg(db, collection, legs[i].filter!._id, receipts.get(i)!);
    return delivered;
  }
  await targets.bulkWrite(
    [...delivered].map((i) => ({
      updateOne: {
        filter: { _id: legs[i].filter!._id, [PENDING_LEG]: receipts.get(i) } as Filter<LegTarget>,
        update: { $unset: { [PENDING_LEG]: "" } },
      },
    })),
    { ordered: false }
  );
  return delivered;
}

/** Finish from the original journal, without reinterpreting terminal outcomes. */
export async function resumeMoneyMove(db: Db, key: string): Promise<MoneyMoveResult> {
  return executeMoneyMove(db, key, true);
}

async function executeMoneyMove(db: Db, key: string, resuming: boolean): Promise<MoneyMoveResult> {
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  const record = await records.findOne({ _id: key });
  if (!record) return { status: "rejected", applied: [], error: `no money move ${key}` };
  if (
    record.atomicDocument ||
    record.legacyInterestBatch ||
    record.locSettlement ||
    record.treasuryReserveTransfer
  )
    return {
      status: "rejected",
      applied: [],
      error: "Atomic document settlement requires journal recovery",
    };
  // An operator may have reconciled an older record whose individual leg
  // acknowledgements are incomplete. Its terminal disposition is authoritative.
  if (record.status === "applied")
    return {
      status: "applied",
      applied: record.legs.flatMap((leg, i) => (leg.applied ? [i] : [])),
    };
  if (record.moneyMoveBindingError) {
    await completeMoneyMove(db, key, [], record.moneyMoveBindingError, "rejected");
    return { status: "rejected", applied: [], error: record.moneyMoveBindingError };
  }
  let failure: string | undefined;
  const order = legOrder(record.legs);
  // Credits sort last. Once every debit and asset leg before them has landed,
  // the credits of a wide fan-out are delivered together; the loop below then
  // skips those and handles any the batch left behind one at a time.
  let batched = new Set<number>();
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const leg = record.legs[i];
    if (record.genericMoneyMoveVersion !== 2 && leg.applied) continue;
    if (record.status === "rejected" && !leg.applied && !leg.refusal) continue;
    if (
      leg.kind === "credit" &&
      batched.size === 0 &&
      record.status === "partial" &&
      record.genericMoneyMoveVersion === 2
    ) {
      const rest = order.slice(n).filter((k) => !record.legs[k].applied && !record.legs[k].refusal);
      batched = await deliverCreditLegsInBatch(db, key, rest, record.legs);
      if (!batched.size) batched = new Set([-1]);
    }
    if (batched.has(i)) continue;
    const failed = await applyLeg(db, key, i, leg);
    if (failed) {
      failure = failed;
      break;
    }
  }
  const latest = await records.findOne({ _id: key });
  if (!latest) throw new Error(`Money move ${key} disappeared during recovery`);
  const applied = latest.legs.flatMap((leg, i) => (leg.applied ? [i] : []));
  const refusal = latest.legs.find((leg) => leg.refusal)?.refusal;
  const status =
    latest.status === "rejected"
      ? "rejected"
      : applied.length === latest.legs.length
        ? "applied"
        : refusal && applied.length === 0
          ? "rejected"
          : "partial";
  const pendingProjections = latest.projections?.some((p) => !p.applied && !p.appliedAt);
  await completeMoneyMove(
    db,
    key,
    applied,
    status === "applied" ? undefined : (refusal ?? failure),
    status === "applied" && pendingProjections ? "partial" : status
  );
  if (record.turn !== undefined && (resuming || status !== "applied"))
    countBankingEvent(
      db,
      record.turn,
      status === "applied"
        ? "resumedSettlements"
        : status === "rejected"
          ? "rejectedSettlements"
          : "partialSettlements"
    );
  return {
    status,
    applied,
    error: status === "applied" ? undefined : (refusal ?? failure ?? latest.error),
  };
}

export interface MoneyMoveRepairRow {
  key: string;
  kind: string;
  turn?: number;
  /** Legs that landed, in a move that did not finish. */
  appliedLegs: { amount: number; note: string; kind: MoneyMoveLegKind }[];
  /** Legs that did not land. These are the hole. */
  outstandingLegs: { amount: number; note: string; kind: MoneyMoveLegKind }[];
  error?: string;
}

/**
 * Everything that started and did not finish.
 *
 * A repair path is not optional on a database with no transactions: without one
 * a half-applied move is invisible, and invisible holes are what put the whole
 * subsystem behind a kill switch. Read-only on purpose. Finishing a move needs
 * a human to look at which legs landed, and the record says exactly that.
 */
export async function listUnfinishedMoneyMoves(
  db: Db,
  options: { kind?: string; limit?: number } = {}
): Promise<MoneyMoveRepairRow[]> {
  const rows = await db
    .collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION)
    .find({ status: "partial", ...(options.kind ? { kind: options.kind } : {}) })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, options.limit ?? 100))
    .toArray();

  return rows.map((row) => ({
    key: row._id,
    kind: row.kind,
    turn: row.turn,
    appliedLegs: row.legs
      .filter((l) => l.applied)
      .map(({ amount, note, kind }) => ({ amount, note, kind })),
    outstandingLegs: row.legs
      .filter((l) => !l.applied)
      .map(({ amount, note, kind }) => ({ amount, note, kind })),
    error: row.error,
  }));
}

/**
 * Mark a repaired move done. The only write an operator tool needs.
 *
 * Does not move money: whoever repaired it moved the money. This closes the
 * record so the queue means what it says.
 */
export async function closeMoneyMove(db: Db, key: string, note: string): Promise<boolean> {
  const res = await db
    .collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION)
    .updateOne(
      { _id: key, status: "partial" },
      { $set: { status: "applied", completedAt: new Date(), error: `repaired: ${note}` } }
    );
  return res.matchedCount === 1;
}

/** Deterministic key for a per-turn, per-bank flow. */
export function turnMoveKey(kind: string, bankId: string, turn: number): string {
  return `${kind}:${bankId}:${turn}`;
}
