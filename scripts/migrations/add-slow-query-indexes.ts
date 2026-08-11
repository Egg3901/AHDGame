/**
 * Migration: Add indexes for slow-query COLLSCAN offenders
 *
 * Identified via MongoDB Profiler export (2026-04-07). These collections had
 * no indexes on their hot read paths and were doing full collection scans:
 *
 * - corporationHistory: stock exchange snapshots, bonds page, market cap snapshot (24x, ~24K docs each)
 * - commodityPriceHistory: commodity list/detail pages (23x, ~8.5K docs each)
 * - actionLogs: achievement triggers, action dedup checks (1x, ~25.6K docs)
 * - statePartyElections: party election validation (1x, ~18.6K docs)
 */

import { connectDb, closeDb } from "../utils/db";

async function migrate() {
  console.log("Adding slow-query indexes...\n");
  const db = await connectDb();

  const results: string[] = [];

  async function ensure(collection: string, key: Record<string, 1 | -1>, name: string) {
    try {
      await db.collection(collection).createIndex(key, { name });
      results.push(`\u2713 ${collection}.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= ${collection}.${name} (already exists)`);
      } else {
        results.push(`\u2717 ${collection}.${name}: ${msg}`);
      }
    }
  }

  // corporationHistory — aggregate $match(corporationId $in) + $sort(turn -1) + $group
  // Used by: stockExchangeSnapshot, marketCapSnapshot, bonds route, discord-bot stock chart
  await ensure("corporationHistory", { corporationId: 1, turn: -1 }, "ch_corporationId_turn");

  // commodityPriceHistory — aggregate $match(turn $lte) + $sort(commodity, turn -1) + $group
  // Also: find({ commodity }) .sort({ turn: -1 }) on the detail page
  await ensure("commodityPriceHistory", { commodity: 1, turn: -1 }, "cph_commodity_turn");

  // actionLogs — aggregate $match(characterId, actionType) + $group(count)
  // Used by: achievement triggers, action polling dedup
  await ensure("actionLogs", { characterId: 1, actionType: 1 }, "al_characterId_actionType");

  // statePartyElections — findOne({ stateId, partyId, position, status })
  // Used by: statePartyElectionValidation, election entry routes
  await ensure(
    "statePartyElections",
    { stateId: 1, partyId: 1, status: 1 },
    "spe_stateId_partyId_status"
  );

  await closeDb();

  console.log("Results:");
  results.forEach((r) => console.log(" ", r));
  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
