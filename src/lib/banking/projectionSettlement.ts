/** Update projections retain target proof until their journal acknowledges delivery. */
import { isDeepStrictEqual } from "node:util";
import { ObjectId, type Db, type Document, type Filter, type UpdateFilter } from "mongodb";
import { MONEY_MOVE_COLLECTION, SETTLED_KEYS_CAP } from "./moneyMove";
import { reviveObjectIds } from "./settlementEncoding";
import type { TransitionProjection } from "./rules/boundary";

const RECEIPT = "pendingSettlementProjection";
const REVISION = "settlementProjectionRevision";
interface Receipt {
  key: string;
  index: number;
  generation: number;
}
interface Target {
  _id: unknown;
  settledKeys?: string[];
  pendingSettlementProjection?: Receipt;
  settlementProjectionRevision?: number;
}
interface ProjectionRecord {
  applied?: boolean;
  appliedAt?: Date | null;
  receiptProtocol?: string;
  projection: TransitionProjection;
}
interface Journal {
  _id: string;
  status?: string;
  projections?: ProjectionRecord[];
}
type Outcome = { ok: true; newlyApplied: boolean } | { ok: false; error: string };
const reserved = (path: string) =>
  [RECEIPT, REVISION, "settledKeys", "_id"].some((p) => path === p || path.startsWith(`${p}.`));
function reservedGuard(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      [RECEIPT, REVISION, "settledKeys"].some((p) => key === p || key.startsWith(`${p}.`)) ||
      reservedGuard(child)
  );
}
export function invalidProjectionTarget(projection: TransitionProjection): boolean {
  if (!projection.update) return false;
  const filter = reviveObjectIds(projection.filter) as Document | undefined;
  const id = filter?._id;
  if (!(typeof id === "string" || typeof id === "number" || id instanceof ObjectId)) return true;
  if (reservedGuard(filter)) return true;
  return Object.entries(projection.update).some(
    ([operator, fields]) =>
      !operator.startsWith("$") ||
      !fields ||
      typeof fields !== "object" ||
      Object.entries(fields).some(
        ([path, value]) =>
          reserved(path) || (operator === "$rename" && typeof value === "string" && reserved(value))
      )
  );
}

async function acknowledge(
  db: Db,
  collection: string,
  id: unknown,
  receipt: Receipt
): Promise<void> {
  const journal = db.collection<Journal>(MONEY_MOVE_COLLECTION);
  const path = `projections.${receipt.index}`;
  const identity =
    id instanceof ObjectId
      ? {
          $or: [
            { [`${path}.projection.filter._id`]: id },
            { [`${path}.projection.filter._id`]: { $eq: { $oid: id.toHexString() } } },
          ],
        }
      : { [`${path}.projection.filter._id`]: id };
  const ack = await journal.updateOne(
    {
      _id: receipt.key,
      status: { $ne: "rejected" },
      [`${path}.applied`]: { $ne: true },
      [`${path}.projection.collection`]: collection,
      ...identity,
    },
    { $set: { [`${path}.applied`]: true, [`${path}.appliedAt`]: new Date() } }
  );
  if (!ack.matchedCount) {
    const saved = await journal.findOne(
      { _id: receipt.key },
      { projection: { projections: 1, status: 1 } }
    );
    const projection = saved?.projections?.[receipt.index];
    if (
      saved?.status === "rejected" ||
      !projection?.applied ||
      projection.projection.collection !== collection ||
      !isDeepStrictEqual(reviveObjectIds(projection.projection.filter)?._id, id)
    )
      throw new Error("Projection target outcome requires journal reconciliation");
  }
  await db
    .collection<Target>(collection)
    .updateOne({ _id: id, [RECEIPT]: receipt } as Filter<Target>, { $unset: { [RECEIPT]: "" } });
}

/** Read target before journal so a delayed writer cannot reuse a consumed generation. */
export async function applyProtectedProjection(
  db: Db,
  key: string,
  index: number,
  projection: TransitionProjection
): Promise<Outcome> {
  if (invalidProjectionTarget(projection))
    return {
      ok: false,
      error: "Update projection requires a stable target id and unreserved fields",
    };
  const filter = reviveObjectIds(projection.filter) as Document;
  const target = db.collection<Target>(projection.collection);
  const journal = db.collection<Journal>(MONEY_MOVE_COLLECTION);
  const id = { _id: filter._id } as Filter<Target>;
  const stamp = `${key}#${index}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await target.findOne(id, {
      projection: { [RECEIPT]: 1, [REVISION]: 1, settledKeys: 1 },
    });
    const record = await journal.findOne({ _id: key }, { projection: { projections: 1 } });
    const saved = record?.projections?.[index];
    if (!saved) return { ok: false, error: "Projection is missing from its original journal" };
    const originalFilter = reviveObjectIds(saved.projection.filter) as Document | undefined;
    if (
      saved.projection.collection !== projection.collection ||
      !isDeepStrictEqual(originalFilter?._id, filter._id) ||
      invalidProjectionTarget(saved.projection)
    )
      return { ok: false, error: "Projection target differs from its original journal" };
    const update = reviveObjectIds(saved.projection.update) as Document;
    const receipt = current?.pendingSettlementProjection;
    if (receipt) {
      await acknowledge(db, projection.collection, filter._id, receipt);
      if (receipt.key === key && receipt.index === index) return { ok: true, newlyApplied: false };
      continue;
    }
    if (saved.applied || saved.appliedAt) return { ok: true, newlyApplied: false };
    if (!current)
      return { ok: false, error: `projection "${projection.note}" matched no document` };
    if (saved.receiptProtocol !== "protected_v1") {
      if (!current.settledKeys?.includes(stamp))
        return {
          ok: false,
          error:
            "Legacy pending projection has no surviving target proof; reconciliation is required",
        };
      await acknowledge(db, projection.collection, filter._id, { key, index, generation: 0 });
      return { ok: true, newlyApplied: false };
    }
    const revision = current.settlementProjectionRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
      return { ok: false, error: "Projection target has an invalid generation" };
    const guard = {
      ...id,
      [RECEIPT]: { $exists: false },
      [REVISION]: Object.hasOwn(current, REVISION)
        ? current.settlementProjectionRevision
        : { $exists: false },
    };
    const delivered: Receipt = { key, index, generation: revision + 1 };
    const write = await target.updateOne(
      { $and: [originalFilter!, guard] } as Filter<Target>,
      {
        ...update,
        $inc: { ...update.$inc, [REVISION]: 1 },
        $set: { ...update.$set, [RECEIPT]: delivered },
        $push: { ...update.$push, settledKeys: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
      } as UpdateFilter<Target>
    );
    if (write.matchedCount) {
      await acknowledge(db, projection.collection, filter._id, delivered);
      return { ok: true, newlyApplied: true };
    }
  }
  return {
    ok: false,
    error: `projection "${projection.note}" did not match its original guard; retry after reconciliation`,
  };
}
