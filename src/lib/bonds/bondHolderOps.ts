import type { Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";

export type BondHolderTarget =
  | { field: "characterId"; id: ObjectId }
  | { field: "imperialCharacterId"; id: ObjectId }
  | { field: "corporationId"; id: ObjectId }
  | { field: "fundId"; id: ObjectId }
  | { field: "nppId"; id: ObjectId };

/**
 * Atomically move bond units from public float to a holder entry on the bond doc.
 */
export async function reserveBondUnitsForHolder(
  db: Db,
  bondId: ObjectId,
  target: BondHolderTarget,
  units: number,
  now: Date,
  options?: { avgCostPerUnit?: number }
): Promise<boolean> {
  const holderSet: Record<string, unknown> = { updatedAt: now };
  if (options?.avgCostPerUnit !== undefined) {
    holderSet["holders.$.avgCostPerUnit"] = options.avgCostPerUnit;
  }

  const existingHolderResult = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      publicFloat: { $gte: units },
      [`holders.${target.field}`]: target.id,
    },
    {
      $inc: { "holders.$.units": units, publicFloat: -units },
      $set: holderSet,
    }
  );
  if (existingHolderResult.modifiedCount > 0) return true;

  const newHolder: Record<string, unknown> = {
    [target.field]: target.id,
    units,
  };
  if (options?.avgCostPerUnit !== undefined) {
    newHolder.avgCostPerUnit = options.avgCostPerUnit;
  }

  const pushResult = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      publicFloat: { $gte: units },
      holders: {
        $not: { $elemMatch: { [target.field]: target.id } },
      },
    },
    {
      $push: { holders: newHolder },
      $inc: { publicFloat: -units },
      $set: { updatedAt: now },
    }
  );
  if (pushResult.modifiedCount > 0) return true;

  const retryExistingHolderResult = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      publicFloat: { $gte: units },
      [`holders.${target.field}`]: target.id,
    },
    {
      $inc: { "holders.$.units": units, publicFloat: -units },
      $set: holderSet,
    }
  );

  return retryExistingHolderResult.modifiedCount > 0;
}
