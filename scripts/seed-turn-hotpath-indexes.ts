/** Inspect or install the turn hot-path indexes on an existing world.
 *
 * Dry run by default. Pass --apply to create missing indexes. Uses MONGODB_URI;
 * load the intended environment explicitly before invoking this script.
 */
import { MongoClient } from "mongodb";
import {
  TURN_HOT_PATH_INDEXES,
  seedTurnHotPathIndexes,
} from "../src/lib/admin/seed/indexes/turnHotPath";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const apply = process.argv.includes("--apply");
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db();
    console.log(`${apply ? "Apply" : "Dry run"}: ${db.databaseName}`);
    for (const { collection, key, name } of TURN_HOT_PATH_INDEXES) {
      const existing = await db
        .collection(collection)
        .indexes()
        .catch(() => []);
      const found = existing.find((index) => JSON.stringify(index.key) === JSON.stringify(key));
      console.log(`${collection}.${name}: ${found ? `present (${found.name})` : "missing"}`);
    }
    if (!apply) return;

    await seedTurnHotPathIndexes(db, console.log);
    for (const { collection, key, name } of TURN_HOT_PATH_INDEXES) {
      const existing = await db.collection(collection).indexes();
      if (!existing.some((index) => JSON.stringify(index.key) === JSON.stringify(key))) {
        throw new Error(`Index still missing after apply: ${collection}.${name}`);
      }
    }
    console.log("All turn hot-path indexes verified");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
