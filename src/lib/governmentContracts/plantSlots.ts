/** Defence factory operations use stable owner keys and request fencing so an old request cannot unlock its resumed successor. */
import type { Db, ObjectId } from "mongodb";
export async function lockContractPlant(
  db: Db,
  sectorId: ObjectId,
  owner: string,
  operationKey = owner,
  operationRevision?: number
) {
  return db.collection("corporateSectors").findOneAndUpdate(
    {
      _id: sectorId,
      $or: [
        { contractMutationOwner: { $exists: false } },
        {
          contractMutationOwner: owner,
          ...(operationRevision == null
            ? {}
            : {
                $or: [
                  { contractMutationRevision: { $exists: false } },
                  { contractMutationRevision: { $lte: operationRevision } },
                ],
              }),
        },
      ],
    },
    {
      $set: {
        contractMutationOwner: owner,
        contractMutationKey: operationKey,
        ...(operationRevision == null ? {} : { contractMutationRevision: operationRevision }),
      },
      $inc: { contractMutationSequence: 1 },
    },
    { returnDocument: "after", projection: { strategyId: 1, contractMutationSequence: 1 } }
  );
}
export async function releaseContractPlant(
  db: Db,
  sectorId: ObjectId,
  owner: string,
  operationKey = owner
) {
  await db.collection("corporateSectors").updateOne(
    { _id: sectorId, contractMutationOwner: owner, contractMutationKey: operationKey },
    {
      $unset: {
        contractMutationOwner: "",
        contractMutationKey: "",
        contractMutationRevision: "",
      },
    }
  );
}
