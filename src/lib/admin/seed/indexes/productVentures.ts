import type { Db } from "mongodb";
import {
  PRODUCT_VENTURES,
  PRODUCT_VENTURE_ACTIVE_INDEX,
  PRODUCT_VENTURE_CORPORATION_INDEX,
  PRODUCT_VENTURE_STAGE_INDEX,
} from "@/lib/products/venture/store";
import { ensureIndex } from "./helpers";

/**
 * Product ventures: one venture in development per corporation and domain
 * (UNIQUE partial index on activeKey), the studio's per-corporation read, and
 * the turn processor's stage and last-processed scan. Names match
 * ensureProductVentureIndexes so the startup migration and a fresh seed agree.
 */
export async function seedProductVentureIndexes(db: Db, log: (msg: string) => void) {
  log("Product venture indexes:");
  await ensureIndex(
    db,
    PRODUCT_VENTURES,
    { activeKey: 1 },
    {
      name: PRODUCT_VENTURE_ACTIVE_INDEX,
      unique: true,
      partialFilterExpression: { activeKey: { $type: "string" } },
    },
    log
  );
  await ensureIndex(
    db,
    PRODUCT_VENTURES,
    { corporationId: 1, stage: 1 },
    { name: PRODUCT_VENTURE_CORPORATION_INDEX },
    log
  );
  await ensureIndex(
    db,
    PRODUCT_VENTURES,
    { stage: 1, lastProcessedTurn: 1 },
    { name: PRODUCT_VENTURE_STAGE_INDEX },
    log
  );
  log("Product venture indexes ensured");
}
