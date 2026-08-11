/**
 * One-time migration: rewrite JP Sangiin election seatIds to include chamberClass.
 *
 * Before this migration both Class 1 and Class 2 elections in the same region
 * shared `JP-sangiin-{state}`, which collapsed them onto the same URL and
 * confused prev/next navigation. After: `JP-sangiin-{state}-{class}`.
 *
 * Also seeds the missing per-class Seat docs in the `seats` collection so
 * lookups by seatId resolve to the right Seat record.
 *
 * Run: npx tsx scripts/migrations/backfill-jp-sangiin-seat-ids.ts
 * Requires MONGODB_URI in .env.local
 */
import { connectDb, closeDb } from "../utils/db";
import { buildSeatId } from "../../src/lib/seats/seatId";
import type { Election, Seat } from "../../src/lib/db/types";
import { JP_SANGIIN_SEATS } from "../../src/lib/constants/states";
import { JP_REGIONS } from "../../src/lib/constants/japan";

const JP_REGION_NAMES: Record<string, string> = Object.fromEntries(
  JP_REGIONS.map((r) => [r.id, r.name])
);

async function main() {
  const db = await connectDb();
  const elections = db.collection<Election>("elections");
  const seats = db.collection<Seat>("seats");
  const now = new Date();

  // ── 1. Backfill election seatIds ────────────────────────────────────────────
  const cursor = elections.find({
    countryId: "JP",
    electionType: "sangiin",
    chamberClass: { $in: [1, 2] },
  });

  let electionsUpdated = 0;
  let electionsSkipped = 0;
  for await (const election of cursor) {
    if (election.chamberClass == null) {
      electionsSkipped++;
      continue;
    }
    const expected = buildSeatId("JP", "sangiin", election.state, election.chamberClass as 1 | 2);
    if (election.seatId === expected) {
      electionsSkipped++;
      continue;
    }
    await elections.updateOne(
      { _id: election._id },
      { $set: { seatId: expected, updatedAt: now } }
    );
    electionsUpdated++;
  }
  console.log(`Elections: updated ${electionsUpdated}, skipped ${electionsSkipped}`);

  // ── 2. Replace flat Seat docs with per-class versions ──────────────────────
  // Old format: _id="JP-sangiin-{region}" (no chamberClass field).
  // New format: _id="JP-sangiin-{region}-{1|2}" with chamberClass set.
  let seatsCreated = 0;
  let seatsRemoved = 0;
  for (const regionId of Object.keys(JP_SANGIIN_SEATS)) {
    const totalSeats = JP_SANGIIN_SEATS[regionId];
    const seatsByClass: Record<1 | 2, number> = {
      1: Math.ceil(totalSeats / 2),
      2: Math.floor(totalSeats / 2),
    };
    for (const cls of [1, 2] as const) {
      const newId = buildSeatId("JP", "sangiin", regionId, cls);
      const exists = await seats.findOne({ _id: newId });
      if (exists) continue;
      const regionName = JP_REGION_NAMES[regionId] ?? regionId;
      await seats.insertOne({
        _id: newId,
        countryId: "JP",
        electionType: "sangiin",
        state: regionId,
        chamberClass: cls,
        totalSeats: seatsByClass[cls],
        displayName: `${regionName} Sangiin (Class ${cls})`,
        shortName: `${regionId} San-${cls}`,
        createdAt: now,
        updatedAt: now,
      });
      seatsCreated++;
    }
    // Drop the legacy flat seat record now that per-class records exist.
    const legacyId = `JP-sangiin-${regionId}`;
    const legacy = await seats.findOne({ _id: legacyId });
    if (legacy && legacy.chamberClass == null) {
      await seats.deleteOne({ _id: legacyId });
      seatsRemoved++;
    }
  }
  console.log(`Seats: created ${seatsCreated}, removed ${seatsRemoved} legacy flat seat(s)`);

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
