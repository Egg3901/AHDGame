/**
 * One-shot cleanup migration: stamp `liquidCurrencyCode` on corps that made it
 * through the `corpEconomyToLocalCurrency.ts` migration without the field set.
 *
 * Background: the main corp-economy migration rescales every money field
 * (liquidCapital, sharePrice, budgets, sector revenue, history rows) using
 * `resolveCorpLiquidCurrencyCode(corp)` which falls back to
 * `COUNTRY_CURRENCY_MAP[corp.countryId]` when `liquidCurrencyCode` is missing.
 * That fallback means the rescale math is correct for pre-forex corps — their
 * money fields are now in their country's LOCAL currency — but the field
 * itself is never written to disk. Downstream code still works via the same
 * fallback, but the implicit dependency is fragile: any future code path that
 * reads `corp.liquidCurrencyCode` directly (without routing through the
 * resolver) would see `undefined`.
 *
 * This migration closes the gap by $set-ing `liquidCurrencyCode` to the
 * country-derived currency on every such corp. Metadata-only — no rescale.
 * The money fields on these corps are already in the target currency from
 * the prior corpEconomy migration.
 *
 * **Idempotent** via `migrationsRun` marker (_id = "legacy-corp-currency-code").
 * Also re-run-safe without the marker — every write is gated on
 * `{ liquidCurrencyCode: { $exists: false } }`.
 *
 * Only runs meaningfully AFTER `corpEconomyToLocalCurrency.ts` has set the
 * rescaled money fields. Running this first would leave rescale-mismatched
 * corps (money in ₳ but stamped with a local currency code). The script
 * logs a warning and exits if the prerequisite marker is missing.
 *
 * Usage: `MONGODB_URI=... npx tsx scripts/migrations/backfillLegacyCorpCurrencyCode.ts`
 */

import { connectDb, closeDb } from "../../utils/db";
import { COUNTRY_CURRENCY_MAP } from "../../../src/lib/constants/currencies";
import type { Corporation } from "../../../src/lib/db/types";

const MARKER_ID = "legacy-corp-currency-code";
const PREREQ_MARKER = "corp-economy-to-local-currency";

async function main() {
  const db = await connectDb();
  try {
    const marker = await db
      .collection<{ _id: string; completedAt: Date; [key: string]: unknown }>("migrationsRun")
      .findOne({ _id: MARKER_ID });
    if (marker) {
      console.log(`[${MARKER_ID}] already ran at ${marker.completedAt}. Exiting.`);
      return;
    }

    // Safety: refuse to run before the corpEconomy migration. Without that,
    // pre-forex corps' money fields are still in ₳, and stamping a LOCAL
    // currency code would leave readers mis-scaling them.
    const prereq = await db
      .collection<{ _id: string }>("migrationsRun")
      .findOne({ _id: PREREQ_MARKER });
    if (!prereq) {
      console.error(
        `[${MARKER_ID}] ABORT: prerequisite marker "${PREREQ_MARKER}" not found. ` +
          `Run corpEconomyToLocalCurrency.ts first. Exiting without writes.`
      );
      process.exitCode = 1;
      return;
    }

    // Pre-flight: warn if turns are running.
    const gameState =
      (await db
        .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
        .findOne({ _id: "current" })) ?? null;
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(
        `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
          `isProcessing=${gameState.isProcessing ?? false}. Metadata-only writes are low risk ` +
          `vs a concurrent turn, but pausing is still recommended. Continuing in 10s — abort ` +
          `with Ctrl-C if this is unexpected.`
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    // Find every corp missing liquidCurrencyCode.
    const preForexCorps = await db
      .collection<Corporation>("corporations")
      .find({ liquidCurrencyCode: { $exists: false } })
      .project<Pick<Corporation, "_id" | "name" | "countryId">>({
        _id: 1,
        name: 1,
        countryId: 1,
      })
      .toArray();

    let stamped = 0;
    let skippedNoCountry = 0;
    let skippedUnknownCountry = 0;

    for (const corp of preForexCorps) {
      if (!corp.countryId) {
        console.warn(`  skip corp ${corp._id} (${corp.name}): no countryId`);
        skippedNoCountry++;
        continue;
      }
      const currency = COUNTRY_CURRENCY_MAP[corp.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
      if (!currency) {
        console.warn(
          `  skip corp ${corp._id} (${corp.name}): countryId=${corp.countryId} not in COUNTRY_CURRENCY_MAP`
        );
        skippedUnknownCountry++;
        continue;
      }
      await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: corp._id }, { $set: { liquidCurrencyCode: currency } });
      console.log(`  stamp ${corp.name} (${corp.countryId}) → ${currency}`);
      stamped++;
    }

    await db
      .collection<{ _id: string; completedAt: Date; [key: string]: unknown }>("migrationsRun")
      .insertOne({
        _id: MARKER_ID,
        completedAt: new Date(),
        stamped,
        skippedNoCountry,
        skippedUnknownCountry,
      });
    console.log(
      `[${MARKER_ID}] complete: ${stamped} stamped, ` +
        `${skippedNoCountry} skipped (no countryId), ` +
        `${skippedUnknownCountry} skipped (unknown country).`
    );
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
