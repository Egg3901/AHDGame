import { resumeTreasuryReserveTransfer } from "@/lib/budget/treasuryReserveTransfer";
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

import { type Db, type Document } from "mongodb";
import {
  MONEY_MOVE_COLLECTION,
  applyMoneyMove,
  type MoneyMoveLeg,
  resumeMoneyMove,
  SETTLED_KEYS_FIELD,
  SETTLED_KEYS_CAP,
} from "@/lib/banking/moneyMove";
import type {
  BankingTransition,
  TransitionLeg,
  TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { checkBalancedTransfer } from "@/lib/banking/rules/invariants";
import { countBankingEvent } from "@/lib/banking/telemetry";

import { reviveObjectIds } from "./settlementEncoding";
import { resumeLegacyDepositInterest } from "./legacyDepositInterest";
import { resumeAtomicDocumentSettlement } from "./atomicDocumentSettlement";
import {
  applyProtectedProjection,
  bindProjectionTargets,
  invalidProjectionTarget,
  isUpdateProjection,
} from "./projectionSettlement";
export { reviveObjectIds } from "./settlementEncoding";

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
  receiptProtocol?: "protected_v1";
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
 * Retry enters the publication protocol: inserts use their id, while updates
 * require protected target proof and a fresh journal/generation check.
 */
function safeToRetryBlind(_projection: TransitionProjection): boolean {
  return true;
}

/**
 * The journal record extends the primitive's claim document in place: same
 * collection, same `_id`, extra fields. One queue for operators, one index.
 */
interface JournalExtension {
  atomicDocument?: unknown;
  legacyInterestBatch?: unknown;
  locSettlement?: unknown;
  status?: string;
  error?: string;
  legs?: { applied: boolean }[];
  transitionKind?: string;
  /** Original economic quote, frozen atomically with the cash and projection claim. */
  event?: BankingTransition["event"];
  currency?: string;
  retryCreditLegOnGuardFailure?: boolean;
  projections?: JournalProjectionRecord[];
  projectionsCompletedAt?: Date;
}

/**
 * Bounded stamps remain compatibility evidence. New update projections also
 * keep a protected target outcome until the original journal acknowledges it.
 */

export function projectionStamp(key: string, index: number): string {
  return `${key}#${index}`;
}

function toMoneyLeg(leg: TransitionLeg): MoneyMoveLeg {
  return {
    kind: leg.kind,
    amount: leg.amount,
    ...(leg.valuation ? { valuation: leg.valuation } : {}),
    ...(leg.collection ? { collection: leg.collection } : {}),
    ...(leg.filter ? { filter: reviveObjectIds(leg.filter) } : {}),
    ...(leg.path ? { path: leg.path } : {}),
    ...(leg.set ? { set: reviveObjectIds(leg.set) } : {}),
    note: leg.note,
  };
}

function isDuplicateKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === 11000) return true;
  const writeErrors =
    "writeErrors" in error ? (error as { writeErrors?: unknown }).writeErrors : [];
  return (
    Array.isArray(writeErrors) &&
    writeErrors.length > 0 &&
    writeErrors.every((entry) => (entry as { code?: unknown })?.code === 11000)
  );
}

/**
 * Insert a batch of fixed-id documents. A duplicate key means an earlier
 * attempt already wrote that document, so the batch is retried one document at
 * a time to land whatever is still missing, regardless of whether the driver
 * stopped at the first duplicate.
 */
async function applyInsertBatch(
  collection: ReturnType<Db["collection"]>,
  inserts: Record<string, unknown>[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const documents = inserts.map((insert) => reviveObjectIds(insert) as Document);
  if (documents.some((document) => document._id === undefined))
    return { ok: false, error: "Batch insert projections need a fixed _id on every document" };
  try {
    if (documents.length > 0) await collection.insertMany(documents, { ordered: false });
    return { ok: true };
  } catch (error) {
    if (!isDuplicateKey(error)) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  for (const document of documents) {
    try {
      await collection.insertOne(document);
    } catch (error) {
      if (isDuplicateKey(error)) continue;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: true };
}

/**
 * Apply an immutable insert projection. Update projections must use the
 * journal-aware target publication protocol below.
 */
export async function applyProjection(
  db: Db,
  projection: TransitionProjection,
  _stamp?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const collection = db.collection(projection.collection);
  if (projection.inserts) return applyInsertBatch(collection, projection.inserts);
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
  if (isUpdateProjection(projection))
    return { ok: false, error: "Update projections require durable journal publication" };
  return { ok: false, error: `projection "${projection.note}" has neither insert nor update` };
}

/**
 * Settle a transition. Safe to call again with the same transition: a replay
 * finishes any projections the first attempt did not reach and moves no money.
 */
export { SETTLED_KEYS_FIELD, SETTLED_KEYS_CAP };

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
      (leg.kind === "debit" || leg.kind === "credit" || leg.kind === "asset") &&
      (!leg.collection || (leg.kind !== "asset" && !leg.path) || !leg.filter)
    ) {
      return { ...result, status: "rejected", error: `leg "${leg.note}" is missing a target` };
    }
  }

  const bound = await bindProjectionTargets(db, transition.key, transition.projections);
  if ("error" in bound) {
    if (bound.status) return { ...result, status: bound.status, error: bound.error };
    try {
      await journal.insertOne({
        _id: transition.key,
        kind: transition.kind,
        turn: transition.turn,
        status: "rejected",
        error: bound.error,
        createdAt: new Date(),
        legs: transition.legs.map((leg) => ({ ...toMoneyLeg(leg), applied: false })),
        projections: transition.projections.map((projection) => ({
          collection: projection.collection,
          note: projection.note,
          applied: false,
          projection,
        })),
      } as never);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
      // A competing claimant owns the outcome; load its original plan again.
      return settleTransition(db, transition);
    }
    return { ...result, status: "rejected", error: bound.error };
  }
  transition = { ...transition, projections: bound.projections };
  if (transition.projections.some(invalidProjectionTarget)) {
    return {
      ...result,
      status: "rejected",
      error: "Update projections require stable target ids and unreserved fields",
    };
  }

  const records: JournalProjectionRecord[] = transition.projections.map((projection) => ({
    receiptProtocol: "protected_v1",
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
    ...(transition.retryCreditLegOnGuardFailure ? { retryCreditLegOnGuardFailure: true } : {}),
    projections: records,
    event: transition.event,
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
    if (owned?.status === "rejected")
      return {
        ...result,
        status: "rejected",
        error: owned.error ?? "Original settlement was rejected",
      };
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
        status: records.length > 0 ? "partial" : "applied",
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
        // Someone already owns this key: its original outcome is authoritative.
        const prior = await journal.findOne(
          { _id: transition.key },
          { projection: { status: 1, error: 1 } }
        );
        if (prior?.status === "rejected")
          return {
            ...result,
            status: "rejected",
            error: prior.error ?? "Original settlement was rejected",
          };
        return finishProjections(db, transition, { ...result, status: "replayed" });
      }
      throw error;
    }
  }

  return finishProjections(
    db,
    transition,
    {
      ...result,
      status: move.status === "replayed" ? "replayed" : "applied",
    },
    {},
    move.status === "applied" ? records : undefined
  );
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
  options: FinishOptions = {},
  ownedRecords?: JournalProjectionRecord[]
): Promise<SettlementResult> {
  const journal = db.collection<{ _id: string } & JournalExtension>(MONEY_MOVE_COLLECTION);

  // The record is the authority on what remains to do. A caller replaying
  // after a crash may have recomputed its transition from state the first
  // attempt already changed (a resolution retried after the cash moved sees a
  // different shortfall); the projections that were claimed with the key are
  // the ones that finish, never the recomputed ones. Records without a
  // projection list (written by the primitive alone) fall back to the caller.
  // Only the successful claimant may use its own immutable insert payload.
  // Replays and recovery always load the original durable quote.
  const existing =
    ownedRecords === undefined ? await journal.findOne({ _id: transition.key }) : null;
  let records = ownedRecords ?? existing?.projections;
  if (records === undefined) {
    records = transition.projections.map((projection) => ({
      receiptProtocol: "protected_v1",
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

  // The first claimant can reserve every projection in one atomic write.
  // Effects still land in order and each target keeps its independent stamp.
  // A racing replay that claimed any projection makes this CAS fail, so the
  // ordinary per-projection path remains authoritative for that case.
  let ownsAllProjections = false;
  if (ownedRecords && records.length > 1) {
    const claimedAt = new Date();
    const claim = await journal.updateOne(
      {
        _id: transition.key,
        ...Object.fromEntries(records.map((_, i) => [`projections.${i}.claimedAt`, null])),
      },
      { $set: Object.fromEntries(records.map((_, i) => [`projections.${i}.claimedAt`, claimedAt])) }
    );
    ownsAllProjections = claim.matchedCount === 1;
  }

  let stuck: string | undefined;
  // Insert projections carry fixed ids, so replaying one after a crash is a
  // duplicate-key no-op. Their "applied" marks therefore ride on the next
  // journal write this pass makes instead of costing one write each.
  const insertMarks: Record<string, unknown> = {};
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record?.appliedAt || record?.applied) {
      if (isUpdateProjection(record.projection))
        await applyProtectedProjection(db, transition.key, i, record.projection);
      result.appliedProjections.push(i);
      continue;
    }
    const projection = record.projection;
    if (isUpdateProjection(projection) && !record.receiptProtocol && !record.claimedAt) {
      await journal.updateOne(
        {
          _id: transition.key,
          [`projections.${i}.claimedAt`]: null,
          [`projections.${i}.applied`]: false,
          [`projections.${i}.receiptProtocol`]: { $exists: false },
        },
        { $set: { [`projections.${i}.receiptProtocol`]: "protected_v1" } }
      );
    }
    if (record?.claimedAt && !safeToRetryBlind(projection) && !options.force) {
      stuck = `projection "${projection.note}" was claimed by an earlier attempt and cannot be retried blind`;
      continue;
    }

    // Claim first. On a fresh record the claim is a plain set; on a retry of
    // a claimed insert it is a no-op that still matches.
    const claim = ownsAllProjections
      ? { matchedCount: 1 }
      : await journal.updateOne(
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

    const outcome = isUpdateProjection(projection)
      ? await applyProtectedProjection(db, transition.key, i, projection)
      : await applyProjection(db, projection, projectionStamp(transition.key, i));
    if (!outcome.ok) {
      // Keep update claims intact: a legacy ambiguity must never become a
      // fresh admission on the next recovery attempt. New protocols may retry
      // their original guard without losing the protected outcome.
      result.status = "partial";
      result.error = outcome.error;
      if (Number.isFinite(transition.turn)) {
        countBankingEvent(db, transition.turn, "partialSettlements");
      }
      await journal.updateOne(
        { _id: transition.key, [`projections.${i}.applied`]: { $ne: true } },
        {
          $set: {
            ...insertMarks,
            status: "partial",
            error: outcome.error,
            ...(!isUpdateProjection(projection) ? { [`projections.${i}.claimedAt`]: null } : {}),
          },
        }
      );
      return result;
    }
    result.appliedProjections.push(i);
    if (!("newlyApplied" in outcome) || outcome.newlyApplied)
      result.newlyAppliedProjections.push(i);
    if (isUpdateProjection(projection)) continue;
    insertMarks[`projections.${i}.appliedAt`] = new Date();
    insertMarks[`projections.${i}.applied`] = true;
  }

  if (stuck) {
    result.status = "partial";
    result.error = stuck;
    await journal.updateOne(
      { _id: transition.key },
      { $set: { ...insertMarks, status: "partial", error: stuck } }
    );
    return result;
  }

  if (result.appliedProjections.length === records.length) {
    await journal.updateOne(
      { _id: transition.key },
      {
        $set: { ...insertMarks, projectionsCompletedAt: new Date(), status: "applied" },
        $unset: { error: "" },
      }
    );
  } else if (Object.keys(insertMarks).length) {
    await journal.updateOne({ _id: transition.key }, { $set: insertMarks });
  }
  return result;
}

/**
 * Journal records whose legs landed but whose projections did not all land.
 * The recovery worker's queue.
 */
export function unfinishedSettlementFilter(): Record<string, unknown> {
  return {
    $or: [
      { status: "partial" },
      // Older records prematurely marked cash delivery as fully applied.
      {
        status: "applied",
        "projections.0": { $exists: true },
        projectionsCompletedAt: { $exists: false },
      },
    ],
  };
}

export async function listUnfinishedProjections(
  db: Db,
  limit = 100
): Promise<Array<{ key: string; kind: string; turn?: number; pending: number }>> {
  const rows = await db
    .collection<{ _id: string; kind: string; turn?: number } & JournalExtension>(
      MONEY_MOVE_COLLECTION
    )
    .find({ ...unfinishedSettlementFilter(), projections: { $exists: true } })
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
 * Finish a settlement that crashed anywhere after its claim: the legs that
 * did not land are written from the record (guards included), then the
 * projections that did not land are applied from the record. The one entry
 * point for recovery, used by the resolution sweep and the recovery worker.
 * Never called by a live settlement: a live attempt that finds the key owned
 * reports a replay and leaves it to recovery, which runs alone.
 */
export async function resumeSettlement(
  db: Db,
  key: string,
  options: FinishOptions = {}
): Promise<SettlementResult> {
  const record = await db
    .collection<{
      _id: string;
      atomicDocument?: unknown;
      legacyInterestBatch?: unknown;
      locSettlement?: unknown;
      treasuryReserveTransfer?: unknown;
    }>(MONEY_MOVE_COLLECTION)
    .findOne(
      { _id: key },
      {
        projection: {
          atomicDocument: 1,
          legacyInterestBatch: 1,
          locSettlement: 1,
          treasuryReserveTransfer: 1,
        },
      }
    );
  if (record?.locSettlement) {
    const { resumeLocSettlement } = await import("@/lib/lineOfCredit/settlement");
    return resumeLocSettlement(db, key);
  }
  if (record?.treasuryReserveTransfer) return resumeTreasuryReserveTransfer(db, key);
  if (record?.legacyInterestBatch) return resumeLegacyDepositInterest(db, key);
  if (record?.atomicDocument) return resumeAtomicDocumentSettlement(db, key);
  const moved = await resumeMoneyMove(db, key);
  if (moved.status !== "applied") {
    return {
      status: moved.status === "rejected" ? "rejected" : "partial",
      key,
      appliedLegs: moved.applied,
      appliedProjections: [],
      newlyAppliedProjections: [],
      error: moved.error,
    };
  }
  const out = await recoverProjections(db, key, options);
  return { ...out, appliedLegs: moved.applied };
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
  if (record?.locSettlement) {
    const { resumeLocSettlement } = await import("@/lib/lineOfCredit/settlement");
    return resumeLocSettlement(db, key);
  }
  if (record?.legacyInterestBatch) return resumeLegacyDepositInterest(db, key);
  if (record?.atomicDocument) return resumeAtomicDocumentSettlement(db, key);
  const result: SettlementResult = {
    status: "applied",
    key,
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
  };
  if (record?.status === "rejected")
    return {
      ...result,
      status: "rejected",
      error: record.error ?? "Original settlement was rejected",
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
