/**
 * Phase 3: probe whether Rubio/Voss character documents are complete on the
 * live DB, and whether enrichElection would produce defaults for them.
 *
 * Pure read.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE not set");

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  // Active GOP candidates
  const election = await db.collection("elections").findOne({
    countryId: "US",
    electionType: "president",
    status: "active",
  });
  const candidates = await db
    .collection("electionCandidates")
    .find({ electionId: election!._id, party: "2", status: "active" })
    .toArray();

  console.log(`Active GOP candidates: ${candidates.length}`);

  // For each, fetch the character document and dump full record
  for (const c of candidates) {
    console.log(`\n--- Candidate ${c._id} (characterName=${c.characterName}) ---`);
    console.log(
      `  primaryCampaignState=${c.primaryCampaignState}  ticks=${c.primaryCampaignTicks}`
    );
    console.log(`  candidate.createdAt=${c.createdAt?.toISOString?.()}`);
    if (!c.characterId) {
      console.log(`  no characterId on candidate doc`);
      continue;
    }
    const ch: any = await db.collection("characters").findOne({ _id: c.characterId });
    if (!ch) {
      console.log(`  character ${c.characterId} NOT FOUND in characters collection`);
      continue;
    }
    console.log(`  character _id=${ch._id} type=${ch._id?.constructor?.name}`);
    console.log(
      `  firstName=${JSON.stringify(ch.firstName)}  lastName=${JSON.stringify(ch.lastName)}`
    );
    console.log(
      `  favorability=${ch.favorability}  politicalInfluence=${ch.politicalInfluence}  nationalInfluence=${ch.nationalInfluence}`
    );
    console.log(`  policies=${JSON.stringify(ch.policies)}`);
    console.log(
      `  archetypeApprovals: ${ch.archetypeApprovals ? Object.keys(ch.archetypeApprovals).length + " entries" : "(undefined)"}`
    );
    console.log(`  homeState=${ch.homeState}  countryId=${ch.countryId}  party=${ch.party}`);
    console.log(
      `  createdAt=${ch.createdAt?.toISOString?.()}  updatedAt=${ch.updatedAt?.toISOString?.()}`
    );

    // Show ALL top-level keys + types so we can see what's missing
    const keys = Object.keys(ch);
    console.log(`  all character keys (${keys.length}): ${keys.join(", ")}`);
  }

  // Tally: when was it created? When was it last updated?
  const tally = await db.collection("electionVoteTallies").findOne({ electionId: election!._id });
  console.log(`\n--- Tally meta ---`);
  console.log(`  createdAt=${tally?.createdAt?.toISOString?.()}`);
  console.log(`  updatedAt=${tally?.updatedAt?.toISOString?.()}`);

  // Check the entire wave history doc structure
  console.log(`\n--- primaryWaveHistory raw ---`);
  console.log(JSON.stringify(tally?.primaryWaveHistory, null, 2));

  // Election update history
  const electionRefetch = await db.collection("elections").findOne({ _id: election!._id });
  console.log(`\n--- election doc createdAt/updatedAt ---`);
  console.log(`  createdAt=${electionRefetch?.createdAt?.toISOString?.()}`);
  console.log(`  updatedAt=${electionRefetch?.updatedAt?.toISOString?.()}`);
  console.log(`  primaryEndTime=${electionRefetch?.primaryEndTime?.toISOString?.()}`);

  // Look at gameState for currentTurn / fastMode / etc.
  const gs = await db.collection<{ _id: string }>("gameState").findOne({ _id: "current" });
  console.log(`\n--- gameState ---`);
  console.log(JSON.stringify(gs, null, 2));

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
