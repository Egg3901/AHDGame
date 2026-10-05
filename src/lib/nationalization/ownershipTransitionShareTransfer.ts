import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";

export type HeldStake = Pick<
  Corporation,
  "_id" | "shareholders" | "sharePrice" | "liquidCurrencyCode" | "countryId"
>;

/**
 * Transfer shares owned by a seized corporation to the National Corporation.
 * The shares move in kind because the buyout has already paid the seized
 * corporation's holders their market value.
 */
export async function transferOwnedSharesToNatCorp(
  db: Db,
  seizedCorp: Corporation,
  nationalCorpId: ObjectId,
  heldStakes: HeldStake[],
  now: Date
): Promise<void> {
  const corps = db.collection<Corporation>("corporations");

  for (const targetCorp of heldStakes) {
    const shareholderEntry = targetCorp.shareholders?.find((shareholder) =>
      shareholder.corporationId?.equals(seizedCorp._id)
    );
    if (!shareholderEntry || shareholderEntry.shares <= 0) continue;

    const shares = shareholderEntry.shares;
    await corps.updateOne(
      { _id: targetCorp._id },
      {
        $pull: { shareholders: { corporationId: seizedCorp._id } },
        $set: { updatedAt: now },
      }
    );

    const existingEntry = targetCorp.shareholders?.find((shareholder) =>
      shareholder.corporationId?.equals(nationalCorpId)
    );
    if (existingEntry) {
      const combinedShares = existingEntry.shares + shares;
      const combinedAvgCost =
        combinedShares > 0
          ? (existingEntry.shares * (existingEntry.avgCostPerShare ?? 0) +
              shares * (shareholderEntry.avgCostPerShare ?? 0)) /
            combinedShares
          : 0;
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $set: {
            "shareholders.$[elem].shares": combinedShares,
            "shareholders.$[elem].avgCostPerShare": combinedAvgCost,
            updatedAt: now,
          },
        },
        { arrayFilters: [{ "elem.corporationId": nationalCorpId }] }
      );
      continue;
    }

    await corps.updateOne(
      { _id: targetCorp._id },
      {
        $push: {
          shareholders: {
            corporationId: nationalCorpId,
            shares,
            avgCostPerShare: shareholderEntry.avgCostPerShare,
          },
        },
        $set: { updatedAt: now },
      }
    );
  }
}
