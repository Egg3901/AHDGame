/**
 * Persistence helpers for product ventures. A unique partial index holds one
 * venture in development per corporation and domain on standalone Mongo.
 */
import type { Db } from "mongodb";
import type { ProductVenture } from "./types";

export const PRODUCT_VENTURES = "productVentures";
export const PRODUCT_VENTURE_ACTIVE_INDEX =
  "unique_active_product_venture_per_corporation_domain_v1";
export const PRODUCT_VENTURE_CORPORATION_INDEX = "product_venture_corporation_stage_v1";
export const PRODUCT_VENTURE_STAGE_INDEX = "product_venture_stage_processed_v1";

export async function ensureProductVentureIndexes(db: Db): Promise<void> {
  const collection = db.collection(PRODUCT_VENTURES);
  await collection.createIndex(
    { activeKey: 1 },
    {
      name: PRODUCT_VENTURE_ACTIVE_INDEX,
      unique: true,
      partialFilterExpression: { activeKey: { $type: "string" } },
    }
  );
  await collection.createIndex(
    { corporationId: 1, stage: 1 },
    { name: PRODUCT_VENTURE_CORPORATION_INDEX }
  );
  await collection.createIndex(
    { stage: 1, lastProcessedTurn: 1 },
    { name: PRODUCT_VENTURE_STAGE_INDEX }
  );
}

/** Drops undefined keys so an unset activeKey leaves the unique index. */
export function ventureDocument(venture: ProductVenture): Omit<ProductVenture, "_id"> {
  const { _id, ...rest } = venture;
  void _id;
  return Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  ) as Omit<ProductVenture, "_id">;
}
