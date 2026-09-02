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
console.log("currentTurn:", turn);

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const fmt = (n) => Math.round(n).toLocaleString("en-US");

const parties = await db
  .collection("politicalParties")
  .find(
    {},
    {
      projection: {
        countryId: 1,
        name: 1,
        abbreviation: 1,
        sequentialId: 1,
        treasury: 1,
        politicalStrength: 1,
        tier: 1,
        memberCount: 1,
      },
    }
  )
  .toArray();
console.log("\n=== NATIONAL PARTY TREASURY (live, by country) ===");
const byCountry = new Map();
for (const p of parties) {
  if (!byCountry.has(p.countryId)) byCountry.set(p.countryId, []);
  byCountry.get(p.countryId).push(p);
}
const focus = ["US", "UK", "DE", "JP", "RU", "DD", "FR", "IT"];
for (const c of focus) {
  const ps = (byCountry.get(c) ?? []).filter(
    (p) => (p.treasury ?? 0) !== 0 || (p.memberCount ?? 0) > 0
  );
  if (!ps.length) continue;
  const t = ps.map((p) => p.treasury ?? 0);
  console.log(
    `${c}: n=${ps.length} min=${fmt(Math.min(...t))} p25=${fmt(pct(t, 0.25))} med=${fmt(pct(t, 0.5))} p75=${fmt(pct(t, 0.75))} max=${fmt(Math.max(...t))}`
  );
  for (const p of ps.sort((a, b) => (b.treasury ?? 0) - (a.treasury ?? 0)).slice(0, 6)) {
    console.log(
      `   ${p.abbreviation ?? p.name} (seq ${p.sequentialId}, ${p.tier ?? "?"}, members ${p.memberCount ?? 0}): treasury ${fmt(p.treasury ?? 0)}  PS ${(p.politicalStrength ?? 0).toFixed(1)}`
    );
  }
}

console.log("\n=== STATE PARTY TREASURY (live) ===");
const spos = await db
  .collection("statePartyOrg")
  .find(
    {},
    {
      projection: {
        countryId: 1,
        stateId: 1,
        partyId: 1,
        treasury: 1,
        organization: 1,
        politicalStrength: 1,
        hasPresence: 1,
      },
    }
  )
  .toArray();
console.log("total statePartyOrg rows:", spos.length);
for (const c of focus) {
  const rows = spos.filter((r) => r.countryId === c);
  if (!rows.length) continue;
  const withPresence = rows.filter((r) => r.hasPresence);
  const t = rows.map((r) => r.treasury ?? 0);
  const tp = withPresence.map((r) => r.treasury ?? 0);
  const zero = t.filter((v) => v <= 0).length;
  console.log(
    `${c}: rows=${rows.length} presence=${withPresence.length} zeroOrNeg=${zero} | all: med=${fmt(pct(t, 0.5))} p75=${fmt(pct(t, 0.75))} p90=${fmt(pct(t, 0.9))} max=${fmt(Math.max(...t))} | presence-only: med=${fmt(pct(tp, 0.5))} p90=${fmt(pct(tp, 0.9))}`
  );
}

console.log("\n=== BUILD ORG CLICK VOLUME (orgRegLedger action:build-org) ===");
for (const window of [24, 168, 720]) {
  const rows = await db
    .collection("orgRegLedger")
    .aggregate([
      {
        $match: {
          turn: { $gte: turn - window },
          metric: "org",
          source: "action",
          note: "action:build-org",
        },
      },
      {
        $group: {
          _id: { c: "$countryId", p: "$partyId" },
          clicks: { $sum: 1 },
          gain: { $sum: "$delta" },
        },
      },
      { $sort: { clicks: -1 } },
    ])
    .toArray();
  const total = rows.reduce((s, r) => s + r.clicks, 0);
  const gain = rows.reduce((s, r) => s + r.gain, 0);
  console.log(
    `last ${window} turns: ${total} clicks across ${rows.length} (country,party) pairs; total org gain ${gain.toFixed(1)} pp; avg gain/click ${total ? (gain / total).toFixed(3) : 0}`
  );
  if (window === 168) {
    console.log("  top builders (last 168 turns):");
    for (const r of rows.slice(0, 12)) {
      const p = parties.find(
        (x) => x.countryId === r._id.c && String(x.sequentialId) === String(r._id.p)
      );
      console.log(
        `   ${r._id.c} ${p?.abbreviation ?? r._id.p}: ${r.clicks} clicks, +${r.gain.toFixed(1)} pp, avg ${(r.gain / r.clicks).toFixed(3)} pp/click`
      );
    }
    const clicks = rows.map((r) => r.clicks);
    console.log(
      `  per-party clicks/168t: med=${pct(clicks, 0.5)} p75=${pct(clicks, 0.75)} p90=${pct(clicks, 0.9)} max=${Math.max(...clicks, 0)}`
    );
  }
}

const npp = await db.collection("orgRegLedger").countDocuments({
  turn: { $gte: turn - 168 },
  metric: "org",
  source: "action",
  note: "action:build-org",
  actorId: null,
});
const all = await db.collection("orgRegLedger").countDocuments({
  turn: { $gte: turn - 168 },
  metric: "org",
  source: "action",
  note: "action:build-org",
});
console.log(
  `\nlast 168 turns: ${all} build-org actions, ${npp} actorId=null (NPP sweep), ${all - npp} player clicks`
);

await client.close();
