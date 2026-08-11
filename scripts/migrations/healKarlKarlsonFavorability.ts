/**
 * One-off heal for Karl Karlsson, affected by the `favorability || 50` bug
 * in simpleInfluence.ts.
 *
 * Why: 145 successful attacks (each -1 favorability) were logged against
 * Karl. Starting from 50, favorability should have bottomed at 0, but the
 * `|| 50` fallback bounced his stored value to 49 every time it hit zero.
 *
 * Action: set `favorability` to 0 — the value the game mechanic should have
 * produced. Writes a single update, does not touch anyone else.
 *
 * Usage: MONGODB_URI_LIVE must be set in .env.local
 *   npx tsx scripts/migrations/healKarlKarlsonFavorability.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

// Karl Karlsson's _id — looked up via scripts/debug/inspect-karl-karlson.ts.
const KARL_ID_HEX = "69d9eab809b38a5046671a43";
const KARL_NAME = "Karl Karlsson";
const TARGET_FAVORABILITY = 0;

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const { ObjectId } = await import("mongodb");
  const _id = new ObjectId(KARL_ID_HEX);

  const before = await db
    .collection("characters")
    .findOne({ _id }, { projection: { name: 1, favorability: 1 } });

  if (!before) {
    console.error(`Character ${KARL_NAME} (${KARL_ID_HEX}) not found`);
    await client.close();
    process.exit(1);
  }
  if (before.name !== KARL_NAME) {
    console.error(
      `Safety check failed: _id ${KARL_ID_HEX} resolves to "${before.name}", expected "${KARL_NAME}"`
    );
    await client.close();
    process.exit(1);
  }

  console.log(`Before: ${before.name} favorability=${before.favorability}`);

  const result = await db
    .collection("characters")
    .updateOne(
      { _id, name: KARL_NAME },
      { $set: { favorability: TARGET_FAVORABILITY, updatedAt: new Date() } }
    );

  console.log(`Update: matched=${result.matchedCount} modified=${result.modifiedCount}`);

  const after = await db
    .collection("characters")
    .findOne({ _id }, { projection: { name: 1, favorability: 1 } });
  console.log(`After:  ${after?.name} favorability=${after?.favorability}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
