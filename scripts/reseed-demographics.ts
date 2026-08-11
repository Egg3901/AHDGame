// @ts-nocheck
/**
 * Re-derives all US state demographics from updated Layer-1 seed configs
 * and writes them to the stateDemographics + demographicCategories collections.
 * Run with: npx tsx scripts/reseed-demographics.ts
 */
import * as fs from "fs";
import { MongoClient } from "mongodb";
import { stateDemographics } from "../src/lib/seeds/stateDemographics";
import { demographicCategories } from "../src/lib/seeds/demographicCategories";

const envLocal = fs.readFileSync(".env.local", "utf8");
const uriMatch = envLocal.match(/MONGODB_URI=(.+)/);
if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
const uri = uriMatch[1].trim();

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  const col = (name: string) => db.collection(name) as any;

  // 1. Update demographicCategories collection
  for (const cat of demographicCategories) {
    await col("demographicCategories").replaceOne(
      { _id: cat._id },
      cat as Record<string, unknown>,
      { upsert: true }
    );
  }
  console.log("✓ demographicCategories updated");

  // 2. Update stateDemographics collection
  let count = 0;
  for (const demo of stateDemographics) {
    await col("stateDemographics").replaceOne(
      { _id: demo._id },
      { ...demo, lastUpdated: new Date() },
      { upsert: true }
    );
    count++;
  }
  console.log(`✓ stateDemographics updated: ${count} states`);

  // 3. Recompute cachedEconomicLean / cachedSocialLean for each state
  //    EP/SP = population-share weighted average of group leans
  let statesUpdated = 0;
  for (const demo of stateDemographics) {
    const groups = Object.values(demo.groups) as Array<{
      population: number;
      economicLean: number;
      socialLean: number;
    }>;
    const totalPop = groups.reduce((s, g) => s + g.population, 0);
    const ep = groups.reduce((s, g) => s + (g.economicLean * g.population) / totalPop, 0);
    const sp = groups.reduce((s, g) => s + (g.socialLean * g.population) / totalPop, 0);

    await col("states").updateOne(
      { _id: demo._id, countryId: "US" },
      {
        $set: {
          cachedEconomicLean: Math.round(ep * 100) / 100,
          cachedSocialLean: Math.round(sp * 100) / 100,
          demographicsLastUpdated: new Date(),
        },
      }
    );
    statesUpdated++;
  }
  console.log(`✓ states cachedLean updated: ${statesUpdated} states`);

  // 4. Print new national center
  const states = await col("states")
    .find(
      { countryId: "US" },
      {
        projection: {
          _id: 1,
          population: 1,
          cachedEconomicLean: 1,
          cachedSocialLean: 1,
          houseDistricts: 1,
        },
      }
    )
    .toArray();

  const totalPop = states.reduce((s, st) => s + (st.population as number), 0);
  const wEP =
    states.reduce((s, st) => s + (st.cachedEconomicLean as number) * (st.population as number), 0) /
    totalPop;
  const wSP =
    states.reduce((s, st) => s + (st.cachedSocialLean as number) * (st.population as number), 0) /
    totalPop;

  const demEV = states
    .filter((s) => (s.cachedEconomicLean as number) < 0)
    .reduce((a, s) => a + (s.houseDistricts as number) + 2, 0);
  const repEV = states
    .filter((s) => (s.cachedEconomicLean as number) > 0)
    .reduce((a, s) => a + (s.houseDistricts as number) + 2, 0);
  const neutEV = states
    .filter((s) => (s.cachedEconomicLean as number) === 0)
    .reduce((a, s) => a + (s.houseDistricts as number) + 2, 0);

  console.log("\n── Results ──");
  console.log(`Pop-weighted EP: ${wEP.toFixed(3)}  SP: ${wSP.toFixed(3)}`);
  console.log(`EV split — Dem: ${demEV}  Rep: ${repEV}  Neutral: ${neutEV}`);

  // Print swing states
  const sorted = [...states].sort(
    (a, b) => (a.cachedEconomicLean as number) - (b.cachedEconomicLean as number)
  );
  console.log("\nSwing corridor (EP -0.5 to +0.5):");
  sorted
    .filter((s) => Math.abs(s.cachedEconomicLean as number) <= 0.5)
    .forEach((s) =>
      console.log(
        `  ${s._id}  EP: ${s.cachedEconomicLean}  EV: ${(s.houseDistricts as number) + 2}`
      )
    );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
