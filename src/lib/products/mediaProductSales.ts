/**
 * The database shell persists pure title-delivery results exactly once.
 * Rule construction and attribution live in `rules/mediaProductSales`.
 */
import type { Db } from "mongodb";
import type { MediaProductProject } from "./mediaProduct";
import type { MediaProductDeliveryAttribution } from "./rules/mediaProductSales";

export {
  attributeMediaProductSales,
  mediaProductOfferAvailability,
  paidPoliticalMediaSellerReceipts,
  reconcileMediaProductDelivery,
} from "./rules/mediaProductSales";
export type {
  MediaProductDeliveryAttribution,
  PaidPoliticalMediaSellerAmount,
  PaidPoliticalMediaSellerReceipt,
} from "./rules/mediaProductSales";

/** Persist each turn's attributed units once; the sector cash ledger remains authoritative. */
export async function persistMediaProductSales(
  db: Db,
  attributions: readonly MediaProductDeliveryAttribution[]
): Promise<void> {
  if (attributions.length === 0) return;
  const operations = attributions.map((attribution) => {
    const increment: Record<string, number> = {};
    for (const [commodity, amount] of Object.entries(attribution.deliveredUnitsByCommodity)) {
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
        increment[`lifetimeDeliveredUnitsByCommodity.${commodity}`] = amount;
      }
    }
    for (const [commodity, amount] of Object.entries(
      attribution.deliveredRevenueAnchorByCommodity
    )) {
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
        increment[`lifetimeDeliveredRevenueAnchorByCommodity.${commodity}`] = amount;
      }
    }
    return {
      updateOne: {
        filter: {
          _id: attribution.projectId,
          corporationId: attribution.corporationId,
          $or: [
            { lastDeliveredOutputTurn: { $exists: false } },
            { lastDeliveredOutputTurn: { $lt: attribution.turn } },
          ],
        },
        update: {
          $set: {
            lastDeliveredOutputTurn: attribution.turn,
            lastTurnDeliveredUnitsByCommodity: attribution.deliveredUnitsByCommodity,
            lastTurnDeliveredRevenueAnchorByCommodity:
              attribution.deliveredRevenueAnchorByCommodity,
          },
          ...(Object.keys(increment).length > 0 ? { $inc: increment } : {}),
        },
      },
    };
  });
  await db.collection<MediaProductProject>("mediaProductProjectsV1").bulkWrite(operations, {
    ordered: false,
  });
}
