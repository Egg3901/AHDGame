/**
 * Migration: Transform MarketCapHistory from named fields to exchangeCaps record.
 *
 * Reads: nyseMarketCap/nyseHigh/nyseLow + ftseMarketCap/ftseHigh/ftseLow
 * Writes: exchangeCaps: { nyse: { marketCap, high, low }, ftse: { marketCap, high, low } }
 *
 * Also updates stockExchangeListings where exchange was "NYSE"/"FTSE" to use
 * the config-driven exchange name (should already match after turn processing).
 *
 * Run with: npx tsx scripts/migrations/migrate-market-cap-history.ts
 */
import { connectDb, closeDb } from "../utils/db";

async function main() {
  const db = await connectDb();

  // 1. Migrate marketCapHistory documents
  const historyCol = db.collection("marketCapHistory");
  const docs = await historyCol.find({ exchangeCaps: { $exists: false } }).toArray();
  console.log(`Found ${docs.length} marketCapHistory docs to migrate`);

  let migrated = 0;
  for (const doc of docs) {
    const exchangeCaps: Record<string, { marketCap: number; high: number; low: number }> = {};

    if (doc.nyseMarketCap != null) {
      exchangeCaps.nyse = {
        marketCap: doc.nyseMarketCap,
        high: doc.nyseHigh ?? doc.nyseMarketCap,
        low: doc.nyseLow ?? doc.nyseMarketCap,
      };
    }
    if (doc.ftseMarketCap != null) {
      exchangeCaps.ftse = {
        marketCap: doc.ftseMarketCap,
        high: doc.ftseHigh ?? doc.ftseMarketCap,
        low: doc.ftseLow ?? doc.ftseMarketCap,
      };
    }

    await historyCol.updateOne({ _id: doc._id }, { $set: { exchangeCaps } });
    migrated++;
  }
  console.log(`Migrated ${migrated} marketCapHistory documents`);

  await closeDb();
}

main().catch(console.error);
