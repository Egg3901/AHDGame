/**
 * Repair characters whose personal balance was migrated to forex without
 * applying the home-currency FX conversion.
 *
 * Context:
 *   The original migrateCharacterBalances() copied character.cashOnHand
 *   (internal units, USD-equivalent) literally into
 *   currencyBalances.personal.<homeCurrency>. For non-USD home currencies
 *   this under- or over-credited players:
 *
 *       US (rate 1.00)  → correct
 *       UK (rate 0.75)  → received  1.33×  too much (or: missing a -25% adj)
 *       JP (rate 106)   → received  1/106× the correct amount
 *
 *   The parallel migrateCorporationLiquidCapital() applied the ×rate
 *   conversion correctly. This script closes the gap for characters.
 *
 * Strategy:
 *   delta = cashOnHand × (INITIAL_RATES[countryId] − 1)
 *   $inc { "currencyBalances.personal.<homeCurrency>": delta }
 *   $set { forexMigrationFxRepaired: true }  ← idempotency flag
 *
 *   cashOnHand is preserved by the original migration (it is inert post-
 *   migration), so re-reading it is safe. Post-migration trading activity
 *   only touches currencyBalances.personal, so adding the delta corrects
 *   the starting balance without disturbing subsequent gameplay.
 *
 *   US characters get no write (delta = 0) and are marked repaired so
 *   a re-run is a no-op.
 *
 * Run:   npx tsx scripts/forex/repair-character-migration-fx.ts [--dry-run]
 * Auth:  reads MONGODB_URI from .env.local
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  type CurrencyCode,
} from "../../src/lib/constants/currencies";
import type { CountryId } from "../../src/lib/constants/countries";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_NAME = "a-house-divided";
const DRY_RUN = process.argv.includes("--dry-run");

interface CharacterDoc {
  _id: ObjectId;
  countryId: CountryId;
  cashOnHand?: number;
  currencyBalances?: {
    campaign?: number;
    personal?: Partial<Record<CurrencyCode, number>>;
  };
  forexMigrationFxRepaired?: boolean;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const col = db.collection<CharacterDoc>("characters");

    const cursor = col.find({
      currencyBalances: { $exists: true },
      forexMigrationFxRepaired: { $ne: true },
    });

    let touched = 0;
    let skipped = 0;
    const perCountry: Record<string, { count: number; totalDelta: number }> = {};

    for await (const doc of cursor) {
      const countryId = doc.countryId;
      const homeCurrency = COUNTRY_CURRENCY_MAP[countryId];
      const rate = INITIAL_RATES[countryId];
      if (!homeCurrency || rate === undefined) {
        skipped++;
        continue;
      }

      const cashOnHand = doc.cashOnHand ?? 0;
      const delta = cashOnHand * (rate - 1);
      const bucket = (perCountry[countryId] ??= { count: 0, totalDelta: 0 });
      bucket.count++;
      bucket.totalDelta += delta;

      if (DRY_RUN) {
        touched++;
        continue;
      }

      const update: Record<string, unknown> = {
        $set: { forexMigrationFxRepaired: true, updatedAt: new Date() },
      };
      if (delta !== 0) {
        update.$inc = { [`currencyBalances.personal.${homeCurrency}`]: delta };
      }
      await col.updateOne({ _id: doc._id }, update);
      touched++;
    }

    console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Forex migration FX repair complete.`);
    console.log(`  Characters touched: ${touched}`);
    console.log(`  Characters skipped: ${skipped}`);
    for (const [countryId, { count, totalDelta }] of Object.entries(perCountry)) {
      const currency = COUNTRY_CURRENCY_MAP[countryId as CountryId];
      console.log(
        `  ${countryId} (${currency}): ${count} characters, total delta ${totalDelta.toLocaleString()} ${currency}`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
