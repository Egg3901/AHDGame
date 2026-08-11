/**
 * Convert corporation.sharePrice back to ₳ after an earlier (and incorrect)
 * decision to store it in local currency. Also purge turn-84 history which was
 * written while sharePrice was in local currency.
 *
 * Rationale:
 *   The UI convention throughout the codebase is "unless explicitly tagged, the
 *   number is ₳ (internal units)" — e.g. `fmt()` / `convert()` both multiply the
 *   input by the display FX rate. Storing sharePrice in local currency broke
 *   that contract, producing double-converted display values and catastrophic
 *   priceChange24h deltas that crossed the forex-migration boundary.
 *
 *   The correct fix normalizes `liquidCapital` down to ₳ inside the share-price
 *   formula (already applied in code). This script brings the DB into line.
 *
 * Phases:
 *   1. For every corp with `liquidCurrencyCode` set (post-migration), divide
 *      `sharePrice` by its home-currency FX rate so it's in ₳.
 *   2. Delete the single contaminated history turn (--turn flag, default 84)
 *      from every affected history collection. Charts get a one-turn gap; the
 *      next turn processor run fills it with correct ₳ values.
 *
 * Idempotent-ish: if you re-run Phase 1, sharePrices will be divided again —
 * so check `sharePrice × localFx ≈ expected` before running twice. Phase 2 is
 * a no-op on re-run (history already deleted).
 *
 * Run: npx tsx scripts/forex/restore-sharePrice-to-anchor.ts [--dry-run] [--turn 84]
 */

import { MongoClient, ObjectId, type AnyBulkWriteOperation, type Document } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_NAME = "a-house-divided";
const DRY_RUN = process.argv.includes("--dry-run");
const turnArgIdx = process.argv.indexOf("--turn");
const CONTAMINATED_TURN = turnArgIdx >= 0 ? parseInt(process.argv[turnArgIdx + 1] ?? "84", 10) : 84;

const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  US: "USD",
  UK: "GBP",
  CA: "USD",
  DE: "EUR",
  JP: "JPY",
};

const HISTORY_COLLECTIONS = [
  "corporationHistory",
  "portfolioHistory",
  "corporationPortfolioHistory",
  "marketCapHistory",
  "stockExchangeSnapshots",
  "wealthListSnapshots",
  "wealthListHistory",
  "investorRankingSnapshots",
] as const;

type CorpDoc = {
  _id: ObjectId;
  name: string;
  countryId: string;
  liquidCurrencyCode?: string;
  sharePrice?: number;
  totalShares?: number;
};
type RateDoc = { currencyCode: string; rate: number };

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`Dry run: ${DRY_RUN}  |  Contaminated turn: ${CONTAMINATED_TURN}\n`);

    // ── Phase 1: divide sharePrice by localFx for migrated corps ─────────────
    console.log("— Phase 1: restore sharePrice to ₳ —");

    const rates = (await db
      .collection<RateDoc>("exchangeRates")
      .find({})
      .toArray()) as unknown as RateDoc[];
    const fxByCode = new Map(rates.map((r) => [r.currencyCode, r.rate]));
    fxByCode.set("USD", fxByCode.get("USD") ?? 1.0);

    const corps = (await db
      .collection<CorpDoc>("corporations")
      .find({ liquidCurrencyCode: { $exists: true } })
      .toArray()) as unknown as CorpDoc[];

    const ops: AnyBulkWriteOperation<Document>[] = [];

    for (const corp of corps) {
      if (!corp.sharePrice || corp.sharePrice <= 0) continue;
      const currency = COUNTRY_CURRENCY_MAP[corp.countryId] ?? "USD";
      const fx = fxByCode.get(currency) ?? 1.0;
      if (Math.abs(fx - 1.0) < 1e-4) continue; // USD corps are unchanged

      const newPrice = Math.round((corp.sharePrice / fx) * 100) / 100;
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: { $set: { sharePrice: newPrice, updatedAt: new Date() } },
        },
      });
      console.log(
        `  ${corp.countryId} ${corp.name}: ${corp.sharePrice.toFixed(2)} ${currency} → ${newPrice.toFixed(2)} ₳`
      );
    }

    if (DRY_RUN) {
      console.log(`\n${ops.length} corps would be updated (dry run).`);
    } else if (ops.length > 0) {
      const res = await db.collection("corporations").bulkWrite(ops);
      console.log(`\nWrote ${res.modifiedCount} sharePrice updates.`);
    }

    // ── Phase 2: purge contaminated turn history ─────────────────────────────
    console.log(`\n— Phase 2: purge turn-${CONTAMINATED_TURN} history snapshots —`);
    for (const coll of HISTORY_COLLECTIONS) {
      const n = await db.collection(coll).countDocuments({ turn: CONTAMINATED_TURN });
      if (n === 0) {
        console.log(`  ${coll}: 0 docs (already clean)`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  ${coll}: would delete ${n} docs`);
      } else {
        const res = await db.collection(coll).deleteMany({ turn: CONTAMINATED_TURN });
        console.log(`  ${coll}: deleted ${res.deletedCount} docs`);
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
