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
  note: string;
  applied: boolean;
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
  _id: string;
  kind: string;
  turn?: number;
  status: MoneyMoveStatus;
  legs: MoneyMoveRecordLeg[];
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
    ...(move.record ?? {}),
    _id: move.key,
    kind: move.kind,
    turn: move.turn,
    status: "partial",
    legs: legs.map((leg) => ({
      kind: leg.kind,
      amount: Math.max(0, leg.amount),
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
  if (claim.status === "replayed") {
    if (move.turn !== undefined) countBankingEvent(db, move.turn, "replayedSettlements");
    return { status: "replayed", applied: [] };
  }
  if (claim.status === "rejected") {
    if (move.turn !== undefined) countBankingEvent(db, move.turn, "rejectedSettlements");
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
    const failed = await applyLeg(db, move.key, i, legs[i]);
    if (failed) {
      failure = failed;
      break;
    }
    applied.push(i);
  }

  const status: MoneyMoveStatus = failure ? "partial" : "applied";
  await completeMoneyMove(db, move.key, applied, failure);
  if (failure && move.turn !== undefined) {
    countBankingEvent(db, move.turn, "partialSettlements");
  }

  return { status, applied, error: failure };
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

/** Debits first, then everything else, each group in the caller's order. */
function legOrder(legs: { kind: MoneyMoveLegKind }[]): number[] {
  return [...legs.keys()].sort((a, b) => {
    const rank = (k: number) => (legs[k].kind === "debit" ? 0 : 1);
    return rank(a) - rank(b) || a - b;
  });
}

/**
 * Write one leg and stamp it on the record. Returns the failure text, or null
 * when the leg landed. Shared by the first attempt and by resumption, so the
 * two can never disagree about what a leg does.
 */
async function applyLeg(
  db: Db,
  key: string,
  i: number,
  leg: Pick<MoneyMoveLeg, "kind" | "amount" | "note" | "collection" | "filter" | "path" | "set">
): Promise<string | null> {
  const amount = Math.max(0, leg.amount);
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  if (leg.kind === "mint" || leg.kind === "burn") {
    await records.updateOne({ _id: key }, { $set: { [`legs.${i}.applied`]: true } });
    return null;
  }
  if (!leg.collection || !leg.path || !leg.filter) {
    return `Leg ${i} of ${key} (${leg.note}) is missing a target.`;
  }

  const stamp = legStamp(key, i);
  const filter = {
    ...leg.filter,
    // The guard is the whole point: a debit that would overdraw does not
    // match, so it does not apply, so the balance cannot go negative on a
    // stale read.
    ...(leg.kind === "debit" ? { [leg.path]: { $gte: amount } } : {}),
    // And a leg that already landed on this document does not match either,
    // so a resumed or racing write of the same leg moves nothing twice.
    [SETTLED_KEYS_FIELD]: { $ne: stamp },
  } as Filter<Document>;

  const update = {
    $inc: { [leg.path]: leg.kind === "debit" ? -amount : amount },
    $set: { updatedAt: new Date(), ...(leg.set ?? {}) },
    $push: { [SETTLED_KEYS_FIELD]: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
  } as unknown as UpdateFilter<Document>;

  const res = await db.collection(leg.collection).updateOne(filter, update);
  if (res.matchedCount !== 1) {
    const landed = await db
      .collection(leg.collection)
      .findOne({ ...leg.filter, [SETTLED_KEYS_FIELD]: stamp } as Filter<Document>, {
        projection: { _id: 1 },
      });
    if (!landed) {
      return `Leg ${i} of ${key} (${leg.note}) did not apply: the balance moved or the guard failed.`;
    }
    // Landed on an earlier attempt that crashed before stamping the record.
  }
  // Stamp the leg the moment it lands. Recording applied legs only at
  // completion meant a crash between two legs left a record saying nothing
  // had moved when the debit already had, and the repair queue is only worth
  // having if it says exactly which half landed.
  await records.updateOne({ _id: key }, { $set: { [`legs.${i}.applied`]: true } });
  return null;
}

/**
 * Finish a move that crashed between two legs, from the record alone.
 *
 * The legs that landed are stamped on the record and are not touched again;
 * the legs that did not are written exactly as the first attempt would have
 * written them, guards included, so a resumed debit that would now overdraw
 * still refuses and the record stays `partial` for an operator. Only the
 * recovery worker calls this, and only for a record nobody else is running:
 * a live settlement that finds the key owned reports a replay and stops.
 */
export async function resumeMoneyMove(db: Db, key: string): Promise<MoneyMoveResult> {
  const records = db.collection<MoneyMoveRecord>(MONEY_MOVE_COLLECTION);
  const record = await records.findOne({ _id: key });
  if (!record) return { status: "rejected", applied: [], error: `no money move ${key}` };
  const legs = record.legs ?? [];
  const already = legs.flatMap((leg, i) => (leg.applied ? [i] : []));
  if (legs.every((leg) => leg.applied)) {
    if (record.status !== "applied") await completeMoneyMove(db, key, already);
    return { status: "applied", applied: already };
  }
  if (
    legs.some(
      (leg) => !leg.applied && leg.kind !== "mint" && leg.kind !== "burn" && !leg.collection
    )
  ) {
    return {
      status: "partial",
      applied: already,
      error: `move ${key} predates recorded leg targets; repair by hand`,
    };
  }

  const applied = [...already];
  let failure: string | undefined;
  for (const i of legOrder(legs)) {
    if (legs[i].applied) continue;
    const failed = await applyLeg(db, key, i, legs[i]);
    if (failed) {
      failure = failed;
      break;
    }
    applied.push(i);
  }
  applied.sort((a, b) => a - b);
  await completeMoneyMove(db, key, applied, failure);
  if (record.turn !== undefined) {
    countBankingEvent(db, record.turn, failure ? "partialSettlements" : "resumedSettlements");
  }
  return { status: failure ? "partial" : "applied", applied, error: failure };
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
