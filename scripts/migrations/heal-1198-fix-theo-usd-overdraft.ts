/**
 * Corrective follow-up to heal-1198-corp624-bond-rewind.
 *
 * The rewind clawed back A709.375 of USD coupon from Theo Streibl (#42), but he
 * held only $5.00 in USD — his wealth is in GBP — so the debit left
 * `currencyBalances.personal.USD` at -704.375. The rewind's solvency guard
 * missed it because under `forexEnabled` the balance lives in
 * `currencyBalances.personal.<CCY>`, while the guard was reading `cashOnHand`.
 *
 * This does NOT forgive the debt: it settles the overdraft out of the GBP he
 * actually holds, at live rates, so the reversal stays complete AND no player is
 * left with a negative balance. Nothing is minted and nothing is written off.
 *
 *   npx tsx scripts/migrations/heal-1198-fix-theo-usd-overdraft.ts
 *   npx tsx scripts/migrations/heal-1198-fix-theo-usd-overdraft.ts --apply
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const THEO = new ObjectId("6a77b93818e42bc9dfb15e96");

async function main() {
  const uri = process.env.MONGODB_URI_LIVE!;
  const client = new MongoClient(
    uri.includes("directConnection")
      ? uri
      : uri + (uri.includes("?") ? "&" : "?") + "directConnection=true",
    { serverSelectionTimeoutMS: 30_000 }
  );
  await client.connect();
  const db = client.db("a-house-divided");

  const rates = await db.collection("exchangeRates").find({}).toArray();
  const rate = new Map(rates.map((r) => [r.currencyCode as string, r.rate as number]));
  const usdRate = rate.get("USD")!;
  const gbpRate = rate.get("GBP")!;

  const doc = (await db.collection("characters").findOne({ _id: THEO })) as {
    name?: string;
    currencyBalances?: { personal?: Record<string, number> };
  } | null;
  if (!doc) throw new Error("Theo Streibl not found");
  const personal = doc.currencyBalances?.personal ?? {};
  const usd = personal.USD ?? 0;
  const gbp = personal.GBP ?? 0;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${doc.name}`);
  console.log(`   USD ${usd}   GBP ${gbp}`);

  if (usd >= 0) {
    console.log("   USD is not negative; nothing to do.");
    await client.close();
    return;
  }

  const overdraftUsd = -usd;
  const overdraftAnchor = overdraftUsd / usdRate;
  const gbpDebit = overdraftAnchor * gbpRate;

  console.log(
    `   overdraft ${overdraftUsd} USD = A${overdraftAnchor.toFixed(2)} = ${gbpDebit.toFixed(2)} GBP`
  );
  console.log(`   -> USD ${usd} -> 0`);
  console.log(`   -> GBP ${gbp} -> ${(gbp - gbpDebit).toFixed(2)}`);

  if (gbp - gbpDebit < 0) throw new Error("GBP would go negative — aborting");

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written.");
    await client.close();
    return;
  }

  const res = await db.collection("characters").updateOne(
    { _id: THEO },
    {
      $inc: {
        "currencyBalances.personal.USD": overdraftUsd,
        "currencyBalances.personal.GBP": -gbpDebit,
      },
    }
  );
  console.log(`\nAPPLIED: modified ${res.modifiedCount}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
