/**
 * Heal: DE Bundestag duplicate list-seat officials (issue #2957 / ticket #929).
 *
 * A non-atomic reconciliation double-run (persistBundestagResult: deleteMany +
 * insertMany raced) inserted every (party, Land) `seatSource:"list"` bloc TWICE,
 * doubling the list tier (664 vs 332) and inflating the chamber to 963/630.
 *
 * This script:
 *   1. Groups DE Bundestag `seatSource:"list"` officials by (party, Land).
 *   2. For any group with >1 doc whose seatsHeld are identical, keeps the doc
 *      with the lowest _id and deletes the rest. Groups whose copies DISAGREE on
 *      seatsHeld are NOT touched (reported for manual review — should be none).
 *   3. On --apply, also creates a partial unique index on
 *      {countryId, officeType, state, party} filtered to seatSource:"list", so a
 *      future concurrent insert of a duplicate bloc fails instead of doubling.
 *
 * Dry-run by default. Pass --apply to mutate. Read-only otherwise.
 *
 *   npx tsx scripts/heal-de-bundestag-dup-list.ts           # dry run
 *   npx tsx scripts/heal-de-bundestag-dup-list.ts --apply   # execute
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient, ObjectId } from "mongodb";

const APPLY = process.argv.includes("--apply");
const INDEX_NAME = "de_bundestag_list_bloc_unique";

async function run() {
  const base = process.env.MONGODB_URI!;
  const uri = base + (base.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");
  const col = db.collection("electedOfficials");

  const filter = { officeType: "bundestag", countryId: "DE" as const };
  const before = await col.find(filter).toArray();
  const sum = (a: typeof before) => a.reduce((s, o) => s + ((o.seatsHeld as number) ?? 0), 0);
  console.log(`MODE: ${APPLY ? "APPLY (will mutate)" : "DRY RUN (read-only)"}`);
  console.log(`Before: ${before.length} docs, ${sum(before)} seats`);

  // Group list docs by (party, Land)
  const list = before.filter((o) => o.seatSource === "list");
  const groups = new Map<string, typeof before>();
  for (const o of list) {
    const key = `${o.party}|${o.state}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }

  const toDelete: ObjectId[] = [];
  const conflicts: string[] = [];
  for (const [key, docs] of groups) {
    if (docs.length <= 1) continue;
    const seatsSet = new Set(docs.map((d) => d.seatsHeld));
    if (seatsSet.size > 1) {
      conflicts.push(
        `${key}: seatsHeld disagree [${docs.map((d) => d.seatsHeld).join(",")}] — SKIPPED`
      );
      continue;
    }
    // keep lowest _id, delete rest
    const sorted = [...docs].sort((a, b) =>
      (a._id as ObjectId).toString().localeCompare((b._id as ObjectId).toString())
    );
    for (const d of sorted.slice(1)) toDelete.push(d._id as ObjectId);
  }

  console.log(`\nList blocs: ${groups.size} keys, ${list.length} docs`);
  console.log(`Duplicate docs to delete: ${toDelete.length}`);
  if (conflicts.length) {
    console.log(`\n⚠️  ${conflicts.length} conflicting group(s) NOT auto-healed:`);
    for (const c of conflicts) console.log(`   ${c}`);
  }
  const projectedTotal =
    sum(before) -
    toDelete.reduce((s, id) => {
      const d = before.find((o) => (o._id as ObjectId).equals(id));
      return s + ((d?.seatsHeld as number) ?? 0);
    }, 0);
  console.log(`Projected chamber after heal: ${projectedTotal} seats`);

  if (!APPLY) {
    console.log(`\n(dry run — no changes written. Re-run with --apply to execute.)`);
    await client.close();
    return;
  }

  if (toDelete.length > 0) {
    const res = await col.deleteMany({ _id: { $in: toDelete } });
    console.log(`\nDeleted ${res.deletedCount} duplicate list docs.`);
  }

  // Create the partial unique index (safe now that dups are removed).
  try {
    await col.createIndex(
      { countryId: 1, officeType: 1, state: 1, party: 1 },
      { name: INDEX_NAME, unique: true, partialFilterExpression: { seatSource: "list" } }
    );
    console.log(`Ensured partial unique index '${INDEX_NAME}'.`);
  } catch (err) {
    console.error(`Index creation failed (dups may remain?):`, (err as Error).message);
  }

  const after = await col.find(filter).toArray();
  console.log(`\nAfter: ${after.length} docs, ${sum(after)} seats`);
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
