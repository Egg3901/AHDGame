/**
 * Migration: rename CN's executive office key from "president" → "premier".
 *
 * The CN parliamentary head of government is the Premier (head of the State
 * Council). Phase 05 of the China parity rollout seeded the officeType with
 * `key: "president"` but UI labeled it as "Premier", which left every
 * generic surface that reads the office's `label` showing "President".
 *
 * The audit fix in commit 4993455 corrected the label; this migration
 * corrects the key on already-persisted documents so the runtime and
 * config agree.
 *
 * Scope:
 *   characters     { countryId: "CN", "currentOffice.type": "president" }
 *   npps           { countryId: "CN", "currentOffice.type": "president" }
 *   electedOfficials { countryId: "CN", officeType: "president" }
 *   countryLeaderStates { countryId: "CN", leaderOfficeType: "president" }
 *   seats           { countryId: "CN", officeType: "president" }
 *
 * US data is unaffected — every query is scoped to countryId === "CN".
 *
 * Usage: npx tsx scripts/migrations/2026-05-22-cn-executive-key-rename.ts [--dry-run]
 */
import { connectDb, closeDb } from "../utils/db";

const OLD_KEY = "president";
const NEW_KEY = "premier";
const COUNTRY = "CN" as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  const targets: Array<{
    coll: string;
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [
    {
      coll: "characters",
      filter: { countryId: COUNTRY, "currentOffice.type": OLD_KEY },
      update: { $set: { "currentOffice.type": NEW_KEY } },
    },
    {
      coll: "npps",
      filter: { countryId: COUNTRY, "currentOffice.type": OLD_KEY },
      update: { $set: { "currentOffice.type": NEW_KEY } },
    },
    {
      coll: "electedOfficials",
      filter: { countryId: COUNTRY, officeType: OLD_KEY },
      update: { $set: { officeType: NEW_KEY } },
    },
    {
      coll: "countryLeaderStates",
      filter: { countryId: COUNTRY, leaderOfficeType: OLD_KEY },
      update: { $set: { leaderOfficeType: NEW_KEY } },
    },
    {
      coll: "seats",
      filter: { countryId: COUNTRY, officeType: OLD_KEY },
      update: { $set: { officeType: NEW_KEY } },
    },
  ];

  let totalMatched = 0;
  let totalModified = 0;

  for (const t of targets) {
    const matched = await db.collection(t.coll).countDocuments(t.filter);
    totalMatched += matched;

    if (matched === 0) {
      console.log(`[${t.coll}] 0 documents need updating — skipping`);
      continue;
    }

    if (dryRun) {
      console.log(`[${t.coll}] DRY RUN — would update ${matched} document(s)`);
      continue;
    }

    const result = await db.collection(t.coll).updateMany(t.filter, t.update);
    console.log(`[${t.coll}] matched=${matched}, modified=${result.modifiedCount}`);
    totalModified += result.modifiedCount;
  }

  console.log(
    `\nSummary: matched=${totalMatched}, modified=${dryRun ? 0 : totalModified}${
      dryRun ? " (DRY RUN)" : ""
    }`
  );
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
