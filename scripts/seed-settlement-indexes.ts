/**
 * Ensure the settlement-crisis indexes exist on a running world.
 *
 * WHY THIS EXISTS SEPARATELY. `seedIndexes` runs inside bootstrap and reset,
 * which is fine for a world being built from scratch — but the German Question
 * ships to worlds that are already running and will never be reset. Those
 * worlds need the four indexes and nothing else, and the whole-world seeders
 * are far too big a hammer for that.
 *
 * The one that MATTERS is `settlementCrises { kind }` UNIQUE, partial on
 * `status: "open"`. It is not a performance index: it is the guard that stops
 * two admins pressing Open at once from creating two live crises, which would
 * both tick. Open the question before this exists and that guard is simply
 * absent.
 *
 * Idempotent — `createIndex` is, and `ensureIndex` additionally tolerates an
 * index that already exists under a different name. Safe to re-run.
 *
 * Targets MONGODB_URI (testing) unless `--live` is passed.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import { seedSettlementIndexes } from "../src/lib/admin/seed/seedIndexes";

dotenv.config({ path: ".env.local" });

const live = process.argv.includes("--live");

async function main() {
  const uri = live ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
  if (!uri) throw new Error(live ? "MONGODB_URI_LIVE is not set" : "MONGODB_URI is not set");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  try {
    console.log(`Target: ${live ? "LIVE (MONGODB_URI_LIVE)" : "testing (MONGODB_URI)"}`);
    console.log(`Database: ${db.databaseName}\n`);

    await seedSettlementIndexes(db, (msg) => console.log(msg));

    // Read them back. `createIndex` succeeding is not quite the same as the
    // index being there with the options asked for — a pre-existing index of
    // the same name and different options is the case that bites.
    console.log("\nVerifying:");
    for (const collection of ["settlementCrises", "settlementPlays"]) {
      const indexes = await db
        .collection(collection)
        .indexes()
        .catch(() => []);
      for (const index of indexes) {
        const flags = [
          index.unique ? "UNIQUE" : null,
          index.partialFilterExpression
            ? `partial ${JSON.stringify(index.partialFilterExpression)}`
            : null,
        ].filter(Boolean);
        console.log(
          `  ${collection}.${index.name} ${JSON.stringify(index.key)}` +
            (flags.length > 0 ? `  [${flags.join(", ")}]` : "")
        );
      }
    }

    const guard = (
      await db
        .collection("settlementCrises")
        .indexes()
        .catch(() => [])
    ).find((i) => i.unique === true && i.partialFilterExpression != null);
    console.log(
      guard
        ? "\nOK — the double-open guard is in place."
        : "\nWARNING — the unique partial index on settlementCrises is MISSING. " +
            "Two admins pressing Open at once could create two live crises."
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
