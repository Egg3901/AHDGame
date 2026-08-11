/**
 * One-time migration: set bills.countryId from resolveBillCountryId for documents missing it.
 *
 * Run: npx tsx scripts/migrations/backfill-bill-country-id.ts
 * Requires MONGODB_URI in .env.local
 */
import { connectDb, closeDb } from "../utils/db";
import { resolveBillCountryId } from "../../src/lib/congress/resolveBillCountryId";
import type { Bill } from "../../src/lib/db/types";

async function main() {
  const db = await connectDb();
  const bills = db.collection<Bill>("bills");
  const cursor = bills.find({ countryId: { $exists: false } });
  let updated = 0;
  for await (const bill of cursor) {
    const countryId = await resolveBillCountryId(db, bill);
    await bills.updateOne({ _id: bill._id }, { $set: { countryId, updatedAt: new Date() } });
    updated++;
    if (updated % 500 === 0) console.log(`… ${updated} bills`);
  }
  console.log(`Done. Updated ${updated} bill(s).`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
