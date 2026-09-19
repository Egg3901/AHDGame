/**
 * Durable, crash-aware execution of an agreed-acquisition payout (shell: loads
 * documents, calls the pinned plan in `rules/acquisitionPayoutPlan.ts`, writes
 * results).
 *
 * Why this exists: the legacy flow debited the acquirer, then credited holders
 * across several unrecorded writes, then refunded the FULL debit when anything
 * later threw. Paid holders kept their money and the offer reset to `pending`,
 * so a retry double-debited and double-pays. This module replaces that with
 * three properties borrowed from the banking money-move primitive (which is
 * the established answer on a database with no multi-document transactions):
 *
 * 1. The plan is claimed BEFORE any money moves: one settlement document per
 *    offer (`_id` = offer id, so the claim is an `insertOne` and a retry loses
 *    it with E11000 and resumes from the record instead of recomputing).
 * 2. Every leg applies as one atomic document write (credit plus idempotency
 *    stamp, guarded on `settledKeys $ne stamp`, the same shape as `applyLeg`).
 *    A replay of a landed leg matches nothing and is read back as applied from
 *    the stamp on the document itself, which closes the crash window between
 *    the money write and the record update.
 * 3. Terminal failure compensates instead of pretending: the refund is exactly
 *    `price - delivered`, stamped like any other leg, with a refund ledger leg
 *    so the log nets truthfully. Paid holder legs are never clawed back (they
 *    cannot be) and the offer goes to `failed`, never back to `pending`.
 */

import { ObjectId, type Db, type Document, type Filter, type UpdateFilter } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { legStamp, SETTLED_KEYS_CAP, SETTLED_KEYS_FIELD } from "@/lib/banking/moneyMove";
import { emitTx } from "@/lib/financialTxLog/emit";
import type {
  AcquisitionSettlement,
  AcquisitionSettlementLeg,
  AcquisitionSettlementResult,
} from "@/lib/db/types/acquisitionSettlement";
import type { PlannedLeg, PayoutPlan } from "./rules/acquisitionPayoutPlan";

export const ACQUISITION_SETTLEMENTS = "acquisitionSettlements";

/** Another live settlement already owns this target. Retry-safe abort. */
export class AcquisitionTargetBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcquisitionTargetBusyError";
  }
}

/** A retry recomputed a plan that disagrees with the claimed one. Never retry blind. */
export class AcquisitionSettlementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcquisitionSettlementConflictError";
  }
}

function settlements(db: Db) {
  return db.collection<AcquisitionSettlement>(ACQUISITION_SETTLEMENTS);
}

export async function loadAcquisitionSettlement(
  db: Db,
  offerId: ObjectId
): Promise<AcquisitionSettlement | null> {
  return settlements(db).findOne({ _id: offerId });
}

function storedFilter(collection: string, id: string): Record<string, unknown> {
  if (collection === "federalBudget") return { countryId: id };
  if (!ObjectId.isValid(id)) throw new AcquisitionSettlementConflictError(`bad leg id ${id}`);
  return { _id: new ObjectId(id) };
}

function toStoredLeg(plan: PlannedLeg): AcquisitionSettlementLeg {
  return {
    key: plan.key,
    kind: plan.kind,
    collection: plan.collection,
    filter: storedFilter(plan.collection, plan.id),
    inc: { ...plan.inc },
    ...(plan.pull
      ? {
          pull: {
            path: plan.pull.path,
            selector:
              plan.pull.selector.corporationId !== undefined &&
              typeof plan.pull.selector.corporationId === "string"
                ? {
                    ...plan.pull.selector,
                    corporationId: new ObjectId(plan.pull.selector.corporationId as string),
                  }
                : { ...plan.pull.selector },
          },
        }
      : {}),
    ...(plan.guardPath ? { guardPath: plan.guardPath, guardGte: plan.guardGte } : {}),
    payoutAnchor: plan.payoutAnchor,
    costInAcquirerCapital: plan.costInAcquirerCapital,
    currencyCode: plan.currencyCode,
    note: plan.note,
    applied: false,
    ledgerEmitted: false,
    ledgers: plan.ledgers.map((entry) => ({
      type: entry.type,
      amount: entry.amount,
      currencyCode: entry.currencyCode,
      subjectType: entry.subjectType,
      ...(entry.subjectId ? { subjectId: new ObjectId(entry.subjectId) } : {}),
      subjectName: entry.subjectName,
      ...(entry.countryId ? { countryId: entry.countryId } : {}),
      counterpartyType: entry.counterpartyType,
      counterpartyId: new ObjectId(entry.counterpartyId),
      ...(entry.counterpartyName ? { counterpartyName: entry.counterpartyName } : {}),
      meta: { ...entry.meta },
    })),
  };
}

export interface ClaimSpec {
  offerId: ObjectId;
  acquirerHex: string;
  targetHex: string;
  acquirerName: string;
  targetName: string;
  priceAnchor: number;
  priceInAcquirerCapital: number;
  acquirerCurrency: string;
  shellCashTargetLocal: number;
  targetCurrency: string;
  /** Target sector count pinned at claim time, before any move (see type). */
  sectorTotal: number;
  /** Review whose remedy attaches on commit; persisted so a post-teardown retry can finish the tail. */
  remedyReviewId?: string;
  plan: PayoutPlan;
}

export function legIndexByKey(settlement: AcquisitionSettlement, key: string): number {
  return settlement.legs.findIndex((leg) => leg.key === key);
}

/**
 * Claim the settlement for this offer, or load the existing one on retry.
 * Refuses when a DIFFERENT live settlement already owns the target, which is
 * what stops two concurrently accepted offers for one corporation from both
 * paying out (the pre-existing double-accept race).
 */
export async function claimAcquisitionSettlement(
  db: Db,
  spec: ClaimSpec
): Promise<{ settlement: AcquisitionSettlement; fresh: boolean }> {
  const now = new Date();
  const doc: AcquisitionSettlement = {
    _id: spec.offerId,
    key: spec.plan.key,
    ...(spec.remedyReviewId ? { remedyReviewId: spec.remedyReviewId } : {}),
    status: "in_progress",
    acquirerCorporationId: new ObjectId(spec.acquirerHex),
    targetCorporationId: new ObjectId(spec.targetHex),
    acquirerName: spec.acquirerName,
    targetName: spec.targetName,
    priceAnchor: spec.priceAnchor,
    priceInAcquirerCapital: spec.priceInAcquirerCapital,
    acquirerCurrency: spec.acquirerCurrency,
    legs: spec.plan.legs.map(toStoredLeg),
    refundTotal: 0,
    sectorTotal: spec.sectorTotal,
    sectorsMoved: 0,
    bankCharterTransferred: false,
    shellDeleted: false,
    shellCashTargetLocal: spec.shellCashTargetLocal,
    targetCurrency: spec.targetCurrency,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await settlements(db).insertOne(doc);
    return { settlement: doc, fresh: true };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 11000) throw error;
  }
  const existing = await loadAcquisitionSettlement(db, spec.offerId);
  if (!existing)
    throw new AcquisitionSettlementConflictError("settlement claim lost but no record found");
  // Identity is pinned; amounts are not re-verified: FX drift between attempts
  // must never invalidate the pinned legs, which are the only amounts applied.
  if (
    existing.priceAnchor !== spec.priceAnchor ||
    existing.targetCorporationId.toString() !== spec.targetHex ||
    existing.acquirerCorporationId.toString() !== spec.acquirerHex
  ) {
    throw new AcquisitionSettlementConflictError("settlement record disagrees with this offer");
  }
  return { settlement: existing, fresh: false };
}

export type LegApplyResult = "applied" | "replayed" | "guard_failed" | "unpayable";

/**
 * Apply one pinned leg: idempotent cleanup first (fund holding pull), then the
 * stamped credit. Returns `replayed` when the stamp shows the money already
 * landed, `guard_failed` when the document exists but the sufficiency guard
 * does not match (debit only), and `unpayable` when the recipient is gone.
 */
export async function applyAcquisitionLeg(
  db: Db,
  settlement: AcquisitionSettlement,
  index: number,
  now: Date
): Promise<LegApplyResult> {
  const leg = settlement.legs[index];
  if (!leg) throw new AcquisitionSettlementConflictError(`no settlement leg at index ${index}`);
  if (leg.applied) return "replayed";

  const stamp = legStamp(settlement.key, index);
  const collection = db.collection(leg.collection);

  if (leg.pull) {
    const pulled = await collection.updateOne(
      leg.filter as Filter<Document>,
      {
        $pull: { [leg.pull.path]: leg.pull.selector },
      } as unknown as UpdateFilter<Document>
    );
    if (pulled.matchedCount !== 1) return "unpayable";
  }

  const filter = {
    ...leg.filter,
    ...(leg.guardPath && leg.guardGte !== undefined
      ? { [leg.guardPath]: { $gte: leg.guardGte } }
      : {}),
    [SETTLED_KEYS_FIELD]: { $ne: stamp },
  } as Filter<Document>;
  const update = {
    $inc: leg.inc,
    $set: { updatedAt: now },
    $push: { [SETTLED_KEYS_FIELD]: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
  } as unknown as UpdateFilter<Document>;
  const res = await collection.updateOne(filter, update);
  if (res.matchedCount === 1) {
    await markLegApplied(db, settlement._id, index);
    leg.applied = true;
    return "applied";
  }
  // No match with the stamp excluded: either the write landed on an earlier
  // attempt (the document carries the stamp) or the target is genuinely wrong.
  const landed = await collection.findOne(
    { ...leg.filter, [SETTLED_KEYS_FIELD]: stamp } as Filter<Document>,
    { projection: { _id: 1 } }
  );
  if (landed) {
    await markLegApplied(db, settlement._id, index);
    leg.applied = true;
    return "replayed";
  }
  const exists = await collection.findOne(leg.filter as Filter<Document>, {
    projection: { _id: 1 },
  });
  return exists ? "guard_failed" : "unpayable";
}

async function markLegApplied(db: Db, offerId: ObjectId, index: number): Promise<void> {
  await settlements(db).updateOne(
    { _id: offerId },
    { $set: { [`legs.${index}.applied`]: true, updatedAt: new Date() } }
  );
}

/** Emit a leg's pinned ledger entries exactly once (ledger is best-effort; money is exact). */
export async function emitAcquisitionLegLedger(
  db: Db,
  settlement: AcquisitionSettlement,
  index: number,
  turn: number,
  now: Date
): Promise<void> {
  const leg = settlement.legs[index];
  if (!leg || leg.ledgerEmitted || leg.ledgers.length === 0) return;
  for (const entry of leg.ledgers) {
    await emitTx(db, {
      type: entry.type,
      turn,
      createdAt: now,
      subjectType: entry.subjectType,
      ...(entry.subjectId ? { subjectId: entry.subjectId } : {}),
      subjectName: entry.subjectName,
      ...(entry.countryId ? { countryId: entry.countryId } : {}),
      amount: entry.amount,
      currencyCode: entry.currencyCode as CurrencyCode,
      counterpartyType: entry.counterpartyType,
      counterpartyId: entry.counterpartyId,
      ...(entry.counterpartyName ? { counterpartyName: entry.counterpartyName } : {}),
      meta: entry.meta,
    });
  }
  await settlements(db).updateOne(
    { _id: settlement._id },
    { $set: { [`legs.${index}.ledgerEmitted`]: true, updatedAt: new Date() } }
  );
  leg.ledgerEmitted = true;
}

/**
 * Acquirer-capital cost of every delivered holder leg. Shell-cash legs are
 * deliberately excluded: the relocation is unwound by taking it back from the
 * acquirer (see below), never by shrinking the price refund. Counting it here
 * too would charge the acquirer twice for the same cash.
 */
export function deliveredCostInAcquirerCapital(settlement: AcquisitionSettlement): number {
  return settlement.legs
    .filter((leg) => leg.applied && leg.kind === "holder_credit")
    .reduce((sum, leg) => sum + leg.costInAcquirerCapital, 0);
}

/**
 * Mark legs whose money landed but whose applied flag did not (crash between
 * the stamped credit and its mark). Without this a compensation computed from
 * the flags alone would refund money that already reached a holder, or skip
 * taking back shell cash that already reached the acquirer. Reads the stamp
 * off each recipient document, the same check the replay path uses.
 */
async function reconcileLandedLegs(db: Db, settlement: AcquisitionSettlement): Promise<void> {
  for (let index = 0; index < settlement.legs.length; index += 1) {
    const leg = settlement.legs[index];
    if (leg.applied) continue;
    if (leg.kind === "acquirer_refund" || leg.kind === "shell_cash_reversal") continue;
    const stamp = legStamp(settlement.key, index);
    const landed = await db
      .collection(leg.collection)
      .findOne({ ...leg.filter, [SETTLED_KEYS_FIELD]: stamp } as Filter<Document>, {
        projection: { _id: 1 },
      });
    if (landed) {
      await markLegApplied(db, settlement._id, index);
      leg.applied = true;
    }
  }
}

function debitLegApplied(settlement: AcquisitionSettlement): boolean {
  return settlement.legs.some((leg) => leg.kind === "acquirer_debit" && leg.applied);
}

/** Net refund owed on terminal compensation: price minus delivered minus already refunded. */
export function compensationRefundOwed(settlement: AcquisitionSettlement): number {
  if (!debitLegApplied(settlement)) return 0;
  return Math.max(
    0,
    Math.round(settlement.priceInAcquirerCapital) -
      deliveredCostInAcquirerCapital(settlement) -
      settlement.refundTotal
  );
}

function findLegIndex(settlement: AcquisitionSettlement, key: string): number {
  return settlement.legs.findIndex((leg) => leg.key === key);
}

async function appendLeg(
  db: Db,
  settlement: AcquisitionSettlement,
  leg: AcquisitionSettlementLeg
): Promise<number> {
  const existing = findLegIndex(settlement, leg.key);
  if (existing >= 0) return existing;
  const index = settlement.legs.length;
  await settlements(db).updateOne({ _id: settlement._id }, {
    $push: { legs: leg },
    $set: { updatedAt: new Date() },
  } as UpdateFilter<AcquisitionSettlement>);
  settlement.legs.push(leg);
  return index;
}

export interface CompensationResult {
  refunded: number;
  shellCashReversed: boolean;
  notes: string[];
}

/**
 * Terminal compensation: refund exactly the undelivered remainder to the
 * acquirer (stamped, so a retried compensation cannot refund twice), take
 * back landed shell cash from the acquirer when the shell still exists, and
 * close the record. Paid holder legs are never touched: they cannot be
 * clawed back, and the refund math already accounts for them.
 */
export async function compensateAcquisitionSettlement(
  db: Db,
  settlement: AcquisitionSettlement,
  opts: { targetHex: string | null; turn: number; now: Date; reason: string }
): Promise<CompensationResult> {
  const notes: string[] = [];
  let refunded = 0;
  // Reconcile first: a crash between a stamped credit and its mark leaves the
  // money landed but the flag clear, and the refund below reads the flags.
  await reconcileLandedLegs(db, settlement);
  const refund = compensationRefundOwed(settlement);
  if (refund > 0) {
    const index = await appendLeg(db, settlement, {
      key: "refund",
      kind: "acquirer_refund",
      collection: "corporations",
      filter: { _id: settlement.acquirerCorporationId },
      inc: { liquidCapital: refund },
      payoutAnchor: 0,
      costInAcquirerCapital: 0,
      currencyCode: settlement.acquirerCurrency,
      note: "terminal refund of the undelivered remainder",
      applied: false,
      ledgerEmitted: false,
      ledgers: [
        {
          type: "share_buyout_outflow",
          amount: refund,
          currencyCode: settlement.acquirerCurrency,
          subjectType: "corporation",
          subjectId: settlement.acquirerCorporationId,
          subjectName: settlement.acquirerName,
          counterpartyType: "corporation",
          counterpartyId: settlement.targetCorporationId,
          counterpartyName: settlement.targetName,
          meta: {
            kind: "agreed_acquisition",
            side: "acquirer_refund",
            offerId: settlement._id.toString(),
          },
        },
      ],
    });
    const outcome = await applyAcquisitionLeg(db, settlement, index, opts.now);
    if (outcome === "applied" || outcome === "replayed") {
      if (!settlement.legs[index].ledgerEmitted) {
        await emitAcquisitionLegLedger(db, settlement, index, opts.turn, opts.now);
      }
      const alreadyCounted = settlement.refundTotal;
      await settlements(db).updateOne(
        { _id: settlement._id },
        { $set: { refundTotal: alreadyCounted + refund, updatedAt: new Date() } }
      );
      settlement.refundTotal = alreadyCounted + refund;
      refunded = refund;
    } else {
      notes.push(
        `refund of ${refund} could not be applied (${outcome}); the debit died with the acquirer`
      );
    }
  }

  let shellCashReversed = false;
  const shellLeg = settlement.legs.find((leg) => leg.kind === "shell_cash_credit");
  const shellAmount = shellLeg && shellLeg.applied ? shellLeg.inc.liquidCapital : 0;
  if (shellAmount > 0 && opts.targetHex) {
    // The shell credit created money on the acquirer without debiting the
    // target (which still holds its own cash), so the take-back is an
    // acquirer-side debit only. Crediting the target as well would double its
    // cash from nothing.
    const debitBack = await appendLeg(db, settlement, {
      key: "shell-reversal-acquirer",
      kind: "shell_cash_reversal",
      collection: "corporations",
      filter: { _id: settlement.acquirerCorporationId },
      inc: { liquidCapital: -shellAmount },
      payoutAnchor: 0,
      costInAcquirerCapital: 0,
      currencyCode: settlement.acquirerCurrency,
      note: "terminal reversal of landed shell cash (acquirer side)",
      applied: false,
      ledgerEmitted: true,
      ledgers: [],
    });
    const outcome = await applyAcquisitionLeg(db, settlement, debitBack, opts.now);
    shellCashReversed = outcome !== "unpayable";
    if (!shellCashReversed) notes.push("landed shell cash could not be taken back");
  } else if (shellAmount > 0) {
    notes.push("landed shell cash stays with the acquirer; the target shell is gone");
  }

  // Persist the failure notes with the reason: a refund that could not land
  // (its owner is gone) must stay visible on the record, not just in memory.
  const error = notes.length > 0 ? `${opts.reason} (${notes.join("; ")})` : opts.reason;
  await settlements(db).updateOne(
    { _id: settlement._id },
    {
      $set: {
        status: "compensated",
        error,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  settlement.status = "compensated";
  settlement.error = error;
  return { refunded, shellCashReversed, notes };
}

export async function markAcquisitionProgress(
  db: Db,
  offerId: ObjectId,
  progress: Partial<
    Pick<AcquisitionSettlement, "sectorsMoved" | "bankCharterTransferred" | "shellDeleted">
  >
): Promise<void> {
  await settlements(db).updateOne(
    { _id: offerId },
    { $set: { ...progress, updatedAt: new Date() } }
  );
}

export async function markAcquisitionApplied(
  db: Db,
  settlement: AcquisitionSettlement,
  result: AcquisitionSettlementResult
): Promise<void> {
  await settlements(db).updateOne(
    { _id: settlement._id },
    {
      $set: {
        status: "applied",
        completedResult: result,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  settlement.status = "applied";
  settlement.completedResult = result;
}
