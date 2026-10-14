/** Defence factory operations use stable owner keys and request fencing so an old request cannot unlock its resumed successor. */
import type { Db, ObjectId } from "mongodb";
export async function lockContractPlant(
  db: Db,
  sectorId: ObjectId,
  owner: string,
  operationKey = owner
) {
  return db.collection("corporateSectors").findOneAndUpdate(
    {
      _id: sectorId,
      $or: [{ contractMutationOwner: { $exists: false } }, { contractMutationOwner: owner }],
    },
    { $set: { contractMutationOwner: owner, contractMutationKey: operationKey } },
    { returnDocument: "after", projection: { strategyId: 1 } }
  );
}
export async function releaseContractPlant(
  db: Db,
  sectorId: ObjectId,
  owner: string,
  operationKey = owner
) {
  await db
    .collection("corporateSectors")
    .updateOne(
      { _id: sectorId, contractMutationOwner: owner, contractMutationKey: operationKey },
      { $unset: { contractMutationOwner: "", contractMutationKey: "" } }
    );
}
