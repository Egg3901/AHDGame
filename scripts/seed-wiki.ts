/**
 * Seed wiki pages from src/lib/seeds/wiki into the `wikiPages` collection.
 *
 * Non-destructive by default: pages with human edits are preserved. Pass --force
 * to overwrite edited pages. Pages absent from the seed list are NOT deleted
 * (removal is handled by admins through the wiki UI / API).
 *
 * Usage:
 *   npx tsx scripts/seed-wiki.ts                         # Upsert; skip human-edited pages
 *   npx tsx scripts/seed-wiki.ts --force                 # Overwrite everything seed-owned
 *   npx tsx scripts/seed-wiki.ts --slug=getting-started  # Only this slug
 */

import { ObjectId } from "mongodb";
import { connectDb, closeDb } from "./utils/db";
import { seedWikiPages } from "../src/lib/seeds/wiki";

const FORCE = process.argv.includes("--force");
const SLUG_ARGS = process.argv
  .filter((a) => a.startsWith("--slug="))
  .map((a) => a.slice("--slug=".length));

/**
 * Placeholder user id used when the seed runs from CLI. Matches the convention
 * used by the legacy wiki migration (all-zero ObjectId). Admin-triggered reseeds
 * through the API use the real admin user id instead.
 */
const CLI_SEED_USER_ID = new ObjectId("000000000000000000000000");

async function main() {
  console.log(`Seed: Wiki Pages${FORCE ? " (force)" : ""}\n`);

  const db = await connectDb();

  try {
    const result = await seedWikiPages(db, CLI_SEED_USER_ID, {
      force: FORCE,
      slugs: SLUG_ARGS.length ? SLUG_ARGS : undefined,
    });

    console.log(`Inserted: ${result.inserted.length}`);
    for (const slug of result.inserted) console.log(`  + ${slug}`);
    console.log(`Updated:  ${result.updated.length}`);
    for (const slug of result.updated) console.log(`  ~ ${slug}`);
    console.log(`Skipped:  ${result.skipped.length}`);
    for (const { slug, reason } of result.skipped) console.log(`  - ${slug}: ${reason}`);
    console.log("\nDone.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
