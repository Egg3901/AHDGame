/**
 * One-time migration: add laborParticipation and matchingFriction metrics
 * to all stateMetrics documents. These are the policy-targetable drivers
 * that feed the unemployment derivation pipeline.
 *
 * Defaults: laborParticipation = 63%, matchingFriction = 5%
 *
 * Usage: npx tsx scripts/migrations/seed-labor-market-metrics.ts
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

async function main() {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Only update docs that don't already have the fields (idempotent)
  const result = await db.collection("stateMetrics").updateMany(
    { "economic.laborParticipation": { $exists: false } },
    {
      $set: {
        "economic.laborParticipation": { value: 63 },
        "economic.matchingFriction": { value: 5 },
      },
    }
  );

  console.log(`Updated ${result.modifiedCount} stateMetrics documents with labor market metrics`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
