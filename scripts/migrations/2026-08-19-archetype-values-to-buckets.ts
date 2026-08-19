/**
 * Migration: project archetype-keyed live data onto Layer-1 census buckets.
 *
 * The engine now authors approvals, favorability and legislation effects in the
 * bucket vocabulary. Existing documents were written in the archetype one, and
 * although both still resolve at read time — `archetypeValuesToBuckets` fans an
 * archetype out and passes a bucket through — leaving them mixed means the
 * archetype tables can never be deleted, because live data still needs them to
 * be interpretable.
 *
 * So this runs the same projection ONCE, at rest, using each world's own
 * country to pick the bucket vocabulary. That country choice is the whole
 * reason this cannot be a blind `$rename`: `union_trades` decomposes into
 * `education:no_college / wealth:low / race:black` in the US and into entirely
 * different dimensions in the UK, Japan or Germany, and projecting a UK
 * character through the US table is exactly the bug that lost every non-US
 * archetype effect in the first place.
 *
 * Collections touched:
 *   characters.archetypeApprovals            → bucket-keyed (country from the doc)
 *   nonPlayerPoliticians.archetypeApprovals  → same
 *   npps.archetypeApprovals                  → same
 *   legislationTypes.policyOptions[].archetypeApprovals → bucket-keyed
 *   legislationTypes.demographicEffects[].groupId       → { dim, bucket }
 *   partyGroupFavorability.groupId           → one row per projected bucket
 *   characters.lastPoll / lastPollLarge      → unset (archetype-shaped snapshots)
 *
 * Every document's pre-image is written to `archetypeBucketMigrationBackup`
 * before it is touched, so the whole run is reversible without a restore.
 *
 * `stateDemographicTurnout.modifiers.voterGroups` is deliberately NOT migrated:
 * an in-flight Governor's Address must come off the same key it went on at
 * expiry, and moving it would make the boost permanent. It expires naturally.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-19-archetype-values-to-buckets.ts [--apply]
 * Defaults to a dry run that reports counts and a sample projection.
 */
import type { Db, ObjectId } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import {
  archetypeValuesToBuckets,
  getUnmappedArchetypeDrops,
  resetUnmappedArchetypeDrops,
} from "../../src/lib/demographics/archetypeBucketMap";
import { isBucketTarget } from "../../src/lib/demographics/turnoutTarget";

const BACKUP_COLLECTION = "archetypeBucketMigrationBackup";

interface Counts {
  scanned: number;
  changed: number;
}

const empty = (): Counts => ({ scanned: 0, changed: 0 });

/** True when every key is already a bucket — nothing to do for this document. */
function alreadyBuckets(values: Record<string, number> | undefined): boolean {
  if (!values) return true;
  const keys = Object.keys(values);
  return keys.length === 0 || keys.every(isBucketTarget);
}

async function backup(db: Db, collection: string, doc: unknown, apply: boolean): Promise<void> {
  if (!apply) return;
  await db.collection(BACKUP_COLLECTION).insertOne({
    collection,
    migratedAt: new Date(),
    preImage: doc,
  });
}

/** Project one collection's top-level `archetypeApprovals` map. */
async function migrateApprovals(db: Db, collection: string, apply: boolean): Promise<Counts> {
  const counts = empty();
  const cursor = db
    .collection(collection)
    .find({ archetypeApprovals: { $exists: true, $ne: {} } })
    .project({ archetypeApprovals: 1, countryId: 1 });

  for await (const doc of cursor) {
    counts.scanned++;
    const values = doc.archetypeApprovals as Record<string, number>;
    if (alreadyBuckets(values)) continue;
    const projected = archetypeValuesToBuckets(values, doc.countryId as string | undefined);
    await backup(db, collection, doc, apply);
    if (apply) {
      await db
        .collection(collection)
        .updateOne({ _id: doc._id }, { $set: { archetypeApprovals: projected } });
    }
    counts.changed++;
  }
  return counts;
}

/**
 * Project `legislationTypes`: policy-option approvals and demographic effects.
 *
 * Population-target effects are DROPPED rather than projected. A bucket's
 * population is the region's raked census marginal, so there is nothing for a
 * bill to move — see `DemographicEffect`'s doc comment. Keeping them would
 * leave targets that resolve to nothing while looking like they resolve.
 */
async function migrateLegislationTypes(db: Db, apply: boolean): Promise<Counts> {
  const counts = empty();
  const cursor = db.collection("legislationTypes").find({
    $or: [
      { "policyOptions.archetypeApprovals": { $exists: true } },
      { "demographicEffects.groupId": { $exists: true } },
    ],
  });

  for await (const doc of cursor) {
    counts.scanned++;
    // Law-type ids are country-prefixed (`us_…`, `uk_…`); anything else is US.
    const prefix = String(doc._id).split("_")[0]?.toUpperCase();
    const countryId = prefix && prefix.length <= 3 ? prefix : undefined;

    let touched = false;
    const options = (doc.policyOptions ?? []) as Array<{
      archetypeApprovals?: Record<string, number>;
    }>;
    const nextOptions = options.map((option) => {
      if (alreadyBuckets(option.archetypeApprovals)) return option;
      touched = true;
      return {
        ...option,
        archetypeApprovals: archetypeValuesToBuckets(option.archetypeApprovals!, countryId),
      };
    });

    const effects = (doc.demographicEffects ?? []) as Array<{
      groupId?: string;
      target?: string;
      direction: number;
      magnitude?: number;
      permanent?: boolean;
    }>;
    const nextEffects: Array<Record<string, unknown>> = [];
    for (const effect of effects) {
      if (!effect.groupId) {
        nextEffects.push(effect);
        continue;
      }
      touched = true;
      if ((effect.target ?? "population") === "population") continue;
      for (const [bucketKey, weight] of Object.entries(
        archetypeValuesToBuckets({ [effect.groupId]: effect.direction }, countryId)
      )) {
        const sep = bucketKey.indexOf(":");
        const { groupId: _dropped, ...rest } = effect;
        nextEffects.push({
          ...rest,
          dim: bucketKey.slice(0, sep),
          bucket: bucketKey.slice(sep + 1),
          direction: weight,
        });
      }
    }

    if (!touched) continue;
    await backup(db, "legislationTypes", doc, apply);
    if (apply) {
      await db
        .collection("legislationTypes")
        .updateOne(
          { _id: doc._id },
          { $set: { policyOptions: nextOptions, demographicEffects: nextEffects } }
        );
    }
    counts.changed++;
  }
  return counts;
}

/**
 * Project `partyGroupFavorability` rows.
 *
 * One archetype row fans out into two or three bucket rows, so this deletes
 * and re-inserts rather than updating in place. Rows for the same
 * (party, state, bucket) are summed, which is what the read path did anyway
 * when it projected them at load time.
 */
async function migrateFavorability(db: Db, apply: boolean): Promise<Counts> {
  const counts = empty();
  const rows = await db.collection("partyGroupFavorability").find({}).toArray();
  const merged = new Map<string, Record<string, unknown>>();
  const legacyIds: ObjectId[] = [];

  for (const row of rows) {
    counts.scanned++;
    const groupId = String(row.groupId ?? "");
    if (!groupId || isBucketTarget(groupId)) continue;
    legacyIds.push(row._id);
    await backup(db, "partyGroupFavorability", row, apply);
    const projected = archetypeValuesToBuckets(
      { [groupId]: Number(row.delta ?? row.value ?? 0) },
      row.countryId as string | undefined
    );
    for (const [bucketId, delta] of Object.entries(projected)) {
      const key = `${row.countryId}|${row.stateId}|${row.partyId}|${bucketId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.delta = (existing.delta as number) + delta;
        continue;
      }
      const { _id: _dropped, ...rest } = row;
      merged.set(key, { ...rest, groupId: bucketId, delta });
    }
    counts.changed++;
  }

  if (apply && legacyIds.length > 0) {
    await db.collection("partyGroupFavorability").deleteMany({ _id: { $in: legacyIds } });
    if (merged.size > 0) {
      await db.collection("partyGroupFavorability").insertMany([...merged.values()]);
    }
  }
  return counts;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();
  resetUnmappedArchetypeDrops();

  console.log(apply ? "Mode: APPLY" : "Mode: dry run (pass --apply to write)");

  const results: Array<[string, Counts]> = [];
  for (const collection of ["characters", "nonPlayerPoliticians", "npps"]) {
    results.push([collection, await migrateApprovals(db, collection, apply)]);
  }
  results.push(["legislationTypes", await migrateLegislationTypes(db, apply)]);
  results.push(["partyGroupFavorability", await migrateFavorability(db, apply)]);

  // Stored poll snapshots are archetype-shaped all the way down and are a
  // cache, not state. The poll route already rebuilds them on demand, so
  // dropping them is cheaper and safer than projecting a display payload.
  const polls = await db.collection("characters").countDocuments({
    $or: [{ lastPoll: { $exists: true } }, { lastPollLarge: { $exists: true } }],
  });
  if (apply && polls > 0) {
    await db
      .collection("characters")
      .updateMany({}, { $unset: { lastPoll: "", lastPollLarge: "" } });
  }
  results.push(["characters.lastPoll (unset)", { scanned: polls, changed: polls }]);

  console.log("\ncollection                      scanned  changed");
  for (const [name, counts] of results) {
    console.log(
      `${name.padEnd(30)} ${String(counts.scanned).padStart(7)} ${String(counts.changed).padStart(8)}`
    );
  }

  const drops = getUnmappedArchetypeDrops();
  if (drops.length > 0) {
    // An id with no mapping in its country's table would be silently zeroed by
    // this migration, which is the failure the whole exercise exists to remove.
    console.log("\nUNMAPPED ids — these values would be LOST, investigate before applying:");
    for (const drop of drops) {
      console.log(`  ${drop.archetypeId}: ${drop.count} values, ${drop.magnitude} magnitude`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nNo unmapped archetype ids: every value projected onto a real bucket.");
  }

  if (apply) console.log(`\nPre-images written to \`${BACKUP_COLLECTION}\`.`);
  await closeDb();
}

void main();
