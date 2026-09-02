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
const W = 168;

// Mirror of TREASURY_PS_RATE_BY_COUNTRY for the active countries.
const RATE = {
  US: { national: 75000, state: 37500 },
  UK: { national: 60000, state: 30000 },
  DD: { national: 90000, state: 45000 },
  RU: { national: 500000, state: 250000 },
  DE: { national: 70000, state: 35000 },
};
const fmt = (n) => Math.round(n).toLocaleString("en-US");

// Per (country,party): build-org clicks + total PS paid, from the PS ledger.
const spends = await db
  .collection("partyPoliticalStrengthLedger")
  .aggregate([
    { $match: { turn: { $gte: turn - W }, action: "build-org" } },
    {
      $group: {
        _id: { c: "$countryId", p: "$partyId" },
        clicks: { $sum: 1 },
        ps: { $sum: { $abs: "$delta" } },
      },
    },
    { $sort: { clicks: -1 } },
  ])
  .toArray();

// Inflow per (country,party) split by holder tier.
const inflow = await db
  .collection("treasuryTransactions")
  .aggregate([
    { $match: { turn: { $gte: turn - W }, direction: "credit" } },
    {
      $group: {
        _id: { c: "$countryId", p: "$partyId", h: "$holderType" },
        total: { $sum: "$amount" },
      },
    },
  ])
  .toArray();
const inflowMap = new Map();
for (const r of inflow) inflowMap.set(`${r._id.c}:${r._id.p}:${r._id.h}`, r.total);

const parties = await db
  .collection("politicalParties")
  .find({}, { projection: { countryId: 1, abbreviation: 1, sequentialId: 1, treasury: 1 } })
  .toArray();
const spo = await db
  .collection("statePartyOrg")
  .find({}, { projection: { countryId: 1, partyId: 1, treasury: 1 } })
  .toArray();
const spoTreasury = new Map();
for (const r of spo) {
  const k = `${r.countryId}:${r.partyId}`;
  spoTreasury.set(k, (spoTreasury.get(k) ?? 0) + (r.treasury ?? 0));
}

console.log(
  `Cash cost of the LAST ${W} TURNS of build-org, at fraction F, vs that party's treasury + ${W}-turn inflow.\n` +
    `price = RATE[country][scope] x F x effectivePsCost, so total = RATE x F x (total PS paid).\n`
);
for (const F of [0.5, 0.25, 0.1, 0.05]) {
  console.log(`\n===== ORG_BUILD_TREASURY_FRACTION = ${F} =====`);
  console.log(
    "party            clicks   PS     cost@national   cost@state   natTreasury   natInflow/168t   stateTreasury   stateInflow/168t"
  );
  for (const s of spends.slice(0, 12)) {
    const c = s._id.c;
    const rate = RATE[c];
    if (!rate) continue;
    const p = parties.find((x) => x.countryId === c && String(x.sequentialId) === String(s._id.p));
    const costNat = rate.national * F * s.ps;
    const costState = rate.state * F * s.ps;
    const natT = p?.treasury ?? 0;
    const natIn = inflowMap.get(`${c}:${s._id.p}:party`) ?? 0;
    const stT = spoTreasury.get(`${c}:${s._id.p}`) ?? 0;
    const stIn = inflowMap.get(`${c}:${s._id.p}:state_party`) ?? 0;
    console.log(
      `${(c + " " + (p?.abbreviation ?? s._id.p)).padEnd(16)} ${String(s.clicks).padStart(5)} ${String(s.ps).padStart(6)} ${fmt(costNat).padStart(15)} ${fmt(costState).padStart(12)} ${fmt(natT).padStart(13)} ${fmt(natIn).padStart(16)} ${fmt(stT).padStart(15)} ${fmt(stIn).padStart(18)}`
    );
  }
}

console.log("\n=== SUSTAINABILITY: cost as a share of 168-turn inflow ===");
for (const F of [0.5, 0.25, 0.1, 0.05]) {
  const lines = [];
  for (const s of spends.slice(0, 12)) {
    const rate = RATE[s._id.c];
    if (!rate) continue;
    const p = parties.find(
      (x) => x.countryId === s._id.c && String(x.sequentialId) === String(s._id.p)
    );
    const natIn = inflowMap.get(`${s._id.c}:${s._id.p}:party`) ?? 0;
    const stIn = inflowMap.get(`${s._id.c}:${s._id.p}:state_party`) ?? 0;
    const totalIn = natIn + stIn;
    // Blend: assume the observed national/state mix is unknown, price at the national rate (worst case).
    const cost = rate.national * F * s.ps;
    lines.push(
      `${s._id.c} ${p?.abbreviation ?? s._id.p}: ${totalIn > 0 ? ((cost / totalIn) * 100).toFixed(0) + "% of inflow" : "no inflow"}`
    );
  }
  console.log(`F=${F}: ` + lines.join(" | "));
}

await client.close();
