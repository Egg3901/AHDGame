/**
 * Read-only seed index drift report (#2699).
 *
 * Lists every index `seedIndexes` defines that the database at MONGODB_URI
 * lacks. A running world never re-seeds, so this is how drift is noticed
 * before it shows up as collection scans in turn timings.
 *
 *   npx tsx scripts/perf/index-drift.ts [--json out.json]
 *
 * Issues only `listIndexes` and `estimatedDocumentCount`.
 */
import { writeFileSync } from "node:fs";
import { connectDb, closeDb } from "../utils/db";
import {
  collectSeedIndexPlan,
  findMissingSeedIndexes,
  isTextIndex,
  isTtlIndex,
} from "../../src/lib/admin/seed/indexes/plan";

async function main() {
  const db = await connectDb();
  const plan = await collectSeedIndexPlan();
  const missing = await findMissingSeedIndexes(db, plan);
  const rows = [];
  for (const entry of missing) {
    const docs = await db
      .collection(entry.collection)
      .estimatedDocumentCount()
      .catch(() => 0);
    const kind = isTextIndex(entry)
      ? "text"
      : isTtlIndex(entry)
        ? "ttl"
        : entry.options.unique
          ? "unique"
          : "index";
    rows.push({
      collection: entry.collection,
      name: entry.options.name ?? "",
      key: entry.key,
      kind,
      docs,
    });
  }
  rows.sort((a, b) => b.docs - a.docs);
  console.log(`${plan.length} seed indexes planned, ${missing.length} missing`);
  for (const r of rows) {
    console.log(
      `${String(r.docs).padStart(10)}  ${r.kind.padEnd(6)}  ${r.collection}  ${JSON.stringify(r.key)}  ${r.name}`
    );
  }
  const i = process.argv.indexOf("--json");
  if (i !== -1) writeFileSync(process.argv[i + 1], JSON.stringify(rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
