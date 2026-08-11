/**
 * One-time backfill: create portfolioHistory entries from corporationHistory.
 * Uses CURRENT shareholdings × historical share prices (approximate).
 *
 * Usage: npx tsx scripts/backfillPortfolioHistory.ts
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // 1. Get current shareholdings across all corporations
  const corporations = await db
    .collection("corporations")
    .find({ "shareholders.0": { $exists: true } })
    .project({ shareholders: 1 })
    .toArray();

  // Build map: corpId -> [{ characterId, shares }]
  const corpShareholdings = new Map<string, { characterId: string; shares: number }[]>();
  const allCharIds = new Set<string>();

  for (const corp of corporations) {
    const holdings = corp.shareholders.map((s: { characterId: ObjectId; shares: number }) => ({
      characterId: s.characterId.toString(),
      shares: s.shares,
    }));
    corpShareholdings.set(corp._id.toString(), holdings);
    holdings.forEach((h: { characterId: string }) => allCharIds.add(h.characterId));
  }

  console.log(
    `Found ${corporations.length} corporations with shareholders (${allCharIds.size} unique characters)`
  );

  // 2. Get all corporation history grouped by turn
  const historyEntries = await db
    .collection("corporationHistory")
    .find({})
    .sort({ turn: 1 })
    .project({ corporationId: 1, turn: 1, sharePrice: 1 })
    .toArray();

  // Group by turn: Map<turn, Map<corpId, sharePrice>>
  const turnPrices = new Map<number, Map<string, number>>();
  for (const entry of historyEntries) {
    const turn = entry.turn;
    if (!turnPrices.has(turn)) turnPrices.set(turn, new Map());
    turnPrices.get(turn)!.set(entry.corporationId.toString(), entry.sharePrice);
  }

  console.log(`Found ${turnPrices.size} turns of history`);

  // 3. Clear existing portfolio history (idempotent re-run)
  const deleted = await db.collection("portfolioHistory").deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing portfolioHistory docs`);

  // 4. For each turn, compute portfolio value per character
  const docs: {
    characterId: ObjectId;
    turn: number;
    totalValue: number;
    createdAt: Date;
  }[] = [];

  const now = new Date();

  for (const [turn, prices] of turnPrices) {
    const charValues = new Map<string, number>();

    for (const [corpId, holdings] of corpShareholdings) {
      const price = prices.get(corpId);
      if (price === undefined) continue;

      for (const h of holdings) {
        charValues.set(h.characterId, (charValues.get(h.characterId) ?? 0) + h.shares * price);
      }
    }

    for (const [charId, totalValue] of charValues) {
      docs.push({
        characterId: new ObjectId(charId),
        turn,
        totalValue: Math.round(totalValue * 100) / 100,
        createdAt: now,
      });
    }
  }

  console.log(`Inserting ${docs.length} portfolio history documents...`);

  if (docs.length > 0) {
    const BATCH = 1000;
    for (let i = 0; i < docs.length; i += BATCH) {
      await db.collection("portfolioHistory").insertMany(docs.slice(i, i + BATCH));
      process.stdout.write(`\r  Inserted ${Math.min(i + BATCH, docs.length)} / ${docs.length}`);
    }
    console.log("\nDone!");
  } else {
    console.log("No documents to insert.");
  }

  // 5. Create indexes
  await db
    .collection("portfolioHistory")
    .createIndex({ characterId: 1, turn: 1 }, { unique: true });
  console.log("Created index on { characterId, turn }");

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
