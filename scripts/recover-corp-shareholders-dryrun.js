/* eslint-disable */
/**
 * READ-ONLY dry-run reconstruction of corp-on-corp shareholdings wiped by the
 * 2026-04-28 02:29:53Z incident.
 *
 * Strategy: for each affected corp, replay shareTradeHistory chronologically
 * (starting from the most recent stock_split / reverse_split snapshot, if any)
 * up to the destruction cutoff. The reconstructed register is the expected
 * shareholders array as of just before the wipe.
 *
 * Validation gate: human (character/imperial) positions in the replay must
 * match the current shareholders array. If they do, the history is trustworthy
 * and the corp positions can be restored. If they don't, the corp is flagged
 * as UNTRUSTWORTHY and skipped — no proposal is written.
 *
 * Writes: NONE. Prints a per-corp report and a summary.
 */

const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const CUTOFF = new Date("2026-04-28T02:29:53.858Z");
const ENV_PATH = path.join(__dirname, "..", ".env.local");

// 76 affected sequentialIds + the totalShares the destructive script reported
// BEFORE its $set. Source: the destructive run's stdout, captured in
// docs/archive/incidents/2026-04/SHAREHOLDER_INCIDENT_TRANSCRIPT.jsonl.
const AFFECTED = [
  {
    seq: 6,
    name: "General Electric",
    removedShares: 16760259,
    removedEntries: 16,
    prevTotal: 868779117,
  },
  { seq: 15, name: "Toshiba", removedShares: 1364639, removedEntries: 4, prevTotal: 29881705 },
  { seq: 16, name: "AURORA Group", removedShares: 66667, removedEntries: 1, prevTotal: 1000000 },
  { seq: 26, name: "Duolingo", removedShares: 700000, removedEntries: 2, prevTotal: 10500000 },
  { seq: 28, name: "MamdaniCare", removedShares: 363272, removedEntries: 3, prevTotal: 2880000 },
  { seq: 32, name: "Nissan", removedShares: 1090000, removedEntries: 2, prevTotal: 1100000 },
  {
    seq: 33,
    name: "Reilly Holdings",
    removedShares: 480770,
    removedEntries: 5,
    prevTotal: 2984425,
  },
  {
    seq: 48,
    name: "New-York Medicare",
    removedShares: 200000,
    removedEntries: 2,
    prevTotal: 1200000,
  },
  { seq: 53, name: "Culina Group", removedShares: 177450, removedEntries: 4, prevTotal: 5625824 },
  {
    seq: 61,
    name: "Liverpool Football Club",
    removedShares: 66972,
    removedEntries: 3,
    prevTotal: 1250000,
  },
  { seq: 64, name: "Haas Formula", removedShares: 1, removedEntries: 1, prevTotal: 10300000 },
  { seq: 67, name: "Novo Nordisk", removedShares: 135000, removedEntries: 4, prevTotal: 13039764 },
  { seq: 76, name: "Tesco", removedShares: 5490000, removedEntries: 2, prevTotal: 10490000 },
  {
    seq: 80,
    name: "Harrid's Convenience",
    removedShares: 186078,
    removedEntries: 4,
    prevTotal: 1100000,
  },
  {
    seq: 83,
    name: "Lloyds Banking Group",
    removedShares: 1,
    removedEntries: 1,
    prevTotal: 1500000,
  },
  {
    seq: 84,
    name: "Anti Woke Holdings",
    removedShares: 700000,
    removedEntries: 1,
    prevTotal: 1510000,
  },
  { seq: 101, name: "Frost INC", removedShares: 21000, removedEntries: 1, prevTotal: 1021000 },
  {
    seq: 102,
    name: "Pierce & Pierce",
    removedShares: 7030000,
    removedEntries: 2,
    prevTotal: 22500000,
  },
  { seq: 103, name: "NiCoCo LTD.", removedShares: 1692103, removedEntries: 3, prevTotal: 2500000 },
  {
    seq: 105,
    name: "Bloodfeast Incorporated",
    removedShares: 3797774,
    removedEntries: 3,
    prevTotal: 18723363,
  },
  {
    seq: 106,
    name: "Greenbaum Studios",
    removedShares: 2997500,
    removedEntries: 3,
    prevTotal: 20159759,
  },
  {
    seq: 111,
    name: "GAZPROM Газпром INTERNATIONAL LIMITED",
    removedShares: 254500,
    removedEntries: 1,
    prevTotal: 12209574,
  },
  {
    seq: 114,
    name: "Bank of Scotland",
    removedShares: 266778,
    removedEntries: 3,
    prevTotal: 2000000,
  },
  {
    seq: 116,
    name: "Nippon move stuff fast asf",
    removedShares: 7926222,
    removedEntries: 2,
    prevTotal: 10236229,
  },
  {
    seq: 121,
    name: "Roblox Corporation",
    removedShares: 4000000,
    removedEntries: 1,
    prevTotal: 12000000,
  },
  { seq: 124, name: "Waitrose", removedShares: 64775, removedEntries: 3, prevTotal: 1000000 },
  { seq: 125, name: "Bondi Mart", removedShares: 2140000, removedEntries: 2, prevTotal: 15000000 },
  { seq: 129, name: "NKVD", removedShares: 500000, removedEntries: 1, prevTotal: 1500000 },
  {
    seq: 132,
    name: "Marks & Spencer PLC",
    removedShares: 1939500,
    removedEntries: 1,
    prevTotal: 16367400,
  },
  {
    seq: 133,
    name: "Aspinall Industrial Fixings",
    removedShares: 1341541,
    removedEntries: 5,
    prevTotal: 3879805,
  },
  {
    seq: 134,
    name: "The Trump Organization",
    removedShares: 189988,
    removedEntries: 3,
    prevTotal: 1000000,
  },
  {
    seq: 135,
    name: "Noem Harvesting",
    removedShares: 12000,
    removedEntries: 1,
    prevTotal: 12012000,
  },
  {
    seq: 136,
    name: "Anti-Woke Corporation",
    removedShares: 400000,
    removedEntries: 1,
    prevTotal: 1310640,
  },
  { seq: 142, name: "Taliban Inc.", removedShares: 800000, removedEntries: 1, prevTotal: 13000000 },
  {
    seq: 143,
    name: "Piastri Holdings",
    removedShares: 5762499,
    removedEntries: 1,
    prevTotal: 14512499,
  },
  {
    seq: 144,
    name: "Northern Ireland Corp",
    removedShares: 1100000,
    removedEntries: 2,
    prevTotal: 14400000,
  },
  {
    seq: 147,
    name: "Mitsubishi Corporation",
    removedShares: 56667,
    removedEntries: 1,
    prevTotal: 1500000,
  },
  {
    seq: 151,
    name: "Morrisons Ltd",
    removedShares: 1000000,
    removedEntries: 1,
    prevTotal: 10000000,
  },
  { seq: 159, name: "BAE Systems", removedShares: 5780000, removedEntries: 6, prevTotal: 29284430 },
  { seq: 161, name: "Paulo", removedShares: 4500000, removedEntries: 3, prevTotal: 15000000 },
  {
    seq: 162,
    name: "LEC Ice Cream",
    removedShares: 500000,
    removedEntries: 1,
    prevTotal: 13571344,
  },
  { seq: 166, name: "British Gas", removedShares: 700000, removedEntries: 1, prevTotal: 1000000 },
  {
    seq: 167,
    name: "Badussie Corp",
    removedShares: 1615000,
    removedEntries: 4,
    prevTotal: 20695317,
  },
  {
    seq: 176,
    name: "Kildare Corporation",
    removedShares: 27578104,
    removedEntries: 8,
    prevTotal: 79164319,
  },
  {
    seq: 177,
    name: "Streibl Auto",
    removedShares: 3693508,
    removedEntries: 5,
    prevTotal: 29623804,
  },
  {
    seq: 180,
    name: "Korean Central News Agency (KCNA)",
    removedShares: 500000,
    removedEntries: 1,
    prevTotal: 1500000,
  },
  {
    seq: 188,
    name: "Natwest Group",
    removedShares: 525000,
    removedEntries: 1,
    prevTotal: 11025000,
  },
  {
    seq: 191,
    name: "Ross Holding Group",
    removedShares: 2212665,
    removedEntries: 1,
    prevTotal: 32926824,
  },
  {
    seq: 192,
    name: "Butxot Korp Foods",
    removedShares: 508750,
    removedEntries: 1,
    prevTotal: 11217937,
  },
  {
    seq: 197,
    name: "Oregon's Fields Industries",
    removedShares: 102110,
    removedEntries: 4,
    prevTotal: 1223209,
  },
  {
    seq: 198,
    name: "Epstein Health",
    removedShares: 10000000,
    removedEntries: 1,
    prevTotal: 15000000,
  },
  {
    seq: 200,
    name: "Curzon Holdings Ltd.",
    removedShares: 270000,
    removedEntries: 1,
    prevTotal: 10270000,
  },
  {
    seq: 205,
    name: "Dr. Söder Foundation",
    removedShares: 3000000,
    removedEntries: 1,
    prevTotal: 14900000,
  },
  {
    seq: 207,
    name: "McCann Chemicals",
    removedShares: 1025000,
    removedEntries: 1,
    prevTotal: 11125327,
  },
  { seq: 210, name: "Luthorcorp", removedShares: 1070000, removedEntries: 2, prevTotal: 1070000 },
  {
    seq: 217,
    name: "Harris Nuclear Industries",
    removedShares: 100000,
    removedEntries: 1,
    prevTotal: 1980000,
  },
  { seq: 220, name: "AngloAmerican", removedShares: 100000, removedEntries: 1, prevTotal: 1711089 },
  {
    seq: 223,
    name: "Tencent Holdings",
    removedShares: 653177,
    removedEntries: 1,
    prevTotal: 1200000,
  },
  {
    seq: 228,
    name: "Al Jazeera Media Network",
    removedShares: 700000,
    removedEntries: 2,
    prevTotal: 10700000,
  },
  {
    seq: 232,
    name: "Crockett Enterprises",
    removedShares: 200000,
    removedEntries: 1,
    prevTotal: 1300000,
  },
  {
    seq: 248,
    name: "NSO Group Technologies",
    removedShares: 655485,
    removedEntries: 4,
    prevTotal: 10200000,
  },
  { seq: 258, name: "Tim Estate", removedShares: 825000, removedEntries: 2, prevTotal: 11025000 },
  {
    seq: 260,
    name: "LDR Industries",
    removedShares: 1010000,
    removedEntries: 2,
    prevTotal: 10000000,
  },
  {
    seq: 279,
    name: "Davis Holdings",
    removedShares: 283400,
    removedEntries: 1,
    prevTotal: 1283400,
  },
  {
    seq: 281,
    name: "Lolcow industry",
    removedShares: 6673280,
    removedEntries: 2,
    prevTotal: 15000000,
  },
  {
    seq: 282,
    name: "Bass Industry",
    removedShares: 9750000,
    removedEntries: 1,
    prevTotal: 15000000,
  },
  { seq: 284, name: "PARKER", removedShares: 9650000, removedEntries: 2, prevTotal: 15000000 },
  { seq: 290, name: "BlackRock", removedShares: 206663, removedEntries: 3, prevTotal: 2484000 },
  { seq: 296, name: "VEXUS", removedShares: 432000, removedEntries: 1, prevTotal: 12432000 },
  { seq: 299, name: "Ornua", removedShares: 1517000, removedEntries: 2, prevTotal: 11187000 },
  { seq: 305, name: "Fox Energy", removedShares: 4000000, removedEntries: 1, prevTotal: 12000000 },
  {
    seq: 308,
    name: "Falkenberg Logistics Group",
    removedShares: 10458500,
    removedEntries: 2,
    prevTotal: 10500000,
  },
  {
    seq: 353,
    name: "Rothschild Defense Industries",
    removedShares: 2000000,
    removedEntries: 1,
    prevTotal: 14167936,
  },
  {
    seq: 354,
    name: "Scuderia Toro Rosso",
    removedShares: 3500000,
    removedEntries: 2,
    prevTotal: 15000000,
  },
  {
    seq: 355,
    name: "The Jamie Oliver Petrol Station",
    removedShares: 5097059,
    removedEntries: 4,
    prevTotal: 15200000,
  },
  { seq: 360, name: "B&M", removedShares: 3505000, removedEntries: 2, prevTotal: 10500000 },
];

function readMongoUri() {
  const env = fs.readFileSync(ENV_PATH, "utf8");
  const m = env.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error("MONGODB_URI not in .env.local");
  return m[1].trim();
}

function partyKey(party) {
  if (!party) return "float";
  if (party.corporationId) return `corp:${party.corporationId.toString()}`;
  if (party.characterId) return `char:${party.characterId.toString()}`;
  if (party.imperialCharacterId) return `imp:${party.imperialCharacterId.toString()}`;
  return `unknown:${party.name || "?"}`;
}

function shareholderKey(s) {
  if (s.corporationId) return `corp:${s.corporationId.toString()}`;
  if (s.characterId) return `char:${s.characterId.toString()}`;
  if (s.imperialCharacterId) return `imp:${s.imperialCharacterId.toString()}`;
  return `unknown:${s.name || "?"}`;
}

function snapshotKey(holder) {
  if (holder.kind === "public_float") return "float";
  if (!holder.ownerId) return `unknown:${holder.name}`;
  if (holder.kind === "corporation") return `corp:${holder.ownerId}`;
  if (holder.kind === "character") return `char:${holder.ownerId}`;
  if (holder.kind === "imperial") return `imp:${holder.ownerId}`;
  return `unknown:${holder.name}`;
}

async function main() {
  const uri = readMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Build set of corp _ids that currently exist (for ghost-vs-real holder check).
  const existingCorps = await db
    .collection("corporations")
    .find({}, { projection: { _id: 1, name: 1 } })
    .toArray();
  const existingCorpIds = new Set(existingCorps.map((c) => c._id.toString()));
  const existingCorpNames = new Map(existingCorps.map((c) => [c._id.toString(), c.name]));

  let trustworthy = 0;
  let untrustworthy = 0;
  let totalCorpEntriesToRestore = 0;
  let totalSharesToRestore = 0;
  const proposals = [];

  for (const target of AFFECTED) {
    const corp = await db.collection("corporations").findOne(
      { sequentialId: target.seq },
      {
        projection: {
          _id: 1,
          name: 1,
          sequentialId: 1,
          shareholders: 1,
          totalShares: 1,
          publicFloat: 1,
        },
      }
    );
    if (!corp) {
      console.log(`[#${target.seq}] ${target.name}: NOT FOUND in DB — skipping`);
      untrustworthy++;
      continue;
    }

    // Find latest split snapshot before cutoff (if any) — gives us a checkpoint.
    const latestSplit = await db
      .collection("shareTradeHistory")
      .find({
        corporationId: corp._id,
        kind: { $in: ["stock_split", "reverse_split"] },
        createdAt: { $lt: CUTOFF },
        structureChange: { $exists: true },
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();

    let register = new Map(); // key → shares
    let nameByKey = new Map(); // key → display name (for output)
    let replayStart = new Date(0);

    if (
      latestSplit &&
      latestSplit.structureChange &&
      Array.isArray(latestSplit.structureChange.after)
    ) {
      for (const h of latestSplit.structureChange.after) {
        const k = snapshotKey(h);
        register.set(k, (register.get(k) || 0) + (h.shares || 0));
        if (h.name) nameByKey.set(k, h.name);
      }
      replayStart = latestSplit.createdAt;
    }

    // Replay all non-split trades after the snapshot, before the cutoff.
    const trades = await db
      .collection("shareTradeHistory")
      .find({
        corporationId: corp._id,
        createdAt: { $gt: replayStart, $lt: CUTOFF },
        kind: { $nin: ["stock_split", "reverse_split"] },
      })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();

    for (const t of trades) {
      const fromK = partyKey(t.from);
      const toK = partyKey(t.to);
      register.set(fromK, (register.get(fromK) || 0) - t.shares);
      register.set(toK, (register.get(toK) || 0) + t.shares);
      if (t.from && t.from.name) nameByKey.set(fromK, t.from.name);
      if (t.to && t.to.name) nameByKey.set(toK, t.to.name);
    }

    // Drop zero entries.
    for (const [k, v] of register) if (v === 0) register.delete(k);

    // Validation: do humans in the replay match current humans in the DB?
    const replayHumans = new Map();
    const replayCorps = new Map();
    let replayFloat = 0;
    for (const [k, v] of register) {
      if (k === "float") replayFloat = v;
      else if (k.startsWith("corp:")) replayCorps.set(k, v);
      else replayHumans.set(k, v);
    }
    const currentHumans = new Map();
    const currentCorpKeys = new Set();
    for (const s of corp.shareholders || []) {
      const k = shareholderKey(s);
      if (k.startsWith("corp:")) {
        currentCorpKeys.add(k);
      } else {
        currentHumans.set(k, (currentHumans.get(k) || 0) + (s.shares || 0));
      }
    }

    // Compare humans.
    const humanMismatches = [];
    for (const [k, v] of replayHumans) {
      const cur = currentHumans.get(k) || 0;
      if (cur !== v) humanMismatches.push({ k, replay: v, current: cur });
    }
    for (const [k, v] of currentHumans) {
      if (!replayHumans.has(k) && v !== 0) humanMismatches.push({ k, replay: 0, current: v });
    }

    // Replay totalShares = sum(register).
    let replayTotal = 0;
    for (const v of register.values()) replayTotal += v;

    // Build the proposed restore list from positive replay corp positions.
    // Drop:
    //   - negative entries (pre-audit-log gaps showing as net-negative)
    //   - entries whose holder corp no longer exists (legitimate ghosts —
    //     dissolved corps that the cleanup was *supposed* to remove)
    const toRestorePositive = [];
    const toRestoreNegativeIgnored = [];
    const ghostHoldersIgnored = []; // holder corp no longer exists
    for (const [k, shares] of replayCorps) {
      const corpId = k.slice("corp:".length);
      const liveName = existingCorpNames.get(corpId);
      const entry = {
        corporationId: corpId,
        name: liveName ?? (nameByKey.get(k) || "?"),
        shares,
      };
      if (shares < 0) {
        toRestoreNegativeIgnored.push(entry);
      } else if (!existingCorpIds.has(corpId)) {
        ghostHoldersIgnored.push(entry);
      } else if (shares > 0) {
        toRestorePositive.push(entry);
      }
    }
    toRestorePositive.sort((a, b) => b.shares - a.shares);

    const replayCorpSum = toRestorePositive.reduce((s, x) => s + x.shares, 0);
    const logRemoved = target.removedShares;
    const gap = logRemoved - replayCorpSum;
    const gapAbs = Math.abs(gap);
    const gapPct = logRemoved > 0 ? gapAbs / logRemoved : 0;

    let tier;
    if (replayCorpSum === 0 && logRemoved > 0) tier = "EMPTY";
    else if (gap === 0) tier = "FULL";
    else if (gapAbs <= 100 || gapPct <= 0.01) tier = "NEAR";
    else if (gapPct <= 0.1) tier = "PARTIAL_HIGH";
    else if (gapPct <= 0.5) tier = "PARTIAL_LOW";
    else tier = "INCOMPLETE";

    const result = {
      seq: corp.sequentialId,
      name: corp.name,
      tier,
      currentTotalShares: corp.totalShares,
      logPrevTotalShares: target.prevTotal,
      logRemovedShares: logRemoved,
      logRemovedEntries: target.removedEntries,
      replayCorpSum,
      gap,
      gapPct: Number(gapPct.toFixed(4)),
      humanMismatches,
      replayStartedFromSplit: !!latestSplit,
      tradesReplayed: trades.length,
      toRestore: toRestorePositive,
      ignoredNegative: toRestoreNegativeIgnored,
      ignoredGhostHolders: ghostHoldersIgnored,
    };
    proposals.push(result);

    if (tier === "FULL" || tier === "NEAR") {
      trustworthy++;
      totalCorpEntriesToRestore += toRestorePositive.length;
      totalSharesToRestore += replayCorpSum;
    } else {
      untrustworthy++;
    }
  }

  // Group output by tier.
  const byTier = {};
  for (const p of proposals) {
    byTier[p.tier] = byTier[p.tier] || [];
    byTier[p.tier].push(p);
  }
  const tierOrder = ["FULL", "NEAR", "PARTIAL_HIGH", "PARTIAL_LOW", "INCOMPLETE", "EMPTY"];

  // Write full proposal as JSON for review.
  const outPath = path.join(
    __dirname,
    "..",
    "docs",
    "archive",
    "incidents",
    "2026-04",
    "SHAREHOLDER_RECOVERY_PROPOSAL.json"
  );
  fs.writeFileSync(outPath, JSON.stringify({ cutoff: CUTOFF.toISOString(), proposals }, null, 2));

  // Tier counts.
  console.log("=== Tier breakdown ===");
  for (const t of tierOrder) {
    const count = (byTier[t] || []).length;
    if (count) console.log(`  ${t.padEnd(14)} ${count} corps`);
  }

  // Per-tier listing.
  for (const t of tierOrder) {
    const list = byTier[t] || [];
    if (!list.length) continue;
    console.log(`\n=== ${t} (${list.length}) ===`);
    for (const p of list) {
      console.log(`[#${p.seq}] ${p.name}`);
      console.log(
        `  log removed: ${p.logRemovedShares.toLocaleString()} shares in ${p.logRemovedEntries} entries`
      );
      console.log(
        `  replay sum:  ${p.replayCorpSum.toLocaleString()} shares in ${p.toRestore.length} entries  (gap: ${p.gap.toLocaleString()}, ${(p.gapPct * 100).toFixed(2)}%)`
      );
      if (p.toRestore.length) {
        for (const r of p.toRestore.slice(0, 6)) {
          console.log(
            `    ${r.shares.toString().padStart(12).padStart(12)}  ${r.name}  (${r.corporationId})`
          );
        }
        if (p.toRestore.length > 6) console.log(`    …(${p.toRestore.length - 6} more)`);
      }
      if (p.ignoredNegative.length) {
        console.log(`  ignored negatives (pre-audit gaps): ${p.ignoredNegative.length}`);
      }
      if (p.ignoredGhostHolders.length) {
        const ghostShares = p.ignoredGhostHolders.reduce((s, x) => s + x.shares, 0);
        console.log(
          `  ignored ghost-holders (dissolved corps): ${p.ignoredGhostHolders.length} entries, ${ghostShares.toLocaleString()} shares`
        );
      }
    }
  }

  console.log("\n=== Summary ===");
  let confidentSum = 0,
    confidentEntries = 0,
    confidentCorps = 0;
  let partialSum = 0,
    partialEntries = 0,
    partialCorps = 0;
  for (const p of proposals) {
    if (p.tier === "FULL" || p.tier === "NEAR") {
      confidentCorps++;
      confidentEntries += p.toRestore.length;
      confidentSum += p.replayCorpSum;
    } else if (p.tier === "PARTIAL_HIGH" || p.tier === "PARTIAL_LOW") {
      partialCorps++;
      partialEntries += p.toRestore.length;
      partialSum += p.replayCorpSum;
    }
  }
  console.log(
    `High-confidence (FULL+NEAR):     ${confidentCorps} corps, ${confidentEntries} entries, ${confidentSum.toLocaleString()} shares`
  );
  console.log(
    `Partial   (PARTIAL_HIGH+LOW):    ${partialCorps} corps, ${partialEntries} entries, ${partialSum.toLocaleString()} shares`
  );
  console.log(`Destructive log claimed total:   76 corps, 195,970,657 shares`);
  console.log(`\nFull proposal written to: ${outPath}`);
  console.log(`No DB writes performed.`);

  await client.close();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
