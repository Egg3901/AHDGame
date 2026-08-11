import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Unique index on `commodityPrices.commodity` — absorbs
 * `scripts/migrations/deprecated/add-commodity-prices-unique-index.ts`.
 *
 * The runtime path treats each commodity as a singleton row keyed by name; the
 * unique index is the only race-free guard against a duplicate insert from two
 * concurrent admin updates or seeders.
 */
export async function seedCommodityPriceIndexes(db: Db, log: (msg: string) => void) {
  log("Commodity price indexes:");

  await ensureIndex(
    db,
    "commodityPrices",
    { commodity: 1 },
    { name: "commodityPrices_commodity_unique", unique: true },
    log
  );

  // One trade-flow snapshot per turn; the ledger surface reads the latest by
  // descending turn. Unique guards against a duplicate upsert on cron retry.
  await ensureIndex(
    db,
    "tradeFlowSnapshots",
    { turn: -1 },
    { name: "tradeFlowSnapshots_turn_unique", unique: true },
    log
  );

  // One ministerial-embargo cooldown row per directed source→target pair. The
  // unique index is what makes the conditional-upsert cooldown gate in
  // `imposeEmbargo` race-free against two concurrent imposes on the same target.
  await ensureIndex(
    db,
    "embargoCooldowns",
    { sourceCountry: 1, targetCountry: 1 },
    { name: "embargoCooldowns_pair_unique", unique: true },
    log
  );

  log("Commodity price indexes ensured");
}
