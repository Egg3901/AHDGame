/**
 * Heal migration: remove duplicate `copper` rows from `commodityPrices` that were
 * created by a bug in `heal-nan-cascade-spread.ts`.
 *
 * ROOT CAUSE:
 *   `heal-nan-cascade-spread.ts` (commit 1d2c3316d, run live at turn 275 on
 *   2026-04-22) tried to restore NaN-contaminated `commodityPrices` rows from
 *   `commodityPriceHistory`, but filtered the lookup on `commodityType` —
 *   `commodityPriceHistory` stores the field as `commodity`. Every filter
 *   effectively became `{commodityType: undefined}` and matched every history
 *   row. The first turn-268 snapshot with a finite `globalPrice` (copper) was
 *   then spread over every NaN-contaminated `commodityPrices` row via
 *   `$set: {...rest, lastUpdated: new Date()}`, overwriting their `commodity`,
 *   `globalPrice`, `nationalPrices`, and supply/demand fields with copper's
 *   data. `basePrice` wasn't in the history schema so it survived — which is
 *   why the duplicates keep each row's original `basePrice` (500 for what used
 *   to be electronics, 220 for chemicals, 60 for energy, etc.).
 *
 * IMPACT:
 *   47 docs in `commodityPrices` instead of 27 (one per commodity). 21 of those
 *   are `copper` rows — 1 legitimate (`basePrice = 9000`) + 20 corrupted
 *   duplicates with other commodities' base prices and the real copper's
 *   nationalPrices (~£40k / $34k / ¥36k). `inflationRecalc.ts` averages
 *   `nationalPrice / basePrice - 1` across every row, so the duplicates
 *   balloon commodity pressure to ~75-90 and pin inflation at the 15% cap
 *   in US / UK / JP / DE. The 26 non-copper commodities were re-upserted
 *   fresh by `commodityPriceTurn` on turn 276+ after the heal overwrote
 *   their `commodity` fields.
 *
 * HEAL STRATEGY:
 *   Delete every copper row except the one `commodityPriceTurn` is keeping
 *   current. The canonical row is identified by BOTH
 *     (a) `basePrice === COMMODITY_BASE_PRICES.copper` (9000), and
 *     (b) `turn === max(turn across all copper rows)`.
 *   Every duplicate (including a second basePrice=9000 row that the heal
 *   migration left behind) is frozen at the heal-migration turn (275), so
 *   picking max(turn) uniquely identifies the row that `commodityPriceTurn`
 *   has touched since the heal. If zero or >1 rows satisfy both criteria,
 *   the script aborts without writing.
 *
 *   After deleting the duplicates, the canonical row is also reset:
 *     - `globalPrice` → `basePrice` (9000)
 *     - `statePrices` → {}   (recomputes next turn from real S/D)
 *     - `nationalPrices` → {} (recomputes next turn from real S/D)
 *   The reset wipes the NaN-era inflated prices from the surviving row so
 *   prices restart from the base and drift from there on subsequent turns.
 *   `commodityPriceTurn` rebuilds all three fields each turn, so the gap
 *   is at most one turn of display.
 *
 *   No data needs to be reconstructed for the other 26 commodities — their
 *   rows were already re-upserted by `commodityPriceTurn` on turns 276+.
 *   The next `inflationRecalc` after this migration will compute a clean
 *   `commodityPressure` and inflation will fall from its pinned 15%.
 *
 * USAGE:
 *   # Dry-run (default — prints report, writes nothing)
 *   npx tsx scripts/migrations/heal-commodity-prices-copper-duplicates.ts
 *
 *   # Apply (after reviewing dry-run output)
 *   npx tsx scripts/migrations/heal-commodity-prices-copper-duplicates.ts --apply
 *
 *   The script reads `MONGODB_URI_LIVE` if set, else falls back to `MONGODB_URI`.
 *
 * IDEMPOTENCY:
 *   Marker `migrationsRun._id = "heal-commodity-prices-copper-duplicates"`.
 *   Re-running with --apply after the marker is set is a no-op. A dry-run
 *   never writes the marker.
 */
import { MongoClient, Db, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MARKER_ID = "heal-commodity-prices-copper-duplicates";
const CANONICAL_COPPER_BASE_PRICE = 9000;

interface CommodityPriceDoc {
  _id: ObjectId | string;
  commodity: string;
  basePrice: number;
  globalPrice?: number;
  turn?: number;
  updatedAt?: Date;
  nationalPrices?: Record<string, number>;
}

function resolveUri(): string {
  const live = process.env.MONGODB_URI_LIVE;
  const fallback = process.env.MONGODB_URI;
  const uri = live ?? fallback;
  if (!uri) {
    throw new Error("Set MONGODB_URI_LIVE (or MONGODB_URI) in .env.local");
  }
  if (live) console.log("[heal-copper] using MONGODB_URI_LIVE");
  else console.log("[heal-copper] using MONGODB_URI (fallback)");
  return uri;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = resolveUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db("a-house-divided");

  try {
    console.log(`\n[heal-copper] mode=${apply ? "APPLY" : "DRY-RUN"}\n`);

    // Idempotency check
    const migrationsRun = db.collection<{ _id: string }>("migrationsRun");
    const existing = await migrationsRun.findOne({ _id: MARKER_ID });
    if (existing && apply) {
      console.log(`[heal-copper] already stamped: ${JSON.stringify(existing)}`);
      console.log(`[heal-copper] nothing to do — exiting.`);
      return;
    }

    const copper = (await db
      .collection("commodityPrices")
      .find({ commodity: "copper" })
      .sort({ basePrice: 1 })
      .toArray()) as unknown as CommodityPriceDoc[];

    console.log(`Found ${copper.length} \`copper\` rows in commodityPrices.\n`);

    if (copper.length === 0) {
      console.log(`[heal-copper] no copper rows — nothing to clean.`);
      return;
    }

    // Canonical row = (basePrice == 9000) AND (turn == max(turn)). The heal
    // migration froze every duplicate at turn 275; commodityPriceTurn has
    // been updating only the legitimate row since. Both conditions together
    // disambiguate a second heal-artifact row that happens to have
    // basePrice=9000.
    const maxTurn = copper.reduce(
      (m, d) => (typeof d.turn === "number" && d.turn > m ? d.turn : m),
      -Infinity
    );
    const canonical = copper.filter(
      (d) =>
        typeof d.basePrice === "number" &&
        d.basePrice === CANONICAL_COPPER_BASE_PRICE &&
        typeof d.turn === "number" &&
        d.turn === maxTurn
    );
    const duplicates = copper.filter(
      (d) =>
        !(
          typeof d.basePrice === "number" &&
          d.basePrice === CANONICAL_COPPER_BASE_PRICE &&
          typeof d.turn === "number" &&
          d.turn === maxTurn
        )
    );

    console.log(
      `Canonical (basePrice=${CANONICAL_COPPER_BASE_PRICE}, turn=${Number.isFinite(maxTurn) ? maxTurn : "?"}): ${canonical.length} row(s)`
    );
    for (const d of canonical) {
      console.log(
        `  KEEP   _id=${String(d._id)} basePrice=${d.basePrice} globalPrice=${d.globalPrice} turn=${d.turn} updatedAt=${d.updatedAt ? new Date(d.updatedAt).toISOString() : "?"}`
      );
    }

    console.log(`\nDuplicates: ${duplicates.length} row(s)`);
    for (const d of duplicates) {
      console.log(
        `  DELETE _id=${String(d._id)} basePrice=${d.basePrice} globalPrice=${d.globalPrice} turn=${d.turn} updatedAt=${d.updatedAt ? new Date(d.updatedAt).toISOString() : "?"}`
      );
    }

    // Safety asserts
    if (canonical.length === 0) {
      console.error(
        `\n[heal-copper] ABORT — no copper row matches (basePrice=${CANONICAL_COPPER_BASE_PRICE} AND turn=${maxTurn}). The canonical row is missing or ambiguous; manual investigation required.`
      );
      process.exitCode = 1;
      return;
    }
    if (canonical.length > 1) {
      console.error(
        `\n[heal-copper] ABORT — ${canonical.length} copper rows match both canonical criteria. Expected exactly 1. Manual disambiguation required.`
      );
      process.exitCode = 1;
      return;
    }

    if (duplicates.length === 0) {
      console.log(`\n[heal-copper] no duplicates present — nothing to delete.`);
      if (apply) {
        await migrationsRun.updateOne(
          { _id: MARKER_ID },
          { $set: { _id: MARKER_ID, completedAt: new Date(), deleted: 0, note: "no-op" } },
          { upsert: true }
        );
        console.log(`[heal-copper] stamped as ${MARKER_ID} (no-op).`);
      }
      return;
    }

    // Extra safety: every duplicate's basePrice must either match the
    // canonical copper basePrice (a heal-artifact duplicate) or belong to
    // another known commodity (i.e. some different commodity currently has
    // that basePrice). Anything else suggests an unrelated insert that
    // needs manual review.
    const basePricesInUse = new Set<number>(
      (
        (await db
          .collection("commodityPrices")
          .find({ commodity: { $ne: "copper" } }, { projection: { basePrice: 1 } })
          .toArray()) as unknown as { basePrice?: number }[]
      )
        .map((d) => d.basePrice)
        .filter((v): v is number => typeof v === "number")
    );
    const suspicious = duplicates.filter(
      (d) =>
        typeof d.basePrice !== "number" ||
        (d.basePrice !== CANONICAL_COPPER_BASE_PRICE && !basePricesInUse.has(d.basePrice))
    );
    if (suspicious.length > 0) {
      console.error(
        `\n[heal-copper] ABORT — ${suspicious.length} duplicate row(s) carry a basePrice not matching any other current commodity. Manual review required:`
      );
      for (const d of suspicious) {
        console.error(`  _id=${String(d._id)} basePrice=${d.basePrice}`);
      }
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log(
        `\n[heal-copper] DRY-RUN complete. Would delete ${duplicates.length} row(s) and reset canonical row _id=${String(canonical[0]._id)} to globalPrice=${CANONICAL_COPPER_BASE_PRICE}, statePrices={}, nationalPrices={}. Re-run with --apply to commit.`
      );
      return;
    }

    const ids = duplicates.map((d) => d._id);
    const result = await db
      .collection("commodityPrices")
      .deleteMany({ _id: { $in: ids } as unknown as ObjectId });
    console.log(`\n[heal-copper] deleted ${result.deletedCount} row(s).`);

    // Reset the canonical row back to base so prices restart from the base
    // price and drift from there. commodityPriceTurn will recompute
    // statePrices / nationalPrices on its next run from real supply/demand.
    const keptId = canonical[0]._id;
    const resetRes = await db.collection("commodityPrices").updateOne(
      { _id: keptId as unknown as ObjectId },
      {
        $set: {
          globalPrice: CANONICAL_COPPER_BASE_PRICE,
          statePrices: {},
          nationalPrices: {},
          updatedAt: new Date(),
        },
      }
    );
    console.log(
      `[heal-copper] reset canonical row _id=${String(keptId)}: modified=${resetRes.modifiedCount} (globalPrice→${CANONICAL_COPPER_BASE_PRICE}, statePrices/nationalPrices cleared).`
    );

    // Verify final state
    const remaining = await db
      .collection("commodityPrices")
      .countDocuments({ commodity: "copper" });
    if (remaining !== 1) {
      console.error(
        `[heal-copper] WARNING: post-delete copper count = ${remaining} (expected 1). Investigate manually.`
      );
    } else {
      console.log(`[heal-copper] post-delete copper row count: 1 ✓`);
    }

    await migrationsRun.updateOne(
      { _id: MARKER_ID },
      {
        $set: {
          _id: MARKER_ID,
          completedAt: new Date(),
          deleted: result.deletedCount,
          keptCanonicalId: String(canonical[0]._id),
          resetCanonicalGlobalPrice: CANONICAL_COPPER_BASE_PRICE,
        },
      },
      { upsert: true }
    );
    console.log(`[heal-copper] stamped as ${MARKER_ID}.`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("[heal-copper] failed:", e);
  process.exit(1);
});
