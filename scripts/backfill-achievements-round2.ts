/**
 * One-time achievement backfill for Beta 2 veterans and current active players.
 *
 * Idempotent: awardAchievement returns false when the account already owns a grant.
 * Usage: MONGODB_URI="..." npx tsx scripts/backfill-achievements-round2.ts
 */
import { MongoClient, ObjectId } from "mongodb";
import { awardAchievement } from "@/lib/achievements";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not set");

async function awardAll(userIds: ObjectId[], slug: string) {
  let awarded = 0;
  let alreadyHad = 0;
  for (const userId of userIds) {
    if (await awardAchievement(userId, slug)) awarded++;
    else alreadyHad++;
  }
  return { awarded, alreadyHad };
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();

  const beta2UserIds = (await db.collection("retiredCharacters").distinct("userId", {
    iteration: { type: "Beta", number: 2 },
  })) as ObjectId[];
  const activeUserIds = (await db.collection("characters").distinct("userId")) as ObjectId[];

  const beta2 = await awardAll(beta2UserIds, "beta2_veteran");
  const founders = await awardAll(activeUserIds, "iteration4_founder");

  console.log(`Beta 2 Veteran: ${beta2.awarded} awarded, ${beta2.alreadyHad} already had it.`);
  console.log(
    `Iteration 4 Founder: ${founders.awarded} awarded, ${founders.alreadyHad} already had it.`
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
