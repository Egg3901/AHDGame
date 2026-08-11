/**
 * One-off: grant Corporation 290 (BlackRock) +$8,000,000 in liquidCapital.
 *
 * Mutation mirrors src/app/api/admin/corporations/[id]/capital/route.ts:39-44:
 *
 *     corporations.updateOne({ _id }, {
 *       $inc: { liquidCapital: <amountInCorpCapital> },
 *       $set: { updatedAt: <now> },
 *     })
 *
 * The admin route accepts amount in anchor units (₳) and converts to the
 * corp's home currency via anchorToCorpLiquidCapital. BlackRock is a US
 * corporation; USD is the anchor for US corps, so the conversion is 1:1
 * and we can pass $8,000,000 directly.
 *
 * Safety guards (abort on drift):
 *   - corp.sequentialId === 290
 *   - corp.name === "BlackRock"
 *   - corp.countryId === "US"
 *   - corp.liquidCurrencyCode is "USD" or absent (pre-forex corps treated as USD,
 *     per src/lib/db/types/corporation.ts:60-64)
 *
 * Runs against MONGODB_URI_LIVE. Dry-run by default; pass --execute to apply.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

const EXPECTED_CORP_SEQ = 290;
const EXPECTED_CORP_NAME = "BlackRock";
const EXPECTED_CORP_COUNTRY = "US";
const GRANT_AMOUNT_USD = 8_000_000;

interface CorpDoc {
  _id: ObjectId;
  sequentialId?: number;
  name?: string;
  countryId?: string;
  liquidCapital?: number;
  liquidCurrencyCode?: string;
}

function abort(client: MongoClient, msg: string): never {
  console.error(`\nABORT: ${msg}`);
  void client.close();
  process.exit(1);
}

function fmt(n: number | undefined): string {
  if (n == null) return "(unset)";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function main() {
  const execute = process.argv.includes("--execute");
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");
  const corps = db.collection<CorpDoc>("corporations");

  const corp = await corps.findOne({ sequentialId: EXPECTED_CORP_SEQ });
  if (!corp) abort(client, `Corp #${EXPECTED_CORP_SEQ} not found`);
  if ((corp!.name ?? "").trim() !== EXPECTED_CORP_NAME) {
    abort(client, `name="${corp!.name}", expected "${EXPECTED_CORP_NAME}"`);
  }
  if (corp!.countryId !== EXPECTED_CORP_COUNTRY) {
    abort(client, `countryId="${corp!.countryId}", expected "${EXPECTED_CORP_COUNTRY}"`);
  }
  const cc = corp!.liquidCurrencyCode;
  if (cc !== undefined && cc !== "USD") {
    abort(
      client,
      `liquidCurrencyCode="${cc}", expected "USD" or absent — refusing to add USD-denominated grant to non-USD treasury`
    );
  }

  console.log("=== BEFORE ===");
  console.log(`  #${corp!.sequentialId} ${corp!.name}  (${corp!.countryId})`);
  console.log(
    `  liquidCapital = ${fmt(corp!.liquidCapital)}  liquidCurrencyCode = ${cc ?? "(unset, treated as USD)"}`
  );

  console.log(`\n=== PROPOSED ===`);
  console.log(`  +${fmt(GRANT_AMOUNT_USD)} USD`);
  console.log(`  new liquidCapital = ${fmt((corp!.liquidCapital ?? 0) + GRANT_AMOUNT_USD)}`);

  if (!execute) {
    console.log(`\nDRY RUN — pass --execute to apply`);
    await client.close();
    return;
  }

  const now = new Date();
  const result = await corps.updateOne(
    { _id: corp!._id },
    {
      $inc: { liquidCapital: GRANT_AMOUNT_USD },
      $set: { updatedAt: now },
    }
  );

  console.log(`\n=== UPDATE RESULT ===`);
  console.log(`  matched=${result.matchedCount}  modified=${result.modifiedCount}`);
  if (result.matchedCount !== 1) {
    abort(client, `Unexpected matchedCount=${result.matchedCount}`);
  }

  const after = await corps.findOne({ _id: corp!._id });
  console.log(`\n=== AFTER ===`);
  console.log(`  liquidCapital = ${fmt(after?.liquidCapital)}`);
  const expected = (corp!.liquidCapital ?? 0) + GRANT_AMOUNT_USD;
  const ok = Math.abs((after?.liquidCapital ?? 0) - expected) < 0.01;
  console.log(`  matches expected (${fmt(expected)}): ${ok}`);
  if (!ok) abort(client, "Post-state mismatch — investigate");

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
