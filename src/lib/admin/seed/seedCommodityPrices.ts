import type { Db } from "mongodb";
import { getEraCommodityBasePrice } from "@/lib/constants/sectorSeedEra";
import {
  COMMODITY_BASE_PRICES,
  COMMODITY_TYPES,
  type CommodityType,
} from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

/**
 * Seed baseline `commodityPrices` rows — one per `CommodityType` — at their
 * configured base price.
 *
 * Why this exists: pre-Phase-6, `commodityPrices` rows were only created by
 * `commodityPriceTurn.ts` on the first turn that produced supply/demand for a
 * given commodity. That meant a freshly-bootstrapped world had an empty
 * `commodityPrices` collection until turns started running, and any code that
 * read prices before the first turn (admin dashboards, the commodity map,
 * starting-state seeders for corp production) saw nothing. Seeding the baseline
 * row on bootstrap makes "current price" available from turn 0.
 *
 * Price history (`commodityPriceHistory`) stays runtime — it accumulates a
 * snapshot per turn and is wiped on reset.
 *
 * `reset: true` drops the collection first so removed commodities clean up;
 * the unique index on `commodity` (see indexes/commodityPrices.ts) protects
 * against re-insert races.
 */
export async function seedCommodityPrices(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
): Promise<void> {
  log("Seeding baseline commodity prices:");

  if (reset) {
    const dropped = await db.collection("commodityPrices").deleteMany({});
    if (dropped.deletedCount > 0) {
      log(`  ~ commodityPrices: dropped ${dropped.deletedCount} legacy rows`);
    }
  }

  const now = new Date();
  let inserted = 0;
  let alreadyPresent = 0;

  for (const commodity of COMMODITY_TYPES as readonly CommodityType[]) {
    // Era-scaled: a 1953 world must not be seeded with 2019 unit prices. No-op
    // for every era without a nominal-scale entry.
    const basePrice = getEraCommodityBasePrice(COMMODITY_BASE_PRICES[commodity], preset);
    const seed: CommodityPrice = {
      commodity,
      basePrice,
      globalPrice: basePrice,
      globalSupply: 0,
      globalDemand: 0,
      statePrices: {},
      stateSupply: {},
      stateDemand: {},
      nationalPrices: {},
      nationalSupply: {},
      nationalDemand: {},
      turn: 0,
      updatedAt: now,
    };

    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity }, { $setOnInsert: seed }, { upsert: true });
    if (result.upsertedCount > 0) {
      inserted += 1;
    } else {
      alreadyPresent += 1;
    }
  }

  log(
    `  ✓ commodityPrices: ${inserted} new, ${alreadyPresent} already present (${COMMODITY_TYPES.length} total)`
  );
}
