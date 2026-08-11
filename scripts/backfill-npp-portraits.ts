/**
 * Backfill gender, ethnicity, and avatarUrl on NPPs that predate portrait demographics.
 *
 * - gender: inferred from first name (checks male/female name lists, 50/50 fallback)
 * - ethnicity: weighted random by countryId
 * - avatarUrl: selected from Wikipedia image pool (with name-clash protection)
 *
 * Only fills missing fields — existing values are preserved.
 * Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-npp-portraits.ts [--dry-run]
 */

import { connectDb, closeDb } from "./utils/db";
import type { NPP } from "../src/lib/db/types";
import { inferGenderFromFirstName } from "../src/lib/npp/nameGenerator";
import { weightedRandomEthnicity, selectPoliticianImage } from "../src/lib/npp/generator";
import type { CountryId } from "../src/lib/constants/countries";

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  const db = await connectDb();

  const npps = await db
    .collection<NPP>("npps")
    .find({
      retiredAt: null,
      $or: [
        { gender: { $exists: false } },
        { ethnicity: { $exists: false } },
        { avatarUrl: { $exists: false } },
      ],
    })
    .project<Pick<NPP, "_id" | "name" | "gender" | "ethnicity" | "avatarUrl" | "countryId">>({
      name: 1,
      gender: 1,
      ethnicity: 1,
      avatarUrl: 1,
      countryId: 1,
    })
    .toArray();

  console.log(`Found ${npps.length} NPPs needing portrait backfill${isDryRun ? " (dry run)" : ""}`);

  let updated = 0;
  let skippedNoImage = 0;

  for (const npp of npps) {
    const countryId: CountryId = npp.countryId ?? "US";
    const gender = npp.gender ?? inferGenderFromFirstName(npp.name);
    const ethnicity = npp.ethnicity ?? weightedRandomEthnicity(countryId);

    const setOps: Partial<Pick<NPP, "gender" | "ethnicity" | "avatarUrl" | "updatedAt">> = {};

    if (!npp.gender) setOps.gender = gender;
    if (!npp.ethnicity) setOps.ethnicity = ethnicity;

    if (!npp.avatarUrl) {
      const avatarUrl = selectPoliticianImage(countryId, gender, ethnicity, npp.name);
      if (avatarUrl) {
        setOps.avatarUrl = avatarUrl;
      } else {
        skippedNoImage++;
      }
    }

    if (Object.keys(setOps).length > 0) {
      if (!isDryRun) {
        setOps.updatedAt = new Date();
        await db.collection<NPP>("npps").updateOne({ _id: npp._id }, { $set: setOps });
      }
      console.log(
        `  ${isDryRun ? "[dry]" : "✓"} ${npp.name} → gender=${gender} ethnicity=${ethnicity}${setOps.avatarUrl ? ` avatar=${setOps.avatarUrl}` : ""}`
      );
      updated++;
    }
  }

  console.log(
    `\nDone: ${updated} NPPs ${isDryRun ? "would be" : "were"} updated, ${skippedNoImage} skipped (no image pool for country).`
  );
}

main()
  .then(() => closeDb())
  .catch((err) => {
    console.error(err);
    closeDb();
    process.exit(1);
  });
