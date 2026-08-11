/**
 * One-time migration (v0.2.6): stamp `bond.currencyCode` onto every existing
 * bond based on its issuer.
 *
 * - Sovereign bonds → inherit country currency (USD for US, GBP for UK, etc.)
 * - Corporate bonds → inherit issuing corp's `liquidCurrencyCode`
 * - Bonds whose issuer cannot be resolved (orphaned / pre-forex corps without
 *   a currency, or malformed sovereigns missing `countryId`) are left without
 *   a `currencyCode` field — readers fall through to `countryId`-derived
 *   defaults.
 *
 * **Metadata-only**: does NOT multiply `totalIssued` / `faceValue` by any FX
 * rate. The existing stored values are already in the issuer's currency
 * implicitly (a $1,000 corporate bond unit issued by a UK corp was already
 * meant to be GBP 1,000). This script just makes the denomination explicit so
 * holder-side coupon math and UI can convert correctly going forward.
 *
 * Idempotent via `migrationsRun` marker (_id = "bond-currency-stamp").
 *
 * CRASH RECOVERY: unlike the corp migration, this script is
 * RE-RUN-SAFE even without the marker. Every write is gated on
 * `currencyCode: { $exists: false }` and only writes the stamp (no rescale,
 * no accumulation). A crash mid-run leaves some bonds stamped and others
 * unstamped; re-running simply picks up where it left off. The marker is an
 * optimization, not a safety primitive.
 *
 * Usage: `MONGODB_URI=... npx tsx scripts/migrations/bondCurrencyStamp.ts`
 */

import { connectDb, closeDb } from "../utils/db";
import { resolveCorpLiquidCurrencyCode } from "../../src/lib/currency/corporationCapital";
import { resolveCountryCurrencyCode } from "../../src/lib/currency/govBudgetFields";
import type { Bond, Corporation } from "../../src/lib/db/types";

const MARKER_ID = "bond-currency-stamp";

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

    // Pre-flight: warn if turn processing is running. The bond turn doesn't
    // mutate `currencyCode`, so this is lower-risk than the corp migration —
    // but new bonds created mid-run (sovereign issuance, corporate bond sale)
    // would land unstamped and need a rerun. Match the corp migration's
    // operator-awareness protocol.
    const gameState =
      (await db
        .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
        .findOne({ _id: "current" })) ?? null;
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(
        `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
          `isProcessing=${gameState.isProcessing ?? false}. Turn processing may be running. ` +
          `Bonds issued during this run will land unstamped and require a rerun. ` +
          `Pause turns via the admin panel first. Continuing in 10 seconds — abort with ` +
          `Ctrl-C if this is unexpected.`
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    // Build corp → currencyCode map for corporate bonds
    const corps = await db
      .collection<Corporation>("corporations")
      .find({}, { projection: { _id: 1, liquidCurrencyCode: 1, countryId: 1 } })
      .toArray();
    const corpCurrencyById = new Map<string, string>();
    for (const corp of corps) {
      const code = resolveCorpLiquidCurrencyCode(corp);
      if (code) corpCurrencyById.set(corp._id.toString(), code);
    }

    const bonds = await db
      .collection<Bond>("bonds")
      .find({ currencyCode: { $exists: false } })
      .toArray();
    let stampedSovereign = 0;
    let stampedCorporate = 0;
    let skipped = 0;

    for (const bond of bonds) {
      let code: string | undefined;
      if (bond.issuerType === "sovereign") {
        // Malformed sovereigns (missing countryId) fall through to `skipped`
        // rather than the corporate branch — looking them up by corporationId
        // would silently mis-stamp them with an unrelated corp's currency.
        if (bond.countryId) {
          code = resolveCountryCurrencyCode({ countryId: bond.countryId });
        }
      } else {
        // Corporate bond (default / legacy issuerType) — look up issuing corp
        code = corpCurrencyById.get(bond.corporationId.toString());
      }
      if (!code) {
        skipped++;
        continue;
      }
      await db.collection("bonds").updateOne({ _id: bond._id }, { $set: { currencyCode: code } });
      if (bond.issuerType === "sovereign") stampedSovereign++;
      else stampedCorporate++;
    }

    await db
      .collection<{ _id: string; completedAt: Date; [key: string]: unknown }>("migrationsRun")
      .insertOne({
        _id: MARKER_ID,
        completedAt: new Date(),
        stampedSovereign,
        stampedCorporate,
        skipped,
      });
    console.log(
      `[${MARKER_ID}] complete: sovereign=${stampedSovereign}, corporate=${stampedCorporate}, skipped=${skipped}.`
    );
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
