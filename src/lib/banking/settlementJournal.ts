/**
 * The Settlement Journal: apply a banking transition exactly once.
 *
 * The money-movement primitive already gives at-most-once legs under a
 * claimed key. What it did not give was the rest of a transition: the loan
 * record, the counter, the status flip that belong with the money and used
 * to be written by hand after it, in whatever order the author chose, with
 * a compensating write for the crash case that never actually ran. The
 * journal takes the whole transition the rules produced, claims the key,
 * lands the legs, then applies the projections, and records which of each
 * landed so a recovery pass can finish what a crash interrupted.
 *
 * Order, and why:
 *
 * 1. The key is claimed before anything moves (the primitive's rule).
 * 2. Legs land, guarded debits first. A failed guard leaves a `partial`
 *    record with no projection applied, so the world has "money not yet
 *    delivered", never "loan booked with no cash behind it".
 * 3. Projections apply in order. Each is recorded on the journal as it
 *    lands, so a crash between two projections is visible as exactly which
 *    one is missing, and idempotent to re-run.
 * 4. The result is returned with the audit event the caller should publish.
 *    Publishing is the caller's job because the caller knows the actor.
 */

import { ObjectId, type Db, type Document, type Filter, type UpdateFilter } from "mongodb";
import { MONEY_MOVE_COLLECTION, applyMoneyMove, type MoneyMoveLeg } from "@/lib/banking/moneyMove";
import type {
  BankingTransition,
  TransitionLeg,
  TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { checkBalancedTransfer } from "@/lib/banking/rules/invariants";
import { countBankingEvent } from "@/lib/banking/telemetry";

export type SettlementStatus = "applied" | "replayed" | "rejected" | "partial";

export interface SettlementResult {
  status: SettlementStatus;
  key: string;
  /** Indexes into `transition.legs` that landed. */
  appliedLegs: number[];
  /** Indexes into `transition.projections` that have landed, ever. */
  appliedProjections: number[];
  /**
   * Indexes into `transition.projections` that landed IN THIS CALL. A turn
   * pass that keeps in-memory aggregates adjusts them for these and only
   * these: a projection that landed on an earlier attempt is already in the
   * document the pass read at its start.
   */
  newlyAppliedProjections: number[];
  error?: string;
}

interface JournalProjectionRecord {
  collection: string;
  note: string;
  /**
   * Set atomically BEFORE the projection is applied, by whichever settler
   * wins the claim. Two concurrent replays therefore cannot both increment
   * a counter: one claims, the other sees the claim and skips.
   */
  claimedAt?: Date | null;
  /** Set after the projection landed. */
  appliedAt?: Date | null;
  /** Kept for readers of the first journal shape. Mirrors `appliedAt`. */
  applied: boolean;
  /** The projection itself, so recovery can re-apply it without the rules. */
  projection: TransitionProjection;
}

/**
 * Every projection can be retried blind: an insert is idempotent by id, and
 * an update carries its stamp (see `projectionStamp`), so a re-run of a
 * write that already landed matches nothing and reads as applied.
 */
function safeToRetryBlind(_projection: TransitionProjection): boolean {
  return true;
}

/**
 * The journal record extends the primitive's claim document in place: same
 * collection, same `_id`, extra fields. One queue for operators, one index.
 */
interface JournalExtension {
  status?: string;
  legs?: { applied: boolean }[];
  transitionKind?: string;
  currency?: string;
  projections?: JournalProjectionRecord[];
  projectionsCompletedAt?: Date;
}

/**
 * Update projections stamp the document they touch with `settledKeys`, so a
 * re-run of the same projection matches nothing and is read as already
 * applied. That is what makes a claimed-but-unfinished update safe to retry:
 * the stamp, not the journal, is the witness that the write landed. Capped so
 * a long-lived document does not carry every key it ever saw.
 */
const SETTLED_KEYS_FIELD = "settledKeys";
const SETTLED_KEYS_CAP = 200;

export function projectionStamp(key: string, index: number): string {
  return `${key}#${index}`;
}

/** `{ $oid: hex }` markers become driver ObjectIds; everything else is copied. */
export function reviveObjectIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => reviveObjectIds(v)) as unknown as T;
  if (value && typeof value === "object") {
    if (value instanceof ObjectId || value instanceof Date) return value;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$oid" && typeof record.$oid === "string") {
      return new ObjectId(record.$oid) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) out[key] = reviveObjectIds(inner);
    return out as T;
  }
  return value;
}

function toMoneyLeg(leg: TransitionLeg): MoneyMoveLeg {
  return {
    kind: leg.kind,
    amount: leg.amount,
    ...(leg.collection ? { collection: leg.collection } : {}),
    ...(leg.filter ? { filter: reviveObjectIds(leg.filter) } : {}),
    ...(leg.path ? { path: leg.path } : {}),
    ...(leg.set ? { set: reviveObjectIds(leg.set) } : {}),
    note: leg.note,
  };
}

/**
 * Apply one projection. Inserts are idempotent by `_id`: a duplicate-key
 * error means a previous attempt already landed it. Updates are applied as
 * given; the rules make them idempotent where it matters (status flips are
 * guarded on the prior status, counters carry the key in the journal).
 */
export async function applyProjection(
  db: Db,
  projection: TransitionProjection,
  stamp?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const collection = db.collection(projection.collection);
  if (projection.insert) {
    try {
      await collection.insertOne(reviveObjectIds(projection.insert) as Document);
      return { ok: true };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 11000) return { ok: true };
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (projection.filter && projection.update) {
    const filter = reviveObjectIds(projection.filter) as Record<string, unknown>;
    const update = reviveObjectIds(projection.update) as Record<string, unknown>;
    const stampedFilter = stamp ? { ...filter, [SETTLED_KEYS_FIELD]: { $ne: stamp } } : filter;
    const stampedUpdate = stamp
      ? {
          ...update,
          $push: {
            ...((update.$push as Record<string, unknown> | undefined) ?? {}),
            [SETTLED_KEYS_FIELD]: { $each: [stamp], $slice: -SETTLED_KEYS_CAP },
          },
        }
      : update;
    const res = await collection.updateOne(
      stampedFilter as Filter<Document>,
      stampedUpdate as UpdateFilter<Document>
    );
    if (res.matchedCount === 1) return { ok: true };
    if (stamp) {
      // No match with the stamp excluded. Either the document carries the
      // stamp already (the write landed on an earlier attempt) or it is
      // genuinely not there. Distinguish, so a replay is a no-op and a bad
      // target is still an error.
      const already = await collection.findOne(
        { ...filter, [SETTLED_KEYS_FIELD]: stamp } as Filter<Document>,
        { projection: { _id: 1 } }
      );
      if (already) return { ok: true };
    }
    return { ok: false, error: `projection "${projection.note}" matched no document` };
  }
  return { ok: false, error: `projection "${projection.note}" has neither insert nor update` };
}

/**
 * Settle a transition. Safe to call again with the same transition: a replay
 * finishes any projections the first attempt did not reach and moves no money.
 */
export async function settleTransition(
  db: Db,
  transition: BankingTransition
): Promise<SettlementResult> {
  const journal = db.collection<{ _id: string } & JournalExtension>(MONEY_MOVE_COLLECTION);
  const result: SettlementResult = {
    status: "applied",
    key: transition.key,
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
  };

  // Refuse before claiming: an unbalanced or malformed transition must never
  // own a key, or the retry of a corrected one would replay the broken one.
  const violations = checkBalancedTransfer(transition.legs, transition.key);
  if (violations.length > 0) {
    if (Number.isFinite(transition.turn)) {
      countBankingEvent(db, transition.turn, "rejectedSettlements");
    }
    return { ...result, status: "rejected", error: violations[0].detail };
  }
  for (const leg of transition.legs) {
    if (
      (leg.kind === "debit" || leg.kind === "credit") &&
      (!leg.collection || !leg.path || !leg.filter)
    ) {
      return { ...result, status: "rejected", error: `leg "${leg.note}" is missing a target` };
    }
  }

  const records: JournalProjectionRecord[] = transition.projections.map((projection) => ({
    collection: projection.collection,
    note: projection.note,
    claimedAt: null,
    appliedAt: null,
    applied: false,
    projection,
  }));
  const extension: JournalExtension = {
    transitionKind: transition.kind,
    currency: transition.currency,
    projections: records,
  };

  const move = await applyMoneyMove(db, {
    key: transition.key,
    kind: transition.kind,
    turn: transition.turn,
    legs: transition.legs.map(toMoneyLeg),
    record: extension as Record<string, unknown>,
  });

  if (move.status === "rejected") {
    return { ...result, status: "rejected", error: move.error };
  }
  if (move.status === "partial") {
    // Nothing else is written: a half-delivered move with a booked loan on
    // top would be the "money created between two correct writes" hole.
    return { ...result, status: "partial", appliedLegs: move.applied, error: move.error };
  }

  if (move.status === "replayed" && transition.legs.length > 0) {
    // The key is owned by another attempt. Only once that attempt has landed
    // every leg may this one go on to the projections. Otherwise the other
    // attempt is either still running or crashed mid-way: either way nothing
    // further may be written on top of undelivered money. The result is still
    // `replayed` (this caller owns nothing), with `error` saying the key is
    // not settled; the claim record itself is what the repair queue lists.
    const owned = await journal.findOne({ _id: transition.key });
    // Judged on the legs themselves, not the record's status: a record can be
    // `partial` because a PROJECTION failed after every leg landed, and that
    // is exactly the case a replay must go on to finish.
    const ownedLegs = owned?.legs ?? [];
    const legsOutstanding = !owned || ownedLegs.some((leg) => !leg.applied);
    if (legsOutstanding) {
      return {
        ...result,
        status: "replayed",
        appliedLegs: (owned?.legs ?? []).flatMap((leg, i) => (leg.applied ? [i] : [])),
        error: "another attempt owns this key and has not landed every leg",
      };
    }
  }

  result.appliedLegs = move.status === "applied" ? move.applied : [];

  // A transition with no legs (a pending loan request) still needs a claim,
  // which `applyMoneyMove` grants for an empty leg list without a record.
  // Write one so the projections have somewhere to be recorded.
  if (transition.legs.length === 0 && move.status === "applied") {
    try {
      await journal.insertOne({
        ...extension,
        _id: transition.key,
        kind: transition.kind,
        turn: transition.turn,
        status: "applied",
        legs: [],
        createdAt: new Date(),
        completedAt: new Date(),
      } as never);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 11000) {
        // Someone already owns this key: it is a replay.
        return finishProjections(db, transition, { ...result, status: "replayed" });
      }
      throw error;
    }
  }

  return finishProjections(db, transition, {
    ...result,
    status: move.status === "replayed" ? "replayed" : "applied",
  });
}

/**
 * Apply every projection not yet landed, claiming each atomically first.
 *
 * Replays skip projections already applied. A projection claimed by a
 * previous attempt that never finished is retried only when that is safe
 * (an insert); otherwise the record stays `partial` for the recovery worker,
 * which reports it rather than guessing.
 */
interface FinishOptions {
  /**
   * An operator has confirmed that a claimed-but-unfinished update did NOT
   * land, so it may be applied again. Never set by a live settlement.
   */
  force?: boolean;
}

async function finishProjections(
  db: Db,
  transition: BankingTransition,
  result: SettlementResult,
  options: FinishOptions = {}
): Promise<SettlementResult> {
  const journal = db.collection<{ _id: string } & JournalExtension>(MONEY_MOVE_COLLECTION);

  // The record is the authority on what remains to do. A caller replaying
  // after a crash may have recomputed its transition from state the first
  // attempt already changed (a resolution retried after the cash moved sees a
  // different shortfall); the projections that were claimed with the key are
  // the ones that finish, never the recomputed ones. Records without a
  // projection list (written by the primitive alone) fall back to the caller.
  const existing = await journal.findOne({ _id: transition.key });
  let records: JournalProjectionRecord[] = existing?.projections ?? [];
  if (records.length === 0) {
    records = transition.projections.map((projection) => ({
      collection: projection.collection,
      note: projection.note,
      claimedAt: null,
      appliedAt: null,
      applied: false,
      projection,
    }));
    await journal.updateOne(
      { _id: transition.key },
      {
        $set: {
          transitionKind: transition.kind,
          currency: transition.currency,
          projections: records,
        },
      }
    );
  }

  if (records.length === 0) return result;

  let stuck: string | undefined;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record?.appliedAt || record?.applied) {
      result.appliedProjections.push(i);
      continue;
    }
    const projection = record.projection;
    if (record?.claimedAt && !safeToRetryBlind(projection) && !options.force) {
      stuck = `projection "${projection.note}" was claimed by an earlier attempt and cannot be retried blind`;
      continue;
    }

    // Claim first. On a fresh record the claim is a plain set; on a retry of
    // a claimed insert it is a no-op that still matches.
    const claim = await journal.updateOne(
      record?.claimedAt
        ? { _id: transition.key }
        : { _id: transition.key, [`projections.${i}.claimedAt`]: null },
      { $set: { [`projections.${i}.claimedAt`]: new Date() } }
    );
    if (claim.matchedCount !== 1) {
      // Somebody else claimed it between our read and our write. They will
      // apply it (or leave it for recovery); this attempt must not.
      continue;
    }

    const outcome = await applyProjection(db, projection, projectionStamp(transition.key, i));
    if (!outcome.ok) {
      // A refused write is a KNOWN non-application, so the claim is released:
      // recovery may retry it once the cause is fixed. Only a crash between
      // claim and write leaves an ambiguous claim behind.
      result.status = "partial";
      result.error = outcome.error;
      if (Number.isFinite(transition.turn)) {
        countBankingEvent(db, transition.turn, "partialSettlements");
      }
      await journal.updateOne(
        { _id: transition.key },
        {
          $set: {
            status: "partial",
            error: outcome.error,
            [`projections.${i}.claimedAt`]: null,
          },
        }
      );
      return result;
    }
    result.appliedProjections.push(i);
    result.newlyAppliedProjections.push(i);
    await journal.updateOne(
      { _id: transition.key },
      {
        $set: {
          [`projections.${i}.appliedAt`]: new Date(),
          [`projections.${i}.applied`]: true,
        },
      }
    );
  }

  if (stuck) {
    result.status = "partial";
    result.error = stuck;
    await journal.updateOne({ _id: transition.key }, { $set: { status: "partial", error: stuck } });
    return result;
  }

  if (result.appliedProjections.length === records.length) {
    await journal.updateOne(
      { _id: transition.key },
      { $set: { projectionsCompletedAt: new Date(), status: "applied" }, $unset: { error: "" } }
    );
  }
  return result;
}

/**
 * Journal records whose legs landed but whose projections did not all land.
 * The recovery worker's queue.
 */
export async function listUnfinishedProjections(
  db: Db,
  limit = 100
): Promise<Array<{ key: string; kind: string; turn?: number; pending: number }>> {
  const rows = await db
    .collection<{ _id: string; kind: string; turn?: number } & JournalExtension>(
      MONEY_MOVE_COLLECTION
    )
    .find({ status: "partial", projections: { $exists: true } })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, limit))
    .toArray();
  return rows.map((row) => ({
    key: row._id,
    kind: row.kind,
    turn: row.turn,
    pending: (row.projections ?? []).filter((p) => !p.appliedAt && !p.applied).length,
  }));
}

/**
 * Re-apply a journal record's unfinished projections from the copy the
 * journal kept. Money is never moved here: the legs either landed on the
 * first attempt or the record is a money repair, which is an operator's job.
 */
export async function recoverProjections(
  db: Db,
  key: string,
  options: FinishOptions = {}
): Promise<SettlementResult> {
  const journal = db.collection<{ _id: string; kind: string; turn?: number } & JournalExtension>(
    MONEY_MOVE_COLLECTION
  );
  const record = await journal.findOne({ _id: key });
  const result: SettlementResult = {
    status: "applied",
    key,
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
  };
  if (!record || !record.projections) {
    return { ...result, status: "rejected", error: "no journal record with projections" };
  }
  const transition: BankingTransition = {
    key,
    kind: record.kind,
    turn: record.turn ?? 0,
    currency: record.currency ?? "",
    legs: [],
    projections: record.projections.map((p) => p.projection),
    event: { kind: "bank.resolved", command: "bank.journal.recover" },
  };
  const out = await finishProjections(db, transition, result, options);
  if (out.status === "applied" && Number.isFinite(transition.turn)) {
    countBankingEvent(db, transition.turn, "recoveredProjections");
  }
  return out;
}
