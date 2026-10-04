/**
 * Nationalization preserves the seized corporation's holdings in other corporations.
 * heldStakeValueAnchor values the holdings; transferOwnedSharesToNatCorp moves
 * their shares to the National Corporation without a second cash payout.
 */
import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";

/** One corporation the seized corporation holds shares in, as read for the taking. */
type HeldStake = Pick<
  Corporation,
  "_id" | "shareholders" | "sharePrice" | "liquidCurrencyCode" | "countryId"
>;

/** Market value, in ₳, of the shares the seized corporation holds in other corporations. */
export function heldStakeValueAnchor(
  stakes: HeldStake[],
  seizedCorpId: ObjectId,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  let total = 0;
  for (const stake of stakes) {
    const shares =
      stake.shareholders?.find((sh) => sh.corporationId?.equals(seizedCorpId))?.shares ?? 0;
    if (!(shares > 0)) continue;
    total += corpLiquidCapitalToAnchor(
      shares * (stake.sharePrice ?? 0),
      stake,
      fxByCurrency.get(stake.liquidCurrencyCode as CurrencyCode) ?? 1
    );
  }
  return total;
}

/**
 * Transfer shares owned by the seized corporation in other corporations to the
 * National Corporation. When a corporation owns shares in other corporations,
 * those shares must be transferred rather than silently destroyed during
 * dissolution (Bug #0803). They move as shares only: the buyout already paid
 * the seized corporation's holders their market value (#3041), so crediting
 * that value again as cash would create money.
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
    const shareholderEntry = targetCorp.shareholders?.find((sh) =>
      sh.corporationId?.equals(seizedCorp._id)
    );

    if (!shareholderEntry || shareholderEntry.shares <= 0) {
      continue;
    }
    const shares = shareholderEntry.shares;

    // Remove the seized corp's shareholder entry
    await corps.updateOne(
      { _id: targetCorp._id },
      {
        $pull: {
          shareholders: { corporationId: seizedCorp._id },
        },
        $set: { updatedAt: now },
      }
    );

    // Transfer the shares to the National Corporation as a shareholder of the
    // target corporation (not to the NatCorp's own shareholders array).
    const existingEntry = targetCorp.shareholders?.find((sh) =>
      sh.corporationId?.equals(nationalCorpId)
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
    } else {
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $push: {
            shareholders: {
              corporationId: nationalCorpId,
              shares: shares,
              avgCostPerShare: shareholderEntry.avgCostPerShare,
            },
          },
          $set: { updatedAt: now },
        }
      );
    }
  }
}
