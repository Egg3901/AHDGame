/**
 * READ-ONLY inspection for ticket #885 (Nigeria CF "insufficient funds" +
 * Net/hr overstated). Dumps Brother Hao (char 406) balances, donor level,
 * home state, the NGN/USD exchange rates, and computes the Build Donor Network
 * cost the way the app does, to compare display vs affordability vs balance.
 *
 * NO WRITES. Run: npx tsx scripts/inspect-885-brother-hao.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { getBuildDonorBaseFundCost, getDonorActionCost } from "../src/lib/actions";
import { getGdpBaseline } from "../src/lib/utils/fundGeneration";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

function directUri(uri: string): string {
  return uri.includes("directConnection=") ? uri : `${uri}&directConnection=true`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(directUri(uri));
  await client.connect();
  const db = client.db();

  const char: any =
    (await db.collection("characters").findOne({ sequentialId: 406 })) ??
    (await db.collection("characters").findOne({ name: "Brother Hao" }));
  if (!char) throw new Error("character not found");

  console.log("=== Character ===");
  console.log({
    _id: String(char._id),
    name: char.name,
    countryId: char.countryId,
    homeCurrency: char.homeCurrency,
    homeStateId: char.homeStateId ?? char.stateId,
    donorBaseLevel: char.donorBaseLevel,
    politicalInfluence: char.politicalInfluence,
    funds: char.funds,
    currencyBalances: char.currencyBalances,
  });

  const stateId = char.homeStateId ?? char.stateId;
  const state: any = stateId ? await db.collection("states").findOne({ _id: stateId }) : null;
  console.log("\n=== Home state ===");
  console.log(
    state
      ? { _id: String(state._id), name: state.name, gdp: state.gdp, population: state.population }
      : "NO STATE"
  );

  const rates: any[] = await db
    .collection("exchangeRates")
    .find({ currencyCode: { $in: ["NGN", "USD"] } })
    .toArray();
  console.log("\n=== Exchange rates ===");
  for (const r of rates) console.log({ currencyCode: r.currencyCode, rate: r.rate });
  const ngn = rates.find((r) => r.currencyCode === "NGN")?.rate ?? 1;

  // Recreate the app's cost math.
  const cid = char.countryId ?? "NG";
  const donorLevel = char.donorBaseLevel ?? 0;
  const gdp = state?.gdp ?? getGdpBaseline(cid);
  const pop = state?.population ?? 1_000_000;
  const anchorCost = getBuildDonorBaseFundCost(donorLevel, gdp, pop, cid);
  const apCost = getDonorActionCost(donorLevel, "buildDonorBase");

  console.log("\n=== Build Donor Network cost ===");
  console.log({
    donorLevel,
    apCost,
    anchorCost_USD: anchorCost,
    ngnRate: ngn,
    localCost_NGN: Math.round(anchorCost * ngn),
    campaignBalance_NGN: char.currencyBalances?.campaign ?? char.funds,
  });
  const balance = char.currencyBalances?.campaign ?? char.funds ?? 0;
  console.log("\naffordable (balance >= anchorCost*rate)?", balance >= anchorCost * ngn);
  console.log(
    "would-be-insufficient if balance compared against DOUBLE-converted cost?",
    balance < anchorCost * ngn * ngn
  );

  console.log("\n(Read-only — no writes.)");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
