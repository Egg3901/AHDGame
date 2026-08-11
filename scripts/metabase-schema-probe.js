require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, { directConnection: true, maxPoolSize: 2 });

const collections = [
  "gameState",
  "commodityPrices",
  "commodityPriceHistory",
  "centralBanks",
  "exchangeRates",
  "federalBudget",
  "users",
  "characters",
  "activityLog",
  "siteTrafficPageviews",
  "politicalParties",
  "nationalPartyElections",
  "statePartyElections",
  "elections",
  "electedOfficials",
  "congressLeaders",
  "statePartyOrg",
  "corporations",
  "corporationHistory",
  "corporateSectors",
  "stockExchangeSnapshots",
  "shareTradeHistory",
  "suspiciousCharacters",
  "bannedIps",
  "treasuryTransactions",
  "adminLogs",
  "modAuditLog",
  "botApiRequestLog",
  "gameConfig",
];

async function getSchema(coll) {
  const sample = await coll.find({}).limit(3).toArray();
  const keys = new Set();
  for (const doc of sample) {
    Object.keys(doc).forEach((k) => keys.add(k));
  }
  return { sample, keys: Array.from(keys) };
}

async function run() {
  await client.connect();
  const db = client.db("a-house-divided");
  const result = {};
  for (const name of collections) {
    try {
      const coll = db.collection(name);
      const count = await coll.estimatedDocumentCount();
      const { sample, keys } = await getSchema(coll);
      result[name] = { count, keys, sample };
    } catch (e) {
      result[name] = { error: e.message };
    }
  }
  console.log(JSON.stringify(result, null, 2));
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
