import { MongoClient } from "mongodb";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("MONGODB_URI_LIVE="));
let uri = line
  .slice("MONGODB_URI_LIVE=".length)
  .trim()
  .replace(/^["']|["']$/g, "");
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db();
const gs = await db.collection("gameState").findOne({ _id: "current" });
const turn = gs?.currentTurn ?? 0;

const actors = await db
  .collection("orgRegLedger")
  .aggregate([
    {
      $match: {
        turn: { $gte: turn - 168 },
        metric: "org",
        source: "action",
        note: "action:build-org",
      },
    },
    { $group: { _id: "$actorId", clicks: { $sum: 1 }, gain: { $sum: "$delta" } } },
  ])
  .toArray();

let playerClicks = 0,
  nppClicks = 0,
  unknownClicks = 0,
  nPlayers = 0,
  nNpps = 0;
for (const a of actors) {
  if (!a._id) {
    unknownClicks += a.clicks;
    continue;
  }
  const ch = await db.collection("characters").findOne({ _id: a._id }, { projection: { _id: 1 } });
  if (ch) {
    playerClicks += a.clicks;
    nPlayers++;
    continue;
  }
  const np = await db.collection("npps").findOne({ _id: a._id }, { projection: { _id: 1 } });
  if (np) {
    nppClicks += a.clicks;
    nNpps++;
  } else unknownClicks += a.clicks;
}
console.log(
  `last 168 turns build-org: players ${playerClicks} clicks (${nPlayers} chars), NPPs ${nppClicks} clicks (${nNpps} npps), unknown ${unknownClicks}`
);

// Characters' campaign funds distribution (for the "character pays" option)
const chars = await db
  .collection("characters")
  .find(
    { countryId: { $in: ["US", "UK", "DE", "DD"] } },
    { projection: { countryId: 1, currencyBalances: 1, name: 1 } }
  )
  .toArray();
const byC = new Map();
for (const c of chars) {
  const v = c.currencyBalances?.campaign ?? 0;
  if (!byC.has(c.countryId)) byC.set(c.countryId, []);
  byC.get(c.countryId).push(v);
}
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
console.log("\n=== CHARACTER CAMPAIGN FUNDS (currencyBalances.campaign) ===");
for (const [c, arr] of byC) {
  console.log(
    `${c}: n=${arr.length} p10=${Math.round(pct(arr, 0.1)).toLocaleString()} med=${Math.round(pct(arr, 0.5)).toLocaleString()} p90=${Math.round(pct(arr, 0.9)).toLocaleString()} max=${Math.round(Math.max(...arr)).toLocaleString()}`
  );
}
await client.close();
