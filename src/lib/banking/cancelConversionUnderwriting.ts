/** Refund only a specific unpublished primary funding receipt inside a transaction. */
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import { boundSession } from "@/lib/db/sessionDb";
import { MONEY_MOVE_COLLECTION, legStamp, type MoneyMoveRecordLeg } from "./moneyMove";
import { projectionStamp, resumeSettlement } from "./settlementJournal";
import { reviveObjectIds } from "./settlementEncoding";
import { quoteUnpublishedUnderwritingRefund } from "./rules/conversionRefund";
import type { TransitionProjection } from "./rules/boundary";
type TargetCollection = "corporations" | "bonds" | "equityMarketPools" | "bondMarketPools";
interface Target {
  _id: ObjectId | string;
  settledKeys?: string[];
  pendingMoneyMoveReceipt?: { key: string; index: number; outcome: string };
  pendingSettlementProjection?: { key: string; index: number };
}
interface Journal {
  _id: string;
  kind?: string;
  status?: string;
  conversionRefundTurn?: number;
  legs: MoneyMoveRecordLeg[];
  projections: Array<{ applied?: boolean; appliedAt?: Date; projection: TransitionProjection }>;
}
function targetCollection(name: string): TargetCollection {
  if (!["corporations", "bonds", "equityMarketPools", "bondMarketPools"].includes(name))
    throw new Error("Unexpected underwriting target");
  return name as TargetCollection;
}
async function projectionTarget(db: Db, projection: TransitionProjection): Promise<Target | null> {
  const id = reviveObjectIds(projection.filter)?._id;
  if (!id) throw new Error("Underwriting publication has no frozen identity");
  return db
    .collection<Target>(targetCollection(projection.collection))
    .findOne({ _id: id as ObjectId | string });
}
function published(journal: Journal, index: number, target: Target | null): boolean {
  return Boolean(
    journal.projections[index]?.applied ||
    journal.projections[index]?.appliedAt ||
    target?.settledKeys?.includes(projectionStamp(journal._id, index)) ||
    (target?.pendingSettlementProjection?.key === journal._id &&
      target.pendingSettlementProjection.index === index)
  );
}
async function refundLeg(
  db: Db,
  journal: Journal,
  leg: MoneyMoveRecordLeg,
  index: number
): Promise<void> {
  if (!leg.collection || !leg.path || !leg.filter?._id || !["debit", "credit"].includes(leg.kind))
    throw new Error("Unrecognized primary cash leg");
  const collection = db.collection<Target>(targetCollection(leg.collection));
  const id = reviveObjectIds(leg.filter)._id as ObjectId | string;
  const target = await collection.findOne({ _id: id });
  if (!target) throw new Error("Missing underwriting recipient");
  const pending = target.pendingMoneyMoveReceipt;
  const applied = Boolean(
    leg.applied ||
    target.settledKeys?.includes(legStamp(journal._id, index)) ||
    (pending?.key === journal._id && pending.index === index && pending.outcome === "applied")
  );
  const [delta] = quoteUnpublishedUnderwritingRefund({
    published: false,
    legs: [{ kind: leg.kind as "debit" | "credit", amount: leg.amount, applied }],
  });
  if (!applied || !delta) return;
  const result = await collection.updateOne(
    { _id: id, ...(delta < 0 ? { [leg.path]: { $gte: -delta } } : {}) },
    {
      $inc: {
        [leg.path]: delta,
        ...Object.fromEntries(
          Object.entries(leg.inc ?? {}).map(([path, amount]) => [path, -amount])
        ),
      },
      ...(pending?.key === journal._id ? { $unset: { pendingMoneyMoveReceipt: "" } } : {}),
    }
  );
  if (result.matchedCount !== 1) throw new Error("Underwriting refund balance changed");
}
async function cancelLease(db: Db, bank: Corporation, turn: number): Promise<void> {
  const lease = bank.bankUnderwritingFunding!;
  const journals = db.collection<Journal>(MONEY_MOVE_COLLECTION);
  const journal = await journals.findOne({ _id: lease.key });
  if (
    journal &&
    journal.conversionRefundTurn === undefined &&
    (!journal.projections[1] || journal.kind !== "bank.primary_underwriting")
  )
    throw new Error("Unrecognized underwriting journal");
  if (
    journal &&
    journal.conversionRefundTurn === undefined &&
    published(journal, 1, await projectionTarget(db, journal.projections[1].projection))
  ) {
    const settled = await resumeSettlement(db, lease.key);
    if (settled.error || !["applied", "replayed"].includes(settled.status))
      throw new Error("Published underwriting acknowledgement remains pending");
    return;
  }
  if (journal && journal.conversionRefundTurn === undefined) {
    await journals.updateOne(
      { _id: lease.key },
      {
        $set: {
          status: "rejected",
          error: "Cancelled by boundary conversion",
          conversionRefundTurn: turn,
        },
      }
    );
    for (const [index, leg] of journal.legs.entries()) await refundLeg(db, journal, leg, index);
    const projection = journal.projections[0];
    if (projection && published(journal, 0, await projectionTarget(db, projection.projection)))
      await db.collection<Target>(lease.poolCollection).updateOne(
        { _id: lease.currencyCode },
        {
          $inc: { "lifetime.issuanceOut": -lease.grossLocal },
          $unset: { pendingSettlementProjection: "" },
        }
      );
  } else if (!journal) {
    await journals.insertOne({
      _id: lease.key,
      status: "rejected",
      legs: [],
      projections: [],
      conversionRefundTurn: turn,
    });
  }
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: bank._id, "bankUnderwritingFunding.key": lease.key },
      { $unset: { bankUnderwritingFunding: "" } }
    );
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: lease.issuerCorporationId, "primaryUnderwritingIncomingFunding.key": lease.key },
      { $unset: { primaryUnderwritingIncomingFunding: "" } }
    );
}
export async function cancelConversionUnderwriting(
  db: Db,
  ids: ObjectId[],
  turn: number
): Promise<void> {
  if (!boundSession(db)) throw new Error("Conversion refunds require a transaction");
  if (!ids.length) return;
  const banks = await db
    .collection<Corporation>("corporations")
    .find({
      "bankUnderwritingFunding.key": { $exists: true },
      $or: [{ _id: { $in: ids } }, { "bankUnderwritingFunding.issuerCorporationId": { $in: ids } }],
    })
    .toArray();
  for (const bank of banks) await cancelLease(db, bank, turn);
}
