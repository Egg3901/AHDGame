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
const fmt = (n) => Math.round(n).toLocaleString("en-US");
console.log("currentTurn:", turn);

// 1. PS sources over last 168 turns: how much PS is already treasury-bought?
console.log("\n=== PS LEDGER BY SOURCE (last 168 turns) ===");
const bySource = await db
  .collection("partyPoliticalStrengthLedger")
  .aggregate([
    { $match: { turn: { $gte: turn - 168 } } },
    {
      $group: {
        _id: { c: "$countryId", s: "$source" },
        n: { $sum: 1 },
        total: { $sum: "$delta" },
      },
    },
    { $sort: { "_id.c": 1, "_id.s": 1 } },
  ])
  .toArray();
const agg = new Map();
for (const r of bySource) {
  if (!agg.has(r._id.c)) agg.set(r._id.c, {});
  agg.get(r._id.c)[r._id.s] = { n: r.n, total: r.total };
}
for (const [c, m] of [...agg.entries()].sort()) {
  const parts = Object.entries(m)
    .map(([s, v]) => `${s}: n=${v.n} Σ=${v.total.toFixed(0)}`)
    .join("  ");
  console.log(`${c}: ${parts}`);
}

// 2. build-org spends specifically: cost distribution
console.log("\n=== BUILD-ORG PS SPEND COST DISTRIBUTION (last 168 turns) ===");
const costs = await db
  .collection("partyPoliticalStrengthLedger")
  .aggregate([
    { $match: { turn: { $gte: turn - 168 }, action: "build-org" } },
    { $group: { _id: { $abs: "$delta" }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  .toArray();
const totalSpends = costs.reduce((s, r) => s + r.n, 0);
console.log(
  "cost histogram:",
  costs.map((r) => `${r._id}PS×${r.n}`).join(" "),
  `| total ${totalSpends}`
);
const weighted = costs.reduce((s, r) => s + r._id * r.n, 0);
console.log(`avg effective PS cost/click: ${(weighted / Math.max(1, totalSpends)).toFixed(2)}`);

// 3. Current pressure values
const pressures = await db.collection("partyStrengthPressure").find({}).toArray();
const pv = pressures.map((p) => p.value ?? 0).sort((a, b) => a - b);
console.log(
  `\npartyStrengthPressure rows=${pv.length} med=${pv[Math.floor(pv.length / 2)]} max=${Math.max(...pv, 0)} atMax(8)=${pv.filter((v) => v >= 8).length}`
);

// 4. Treasury income proxy: treasuryTransactions credits per turn per party (last 168)
console.log("\n=== TREASURY FLOWS (last 168 turns, by holderType/category) ===");
const flows = await db
  .collection("treasuryTransactions")
  .aggregate([
    { $match: { turn: { $gte: turn - 168 } } },
    {
      $group: {
        _id: { h: "$holderType", cat: "$category", d: "$direction" },
        n: { $sum: 1 },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { total: -1 } },
  ])
  .toArray();
for (const f of flows.slice(0, 25)) {
  console.log(
    `  ${f._id.h}/${f._id.cat}/${f._id.d}: n=${f.n} Σ=${fmt(f.total)} (mixed currencies)`
  );
}

// 5. Per-party hourly income proxy for US/UK: sum of credits / 168
console.log("\n=== PARTY CREDIT INFLOW per turn (last 168), top 15 ===");
const inflow = await db
  .collection("treasuryTransactions")
  .aggregate([
    { $match: { turn: { $gte: turn - 168 }, direction: "credit" } },
    {
      $group: {
        _id: { c: "$countryId", p: "$partyId", h: "$holderType" },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 15 },
  ])
  .toArray();
for (const r of inflow) {
  console.log(
    `  ${r._id.c} party ${r._id.p} (${r._id.h}): Σ${fmt(r.total)} over 168t → ${fmt(r.total / 168)}/turn`
  );
}

// 6. Who is clicking: distinct actors
console.log("\n=== DISTINCT BUILD-ORG ACTORS (last 168 turns) ===");
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
    { $sort: { clicks: -1 } },
  ])
  .toArray();
console.log(`distinct actorIds: ${actors.length}`);
for (const a of actors.slice(0, 10)) {
  const ch = a._id
    ? await db
        .collection("characters")
        .findOne({ _id: a._id }, { projection: { name: 1, countryId: 1, isNPP: 1 } })
    : null;
  console.log(
    `  ${ch ? `${ch.name} (${ch.countryId}${ch.isNPP ? ", NPP" : ""})` : String(a._id)}: ${a.clicks} clicks, +${a.gain.toFixed(1)} pp`
  );
}

await client.close();
