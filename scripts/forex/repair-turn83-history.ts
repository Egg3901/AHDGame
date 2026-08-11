/**
 * One-shot repair: drop corrupt turn-83 history snapshots and recompute each
 * corporation's current `sharePrice` using the fixed currency-coherent formula.
 *
 * Context:
 *   The forex migration (`migrateCorporationLiquidCapital`) ran at turn 83,
 *   multiplying every JP/UK/DE corp's `liquidCapital` into its home currency.
 *   A bug in the share-price and balance-sheet code (committed separately)
 *   then mixed that local-currency value with ₳-denominated income/NPV terms,
 *   producing corrupt turn-83 snapshots across several history collections.
 *
 *   After the code fix, future turns will write correct snapshots, but the
 *   existing turn-83 docs remain polluted.
 *
 * Repair strategy (option A + recompute-current-sharePrice):
 *   1. Delete every turn-83 snapshot in the history collections listed below.
 *      Charts will show a one-turn gap; next turn processing fills it.
 *   2. Recompute `corporation.sharePrice` now using the fixed formula, seeded
 *      from the turn-82 snapshot's `income` + `sectorNPV` (both in ₳) plus
 *      the corp's live post-migration `liquidCapital` (in home currency).
 *      Prev-price momentum uses turn-82 sharePrice (₳) promoted × localFx.
 *
 * Idempotent: re-runs no-op on history (already deleted) and re-converge on
 * sharePrice (formula is pure).
 *
 * Run: npx tsx scripts/forex/repair-turn83-history.ts [--dry-run]
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_NAME = "a-house-divided";
const DRY_RUN = process.argv.includes("--dry-run");
const CORRUPT_TURN = 83;

// Mirror src/lib/constants/corporations.ts — keep in sync if values change.
const NPV_ANNUAL_DISCOUNT_RATE = 0.25;
const SHARE_PRICE_PE_MULTIPLE = 6;
const INCOME_PRICE_CAP_MULTIPLE = 4;
const MIN_SHARE_PRICE = 0.01;
const TURNS_PER_YEAR = 48;
void NPV_ANNUAL_DISCOUNT_RATE; // stored-NPV is authoritative; not recomputed here

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
  liquidCapital: number;
  liquidCurrencyCode?: string;
  sharePrice?: number;
  totalShares?: number;
};
type HistDoc = {
  corporationId: ObjectId;
  turn: number;
  sharePrice?: number;
  income?: number;
  sectorNPV?: number;
};
type RateDoc = { currencyCode: string; rate: number };

function recomputeSharePrice(args: {
  liquidCapitalLocal: number;
  incomeAnchor: number;
  sectorNPVAnchor: number;
  totalShares: number;
  prevPriceAnchor: number;
  localFx: number;
}): number {
  const {
    liquidCapitalLocal,
    incomeAnchor,
    sectorNPVAnchor,
    totalShares,
    prevPriceAnchor,
    localFx,
  } = args;
  const prevPriceLocal = prevPriceAnchor * localFx;
  const balanceSheetEquity = liquidCapitalLocal + (incomeAnchor + sectorNPVAnchor) * localFx;
  const balanceSheetPrice = totalShares > 0 ? balanceSheetEquity / totalShares : 0;
  const annualIncomeLocal = incomeAnchor * TURNS_PER_YEAR * localFx;
  const rawIncomePrice =
    totalShares > 0 ? (annualIncomeLocal / totalShares) * SHARE_PRICE_PE_MULTIPLE : 0;
  const incomePrice = Math.min(
    Math.max(0, rawIncomePrice),
    Math.max(0, balanceSheetPrice) * INCOME_PRICE_CAP_MULTIPLE
  );
  const newPrice = Math.max(
    MIN_SHARE_PRICE,
    0.15 * prevPriceLocal + 0.6 * Math.max(0, balanceSheetPrice) + 0.25 * incomePrice
  );
  return Math.round(newPrice * 100) / 100;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`Dry run: ${DRY_RUN}  |  Corrupt turn: ${CORRUPT_TURN}\n`);

    // ── Phase 1: delete corrupt turn-83 snapshots ────────────────────────────
    console.log("— Phase 1: purge turn-83 history snapshots —");
    for (const coll of HISTORY_COLLECTIONS) {
      const n = await db.collection(coll).countDocuments({ turn: CORRUPT_TURN });
      if (n === 0) {
        console.log(`  ${coll}: 0 docs (already clean)`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  ${coll}: would delete ${n} docs`);
      } else {
        const res = await db.collection(coll).deleteMany({ turn: CORRUPT_TURN });
        console.log(`  ${coll}: deleted ${res.deletedCount} docs`);
      }
    }

    // ── Phase 2: recompute corp.sharePrice ───────────────────────────────────
    console.log("\n— Phase 2: recompute corporation.sharePrice —");

    const rates = (await db
      .collection<RateDoc>("exchangeRates")
      .find({})
      .toArray()) as unknown as RateDoc[];
    const fxByCode = new Map(rates.map((r) => [r.currencyCode, r.rate]));
    fxByCode.set("USD", fxByCode.get("USD") ?? 1.0);

    const corps = (await db
      .collection<CorpDoc>("corporations")
      .find({})
      .toArray()) as unknown as CorpDoc[];

    let changedCount = 0;
    const ops: {
      updateOne: {
        filter: { _id: ObjectId };
        update: { $set: { sharePrice: number; updatedAt: Date } };
      };
    }[] = [];

    for (const corp of corps) {
      if (!corp.totalShares || corp.totalShares <= 0) continue;
      const currency = COUNTRY_CURRENCY_MAP[corp.countryId] ?? "USD";
      const localFx = fxByCode.get(currency) ?? 1.0;

      // Seed from turn-82 snapshot (last pre-migration clean record).
      const seed = (await db
        .collection<HistDoc>("corporationHistory")
        .findOne(
          { corporationId: corp._id, turn: { $lte: CORRUPT_TURN - 1 } },
          { sort: { turn: -1 } }
        )) as HistDoc | null;

      if (!seed) continue; // No history → skip; next turn will compute fresh.

      const newPrice = recomputeSharePrice({
        liquidCapitalLocal: corp.liquidCapital,
        incomeAnchor: seed.income ?? 0,
        sectorNPVAnchor: seed.sectorNPV ?? 0,
        totalShares: corp.totalShares,
        prevPriceAnchor: seed.sharePrice ?? MIN_SHARE_PRICE,
        localFx,
      });

      const oldPrice = corp.sharePrice ?? MIN_SHARE_PRICE;
      if (Math.abs(newPrice - oldPrice) > 0.01) {
        changedCount++;
        ops.push({
          updateOne: {
            filter: { _id: corp._id },
            update: { $set: { sharePrice: newPrice, updatedAt: new Date() } },
          },
        });
        console.log(
          `  ${corp.countryId} ${corp.name}: ${oldPrice.toFixed(2)} → ${newPrice.toFixed(2)} ${currency}`
        );
      }
    }

    if (DRY_RUN) {
      console.log(`\n${changedCount} corps would be updated (dry run, no writes).`);
      return;
    }
    if (ops.length === 0) {
      console.log("\nNo sharePrice changes needed.");
      return;
    }
    const res = await db
      .collection("corporations")
      .bulkWrite(ops as unknown as Parameters<ReturnType<typeof db.collection>["bulkWrite"]>[0]);
    console.log(`\nWrote ${res.modifiedCount} sharePrice updates.`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
