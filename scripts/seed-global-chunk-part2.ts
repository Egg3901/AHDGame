/**
 * Global seed part 2 — starts from initializeGameState.
 * Run: npx tsx scripts/seed-global-chunk-part2.ts
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URI = process.env.MONGODB_URI;
if (!URI) throw new Error("MONGODB_URI not set in .env.local");

function log(msg: string) {
  console.log(`[global2] ${msg}`);
}

async function run() {
  const client = new MongoClient(URI!);
  await client.connect();
  const db = client.db();
  log("Connected to MongoDB");

  // 1. Game state + forex
  {
    const { initializeGameState } = await import("@/lib/turnSystem");
    const gameState = await initializeGameState();
    log(`Game state ready at turn ${gameState.currentTurn}`);

    const { seedForex } = await import("@/lib/admin/seed/seedForex");
    await seedForex(db, log);
  }

  // 2. Historical officials (only if empty)
  {
    const [officialsCount, nppsCount] = await Promise.all([
      db.collection("electedOfficials").countDocuments(),
      db.collection("npps").countDocuments({ retiredAt: null }),
    ]);

    if (officialsCount === 0 && nppsCount === 0) {
      const { seedHistoricalOfficials } = await import("@/lib/npp/seedHistorical");
      const result = await seedHistoricalOfficials(db, "2020-default");
      log(`Seeded ${result.officialsCreated} officials, ${result.nppsCreated} NPPs`);
    } else {
      log(`Skipped officials (${officialsCount} officials, ${nppsCount} NPPs exist)`);
    }
  }

  // 3. Elections
  {
    const now = new Date();
    const { ensurePerpetualElections, ensureUKElections } = await import("@/lib/turnSystem");
    const {
      ensureJPElections,
      ensureDEElections,
      ensureUKRegionalCouncilElections,
      DEFAULT_DURATIONS,
    } = await import("@/lib/turn/perpetualElections");
    await ensurePerpetualElections(now, 1);
    await ensureUKElections(now);
    await ensureJPElections(now);
    await ensureDEElections(now);
    log("Elections ensured");

    // JP Sangiin
    const { JP_SANGIIN_SEATS } = await import("@/lib/constants/states");
    const { JP_SANGIIN_CYCLE1_END_TURN, MS_PER_TURN } = await import("@/lib/constants/turnTime");
    const jpRegions = await db
      .collection("states")
      .find({ countryId: "JP" }, { projection: { _id: 1 } })
      .toArray();
    const sangiinDur = DEFAULT_DURATIONS.sangiin;
    const toInsert: any[] = [];

    for (const region of jpRegions) {
      const regionId = String(region._id);
      const totalRegionSeats = JP_SANGIIN_SEATS[regionId] ?? 2;
      const classSeats = Math.ceil(totalRegionSeats / 2);

      for (const chamberClass of [1, 2] as const) {
        const existing = await db.collection("elections").findOne({
          electionType: "sangiin",
          countryId: "JP",
          chamberClass,
          state: regionId,
          status: { $in: ["active", "upcoming"] },
        });
        if (existing) continue;
        const endTurn = JP_SANGIIN_CYCLE1_END_TURN[chamberClass] ?? 123;
        const endTime = new Date(now.getTime() + endTurn * MS_PER_TURN);
        const primaryEndTime = new Date(endTime.getTime() - sangiinDur.primary * MS_PER_TURN);
        toInsert.push({
          electionType: "sangiin",
          countryId: "JP",
          state: regionId,
          chamberClass,
          status: "upcoming",
          totalSeats: classSeats,
          seatsToFill: classSeats,
          startTime: now,
          endTime,
          primaryStartTime: now,
          primaryEndTime,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (toInsert.length > 0) {
      await db.collection("elections").insertMany(toInsert);
      log(`Created ${toInsert.length} Sangiin elections`);
    }

    // UK regional councils
    const ukRegions = await db
      .collection("states")
      .find({ countryId: "UK" }, { projection: { _id: 1 } })
      .toArray();
    for (const region of ukRegions) {
      await ensureUKRegionalCouncilElections(String(region._id), now);
    }
    log("UK regional council elections ensured");
  }

  await client.close();
  log("✅ Global chunk part 2 complete");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
