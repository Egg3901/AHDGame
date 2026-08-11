/**
 * Heal a LIVE world's legislation + budgets without a reseed.
 *
 * Why this exists: fourteen 1953 countries (AT/BG/BR/CS/FI/FR/GR/HU/IT/PL/RO/
 * SE/TR/YU) shipped with only revenue/system legislation and no costed spending
 * programmes, so `calculateFederalSpending` fell back to a frozen
 * `baselineSpendingByCategory` every turn and their budgets never responded to
 * politics. The fix is seed-layer, and seed data only applies at bootstrap - so
 * a world created before the fix keeps the old frozen budgets forever.
 *
 * This performs, directly against a live DB, the same two non-destructive steps
 * the admin endpoints do (`POST /api/admin/seed` with targets:
 * ["legislationTypes"], then `POST /api/admin/heal/federal-budgets`), for cases
 * where an authenticated admin session isn't available.
 *
 *   1. Upsert `legislationTypes` by _id, pruning entries no longer in the
 *      reference file but never touching admin-authored custom types
 *      (source: "admin"). Mirrors seedLegislationTypes.
 *   2. Upsert `enactedLaws` from generateDefaultEnactedLaws(preset), matched on
 *      (legislationTypeId, scope, countryId, not-repealed). Mirrors step 1 of
 *      the federal-budgets heal route.
 *
 * It deliberately does NOT recalculate budgets - the next turn's spending sync
 * does that off the enacted laws, and doing it here would duplicate engine
 * logic that already runs.
 *
 * SAFETY. This box hosts the production cluster; production and sandbox share
 * it and are separated only by database NAME. So:
 *   - HEAL_MONGODB_URI and --db are REQUIRED. There is no default and no fallback.
 *   - Dry-run is the default. --apply is required to write.
 *   - Refuses to run against a db whose name doesn't contain "sandbox" unless
 *     --i-understand-this-is-production is passed.
 *   - Verifies gameState.preset matches --preset before writing, because
 *     generateDefaultEnactedLaws is era-specific and the wrong preset would
 *     inject the wrong era's laws.
 *
 * Usage:
 *   HEAL_MONGODB_URI="mongodb://…" npx tsx scripts/heal-sandbox-legislation.ts \
 *     --db=a-house-divided-sandbox --preset=1953-default
 *   …then re-run with --apply once the dry-run output looks right.
 */
import { MongoClient } from "mongodb";

function arg(name: string): string | undefined {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// Read from the environment, NEVER argv. A URI passed as --uri=… is echoed by
// node on a bad-option error, shows up in `ps`, and lands in shell history -
// which is exactly how this script's author leaked a production credential the
// first time round. Pass it as HEAL_MONGODB_URI instead.
const uri = process.env.HEAL_MONGODB_URI;
const dbName = arg("db");
const preset = arg("preset") ?? "1953-default";
const apply = flag("apply");
const overrideProd = flag("i-understand-this-is-production");

if (!uri || !dbName) {
  console.error(
    "Required: HEAL_MONGODB_URI env var and --db=<name>. No defaults - see header.\n" +
      "Do NOT pass the URI on the command line; it leaks via argv, ps and shell history."
  );
  process.exit(1);
}
if (!/sandbox/i.test(dbName) && !overrideProd) {
  console.error(
    `Refusing: db "${dbName}" does not look like a sandbox.\n` +
      `Pass --i-understand-this-is-production to override.`
  );
  process.exit(1);
}

// Importing the seed modules transitively evaluates `@/lib/mongodb`, whose
// getDb() is a global singleton that picks its connection from these env vars
// at first use. They must be set BEFORE those dynamic imports below or the seed
// modules silently connect to localhost instead of the target - the same trap
// documented at the top of scripts/sim/runWorld.ts. NODE_ENV=test skips the
// strict env schema, which demands auth/admin secrets this script has no use for.
(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.MONGODB_URI = uri!;
process.env.MONGODB_DB = dbName!;

async function main() {
  // directConnection: the cluster is a replica set (rs0) reached through a
  // Railway TCP proxy, and its members advertise themselves as
  // localhost:27017. Without this the driver connects through the proxy fine,
  // performs replica-set discovery, then tries to dial the advertised member
  // address and fails with ReplicaSetNoPrimary against localhost.
  const client = new MongoClient(uri!, { directConnection: true });
  await client.connect();
  const db = client.db(dbName!);

  const gs = await db
    .collection<{ _id: string; preset?: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" });
  console.log(`db=${dbName} preset=${gs?.preset} turn=${gs?.currentTurn} apply=${apply}`);

  if (gs?.preset && gs.preset !== preset) {
    console.error(
      `Refusing: world preset is "${gs.preset}" but --preset=${preset}. ` +
        `Enacted-law generation is era-specific; a mismatch injects the wrong era's laws.`
    );
    await client.close();
    process.exit(1);
  }

  // Imported lazily so the safety checks above run before any seed module loads.
  const { seedLegislationTypes } = await import("@/lib/admin/seed/seedLegislationTypes");
  const { generateDefaultEnactedLaws } = await import("@/lib/seeds/reference/budgets");

  // ── 1. legislationTypes ────────────────────────────────────────────────────
  // Call the real seeder rather than reimplementing its upsert+prune. An
  // earlier version of this script duplicated that logic against the raw
  // reference array and MISSED that the seeder is preset-aware: on a
  // political-legislation preset it excludes the old US/UK/RU/DD base types and
  // substitutes projected v2 ones. The naive version's dry run showed "436
  // stale to prune" - exactly 4 x 109, i.e. every political-legislation type
  // belonging to the four PLAYER countries, which it would have replaced with
  // the superseded generation on a live world.
  const typesCol = db.collection("legislationTypes");
  const before = await typesCol.countDocuments();
  console.log(`\nlegislationTypes: ${before} in db before`);

  if (apply) {
    await seedLegislationTypes(db, false, (m: string) => console.log(`  ${m}`), preset);
    console.log(`  now ${await typesCol.countDocuments()} in db`);
  } else {
    console.log(
      `  (dry run - seedLegislationTypes not called; it is upsert+prune, non-destructive)`
    );
  }

  // ── 2. enactedLaws ─────────────────────────────────────────────────────────
  const defaultLaws = generateDefaultEnactedLaws(preset);
  const lawsCol = db.collection("enactedLaws");
  let missing = 0;
  for (const law of defaultLaws) {
    const found = await lawsCol.countDocuments({
      legislationTypeId: law.legislationTypeId,
      scope: law.scope,
      countryId: law.countryId,
      repealedAt: { $exists: false },
    });
    if (found === 0) missing++;
  }
  console.log(
    `\nenactedLaws: ${defaultLaws.length} default laws for ${preset}, ${missing} absent from db`
  );

  if (apply) {
    let inserted = 0;
    for (const law of defaultLaws) {
      const { _id, ...rest } = law;
      const res = await lawsCol.updateOne(
        {
          legislationTypeId: law.legislationTypeId,
          scope: law.scope,
          countryId: law.countryId,
          repealedAt: { $exists: false },
        },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true }
      );
      if (res.upsertedCount > 0) inserted++;
    }
    console.log(`  inserted ${inserted}, updated ${defaultLaws.length - inserted}`);
  }

  // ── Per-country readout: the thing this is actually meant to fix ───────────
  const TARGET = [
    "AT",
    "BG",
    "BR",
    "CS",
    "FI",
    "FR",
    "GR",
    "HU",
    "IT",
    "PL",
    "RO",
    "SE",
    "TR",
    "YU",
  ];
  console.log(`\ncountry  types  costed  enactedLaws`);
  for (const cc of TARGET) {
    const types = await typesCol
      .find({ countryScope: cc.toLowerCase() })
      .project({ budgetCategory: 1 })
      .toArray();
    const costed = types.filter((t) => t.budgetCategory).length;
    const laws = await lawsCol.countDocuments({ countryId: cc, repealedAt: { $exists: false } });
    console.log(
      `${cc.padEnd(7)} ${String(types.length).padStart(5)} ${String(costed).padStart(7)} ` +
        `${String(laws).padStart(12)}`
    );
  }

  if (!apply) console.log(`\nDRY RUN - nothing written. Re-run with --apply.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
