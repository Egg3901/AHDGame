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

import type { Db, Filter, UpdateFilter, Document } from "mongodb";
import { NET_TOLERANCE, legsNet, type ValueLegKind } from "@/lib/banking/rules/invariants";

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
  legs: MoneyMoveLeg[];
}

export type MoneyMoveStatus = "applied" | "partial" | "replayed" | "rejected";

export interface MoneyMoveResult {
  status: MoneyMoveStatus;
  /** Legs that were written. Index into `move.legs`. */
  applied: number[];
  /** Populated when a guarded debit did not apply, or the legs did not net. */
  error?: string;
}

interface MoneyMoveRecord {
  _id: string;
  kind: string;
  turn?: number;
  status: MoneyMoveStatus;
  legs: { kind: MoneyMoveLegKind; amount: number; note: string; applied: boolean }[];
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
  const legs = move.legs.filter((leg) => Math.max(0, leg.amount) > 0);
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
    _id: move.key,
    kind: move.kind,
    turn: move.turn,
    status: "partial",
    legs: legs.map((leg) => ({
      kind: leg.kind,
      amount: Math.max(0, leg.amount),
      note: leg.note,
      applied: false,
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
  error?: string
): Promise<void> {
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  const existing = await records.findOne({ _id: key });
  if (!existing) return;
  await records.updateOne(
    { _id: key },
    {
      $set: {
        status: error ? "partial" : "applied",
        completedAt: new Date(),
        ...(error ? { error } : {}),
        legs: existing.legs.map((leg, i) => ({ ...leg, applied: appliedLegs.includes(i) })),
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
  const claim = await claimMoneyMove(db, move);
  if (claim.status === "replayed") return { status: "replayed", applied: [] };
  if (claim.status === "rejected") {
    return { status: "rejected", applied: [], error: claim.error };
  }
  const legs = claim.legs;
  if (legs.length === 0) return { status: "applied", applied: [] };

  const applied: number[] = [];
  let failure: string | undefined;

  // Guarded debits go first: if a debit is going to fail its $gte guard, it
  // must fail before any credit lands, so a partial move can only ever be
  // "money not yet delivered", never "money created". Original leg indices are
  // kept so the repair queue reads the caller's order.
  const order = [...legs.keys()].sort((a, b) => {
    const rank = (k: number) => (legs[k].kind === "debit" ? 0 : 1);
    return rank(a) - rank(b) || a - b;
  });

  for (const i of order) {
    const leg = legs[i];
    const amount = Math.max(0, leg.amount);
    if (leg.kind === "mint" || leg.kind === "burn") {
      applied.push(i);
      continue;
    }
    if (!leg.collection || !leg.path || !leg.filter) {
      failure = `Leg ${i} of ${move.key} (${leg.note}) is missing a target.`;
      break;
    }

    const filter = (
      leg.kind === "debit"
        ? // The guard is the whole point: a debit that would overdraw does not
          // match, so it does not apply, so the balance cannot go negative on a
          // stale read.
          { ...leg.filter, [leg.path]: { $gte: amount } }
        : leg.filter
    ) as Filter<Document>;

    const update = {
      $inc: { [leg.path]: leg.kind === "debit" ? -amount : amount },
      $set: { updatedAt: new Date(), ...(leg.set ?? {}) },
    } as unknown as UpdateFilter<Document>;

    const res = await db.collection(leg.collection).updateOne(filter, update);
    if (res.matchedCount !== 1) {
      failure = `Leg ${i} of ${move.key} (${leg.note}) did not apply: the balance moved or the guard failed.`;
      break;
    }
    applied.push(i);
  }

  const status: MoneyMoveStatus = failure ? "partial" : "applied";
  await completeMoneyMove(db, move.key, applied, failure);

  return { status, applied, error: failure };
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
