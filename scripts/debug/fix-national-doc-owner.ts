/**
 * Give `de_national` its country back.
 *
 * The reversal swept `countryId: "DE" -> "DD"` across every collection. That is
 * right for a German region or a German character, and WRONG for this doc: the
 * national-metrics docs are identified by their `_id` prefix, and `NATIONAL_SCOPE`
 * maps `de_national` to DE and `dd_national` to DD. Flipping the field left two
 * documents both claiming to be the unified state's economy — one of them the
 * Federal Republic's, carrying `gdpGrowth: -8.451`.
 *
 * `getNationalDocId` resolves a country through that map, so DD reads
 * `dd_national`: with all sixteen regions now under DD, the next turn recomputes
 * it as the unified economy. `de_national` is the dissolved shell's record and
 * simply stops being read.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  for (const coll of ["macroMetrics", "macroMetricsHistory", "politicalMetrics", "stateMetrics"]) {
    const doc = await db.collection(coll).findOne({ _id: "de_national" as never });
    if (!doc) continue;
    const owner = (doc as Record<string, unknown>).countryId;
    if (owner === undefined) {
      console.log(`  ${coll.padEnd(22)} de_national carries no countryId — nothing to correct`);
      continue;
    }
    console.log(`  ${coll.padEnd(22)} de_national countryId ${owner} -> DE`);
    if (APPLY && owner !== "DE") {
      await db
        .collection(coll)
        .updateOne({ _id: "de_national" as never }, { $set: { countryId: "DE" } } as never);
    }
  }

  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
