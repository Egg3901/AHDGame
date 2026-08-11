/**
 * One-off cleanup for "Nippon move stuff fast asf" (#116).
 *
 * Its sole shareholder (also the CEO) is a hard-deleted character whose _id no
 * longer exists in `characters`, `retiredCharacters`, or `users`. Self-delete
 * did not cascade the shares to publicFloat. This moves those orphaned shares
 * to publicFloat so the stake returns to the open market. The CEO field is
 * NOT touched here — the permanent fix (in the delete-account flow) handles
 * future cases, and ceoVacant on historical corps can be healed separately.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import type { Corporation, Shareholder } from "../../src/lib/db/types/corporation";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

const EXPECTED_CORP_SEQUENTIAL_ID = 116;
const EXPECTED_CORP_OID = "69df6388a5ebb7bc99aef57e";
const EXPECTED_GHOST_CHARACTER_ID = "69dd385587b450bfccbc6617";
const EXPECTED_SHARES = 10236229;

async function main() {
  const execute = process.argv.includes("--execute");
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const corps = db.collection<Corporation>("corporations");
  const corpOid = new ObjectId(EXPECTED_CORP_OID);
  const ghostOid = new ObjectId(EXPECTED_GHOST_CHARACTER_ID);

  const before = await corps.findOne({ _id: corpOid });
  if (!before) {
    console.error(`Corporation ${EXPECTED_CORP_OID} not found`);
    await client.close();
    process.exit(1);
  }

  // Safety guards — abort if state drifted from expected
  if (before.sequentialId !== EXPECTED_CORP_SEQUENTIAL_ID) {
    console.error(
      `Expected sequentialId=${EXPECTED_CORP_SEQUENTIAL_ID}, got ${before.sequentialId}`
    );
    await client.close();
    process.exit(1);
  }
  const ghostEntry = (before.shareholders ?? []).find(
    (sh: Shareholder) => sh.characterId?.toString() === EXPECTED_GHOST_CHARACTER_ID
  );
  if (!ghostEntry) {
    console.error(
      `Ghost shareholder ${EXPECTED_GHOST_CHARACTER_ID} not present in corp #${before.sequentialId} — already cleaned?`
    );
    await client.close();
    process.exit(1);
  }
  if (ghostEntry.shares !== EXPECTED_SHARES) {
    console.error(
      `Ghost shareholder shares=${ghostEntry.shares}, expected ${EXPECTED_SHARES} — state drifted, aborting`
    );
    await client.close();
    process.exit(1);
  }
  if (before.shareholders.length !== 1) {
    console.error(
      `Expected exactly 1 shareholder, found ${before.shareholders.length} — state drifted, aborting`
    );
    await client.close();
    process.exit(1);
  }

  // Reconfirm the character is truly hard-deleted
  const stillAlive =
    (await db.collection("characters").findOne({ _id: ghostOid })) ||
    (await db.collection("retiredCharacters").findOne({ _id: ghostOid }));
  if (stillAlive) {
    console.error(
      `Character ${EXPECTED_GHOST_CHARACTER_ID} still exists (characters or retiredCharacters) — aborting`
    );
    await client.close();
    process.exit(1);
  }

  console.log("=== BEFORE ===");
  console.log(`  ${before.name} (#${before.sequentialId})`);
  console.log(`  totalShares=${before.totalShares}`);
  console.log(`  publicFloat=${before.publicFloat ?? 0}`);
  console.log(`  shareholders=${before.shareholders.length}`);
  console.log(`    ghost(${EXPECTED_GHOST_CHARACTER_ID}) shares=${ghostEntry.shares}`);
  console.log(
    `  ceoId=${before.ceoId?.toString()} ceoVacant=${before.ceoVacant}  <-- NOT changed by this script`
  );

  const sharesToRelease = ghostEntry.shares;
  console.log(`\nProposed update:`);
  console.log(`  $pull shareholders entry for characterId=${EXPECTED_GHOST_CHARACTER_ID}`);
  console.log(`  $inc publicFloat by +${sharesToRelease}`);
  console.log(`  resulting publicFloat = ${(before.publicFloat ?? 0) + sharesToRelease}`);

  if (!execute) {
    console.log(`\nDRY RUN — pass --execute to apply`);
    await client.close();
    return;
  }

  const result = await corps.updateOne(
    { _id: corpOid, "shareholders.characterId": ghostOid, "shareholders.shares": sharesToRelease },
    {
      $pull: { shareholders: { characterId: ghostOid } },
      $inc: { publicFloat: sharesToRelease },
    }
  );

  console.log(`\n=== UPDATE RESULT ===`);
  console.log(`  matchedCount=${result.matchedCount} modifiedCount=${result.modifiedCount}`);
  if (result.modifiedCount !== 1) {
    console.error(`  Unexpected modifiedCount — check DB state manually`);
    await client.close();
    process.exit(1);
  }

  const after = await corps.findOne({ _id: corpOid });
  console.log(`\n=== AFTER ===`);
  console.log(`  totalShares=${after?.totalShares}`);
  console.log(`  publicFloat=${after?.publicFloat}`);
  console.log(`  shareholders.length=${after?.shareholders?.length ?? 0}`);
  const invariantOk =
    (after?.publicFloat ?? 0) +
      (after?.shareholders?.reduce((s: number, sh: Shareholder) => s + (sh.shares ?? 0), 0) ??
        0) ===
    after?.totalShares;
  console.log(`  publicFloat + Σshareholders == totalShares: ${invariantOk}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
