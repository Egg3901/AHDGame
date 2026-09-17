import type { Migration } from "../types";
/** Non-binding supply offers start empty; no existing contracts are rewritten. */
export const migration: Migration = {
  id: "2026-09-17-supply-listing-indexes",
  description: "Index the public supply offer board and publisher slots. No backfill.",
  idempotent: true,
  async execute(db, ctx) {
    if (ctx.dryRun) return { notes: ["Would create supply listing board and publisher indexes."] };
    const listings = db.collection("supplyListings");
    await listings.createIndex(
      { commodity: 1, updatedAt: -1, _id: 1, expiresAtTurn: 1 },
      { name: "supply_listing_commodity" }
    );
    await listings.createIndex(
      { updatedAt: -1, _id: 1, expiresAtTurn: 1 },
      { name: "supply_listing_board" }
    );
    await listings.createIndex(
      { corporationId: 1, expiresAtTurn: 1 },
      { name: "supply_listing_publisher" }
    );
    return { notes: ["Created or verified supply listing indexes."] };
  },
};
