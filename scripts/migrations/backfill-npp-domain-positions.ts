/**
 * Migration: Backfill NPP `policies.domainPositions`
 *
 * Phase 4 of the party/NPP rework introduced cross-pressure voting
 * (`src/lib/turn/npp/crossPressure.ts`), which reads a per-legislation-type
 * stance from `npp.policies.domainPositions[legislationTypeId]`. The NPP
 * generator did not write that field, so existing NPPs vote with ideology
 * collapsed to the small economic tint and abstain ~50% of the time on
 * unwhipped, non-policy-coded bills.
 *
 * This script derives `domainPositions` for every NPP whose map is missing
 * or empty, using the same axis-alignment math the updated generator now
 * uses (`src/lib/npp/domainPositions.ts`).
 *
 * Idempotent: NPPs already carrying a non-empty `domainPositions` map are
 * skipped.
 */

import type { LegislationType, NPP } from "@/lib/db/types";
import { deriveDomainPositions } from "../../src/lib/npp/domainPositions";
import { closeDb, connectDb } from "../utils/db";

async function migrate() {
  console.log("Backfilling NPP domainPositions ...");
  const db = await connectDb();

  const legislationTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({})
    .toArray();
  console.log(`Loaded ${legislationTypes.length} legislation types`);

  if (legislationTypes.length === 0) {
    console.warn("No legislation types found — nothing to derive against. Aborting.");
    await closeDb();
    return;
  }

  const cursor = db.collection<NPP>("npps").find({
    $or: [
      { "policies.domainPositions": { $exists: false } },
      { "policies.domainPositions": null },
      { "policies.domainPositions": {} },
    ],
  });

  let updated = 0;
  let skipped = 0;
  let scanned = 0;

  for await (const npp of cursor) {
    scanned++;
    const economic = npp.policies?.economic ?? 0;
    const social = npp.policies?.social ?? 0;

    const domainPositions = deriveDomainPositions(legislationTypes, economic, social);

    if (Object.keys(domainPositions).length === 0) {
      skipped++;
      continue;
    }

    await db.collection<NPP>("npps").updateOne(
      { _id: npp._id },
      {
        $set: {
          "policies.domainPositions": domainPositions,
          updatedAt: new Date(),
        },
      }
    );
    updated++;
    if (updated % 200 === 0) {
      console.log(`  ... ${updated} updated`);
    }
  }

  console.log(`Scanned: ${scanned}, Updated: ${updated}, Skipped (no derivable axis): ${skipped}`);
  await closeDb();
  console.log("Done.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
