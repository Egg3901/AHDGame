/* eslint-disable */
/**
 * Restore corp-on-corp shareholder positions wiped by the 2026-04-28
 * 02:29:53Z incident. Source: corporationHistory snapshot at turn 412
 * (2026-04-28T02:00:47Z). Window between snapshot and destruction had
 * zero trades on affected corps (verified), so the snapshot IS the
 * pre-destruction register.
 *
 * Strategy per corp:
 *   - Take corp-only shareholder entries from the snapshot
 *   - MERGE into the live shareholders array:
 *       · existing matching corp entry → shares += snapshot shares
 *       · no existing entry → append the snapshot entry
 *   - $inc totalShares by the sum of snapshot corp shares
 *
 * Defaults to DRY-RUN. Pass --apply to actually write.
 *
 * Writes a per-corp audit log to RESTORE_AUDIT_<timestamp>.json that
 * captures every before/after state for forensic review.
 */

const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const SNAPSHOT_AT = new Date("2026-04-28T02:00:47.847Z");

const ENV_PATH = path.join(__dirname, "..", ".env.local");
const AUDIT_OUT = path.join(
  __dirname,
  "..",
  `RESTORE_AUDIT_${APPLY ? "APPLIED" : "DRYRUN"}_${Date.now()}.json`
);

const AFFECTED_SEQS = [
  6, 15, 16, 26, 28, 32, 33, 48, 53, 61, 64, 67, 76, 80, 83, 84, 101, 102, 103, 105, 106, 111, 114,
  116, 121, 124, 125, 129, 132, 133, 134, 135, 136, 142, 143, 144, 147, 151, 159, 161, 162, 166,
  167, 176, 177, 180, 188, 191, 192, 197, 198, 200, 205, 207, 210, 217, 220, 223, 228, 232, 248,
  258, 260, 279, 281, 282, 284, 290, 296, 299, 305, 308, 353, 354, 355, 360,
];

function readMongoUri() {
  const env = fs.readFileSync(ENV_PATH, "utf8");
  const m = env.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error("MONGODB_URI not in .env.local");
  return m[1].trim();
}

function shareholderKey(s) {
  if (s.corporationId) return `corp:${s.corporationId.toString()}`;
  if (s.characterId) return `char:${s.characterId.toString()}`;
  if (s.imperialCharacterId) return `imp:${s.imperialCharacterId.toString()}`;
  return `unknown`;
}

function summarize(arr) {
  const corp = arr.filter((s) => s.corporationId);
  const human = arr.filter((s) => !s.corporationId);
  return {
    total: arr.length,
    corp: corp.length,
    human: human.length,
    corpShares: corp.reduce((s, x) => s + (x.shares || 0), 0),
    humanShares: human.reduce((s, x) => s + (x.shares || 0), 0),
  };
}

async function main() {
  const uri = readMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log(APPLY ? "=== APPLY MODE — WILL WRITE ===" : "=== DRY-RUN — NO WRITES ===");
  console.log(`Snapshot source: corporationHistory @ ${SNAPSHOT_AT.toISOString()}\n`);

  const audit = {
    mode: APPLY ? "apply" : "dryrun",
    startedAt: new Date().toISOString(),
    snapshotAt: SNAPSHOT_AT.toISOString(),
    corps: [],
  };
  let written = 0,
    skipped = 0,
    problems = 0;

  for (const seq of AFFECTED_SEQS) {
    const corp = await db.collection("corporations").findOne(
      { sequentialId: seq },
      {
        projection: {
          _id: 1,
          name: 1,
          sequentialId: 1,
          totalShares: 1,
          publicFloat: 1,
          shareholders: 1,
        },
      }
    );
    if (!corp) {
      console.log(`[#${seq}] NOT FOUND — skipping`);
      audit.corps.push({ seq, status: "not_found" });
      skipped++;
      continue;
    }

    const snap = await db
      .collection("corporationHistory")
      .find({ corporationId: corp._id, createdAt: { $lte: SNAPSHOT_AT } })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    if (!snap || !Array.isArray(snap.shareholders)) {
      console.log(`[#${seq}] ${corp.name}: NO USABLE SNAPSHOT — skipping`);
      audit.corps.push({ seq, name: corp.name, status: "no_snapshot" });
      skipped++;
      problems++;
      continue;
    }

    const snapCorps = snap.shareholders.filter((s) => s.corporationId);
    if (snapCorps.length === 0) {
      console.log(
        `[#${seq}] ${corp.name}: snapshot has zero corp shareholders — nothing to restore`
      );
      audit.corps.push({ seq, name: corp.name, status: "no_corp_entries" });
      skipped++;
      continue;
    }

    // Merge snap corp entries into current shareholders array.
    const current = Array.isArray(corp.shareholders) ? corp.shareholders.slice() : [];
    const before = summarize(current);
    const indexByKey = new Map();
    current.forEach((s, i) => indexByKey.set(shareholderKey(s), i));

    const merges = []; // {corpId, name, addedShares, mergedInto}
    let restoredSum = 0;
    for (const sc of snapCorps) {
      const key = `corp:${sc.corporationId.toString()}`;
      restoredSum += sc.shares || 0;
      if (indexByKey.has(key)) {
        const idx = indexByKey.get(key);
        const prev = current[idx].shares || 0;
        current[idx] = { ...current[idx], shares: prev + (sc.shares || 0) };
        merges.push({
          corpId: sc.corporationId.toString(),
          key,
          action: "merged_into_existing",
          prevShares: prev,
          addedShares: sc.shares || 0,
          newShares: prev + (sc.shares || 0),
        });
      } else {
        const newEntry = { corporationId: sc.corporationId, shares: sc.shares || 0 };
        if (sc.avgCostPerShare !== undefined && sc.avgCostPerShare !== null) {
          newEntry.avgCostPerShare = sc.avgCostPerShare;
        }
        current.push(newEntry);
        indexByKey.set(key, current.length - 1);
        merges.push({
          corpId: sc.corporationId.toString(),
          key,
          action: "appended",
          addedShares: sc.shares || 0,
        });
      }
    }
    const after = summarize(current);
    const newTotalShares = corp.totalShares + restoredSum;

    const corpAudit = {
      seq,
      name: corp.name,
      _id: corp._id.toString(),
      snapshotTurn: snap.turn,
      snapshotCreatedAt: snap.createdAt,
      before: { totalShares: corp.totalShares, ...before },
      after: { totalShares: newTotalShares, ...after },
      restoredSum,
      restoredEntries: snapCorps.length,
      merges,
    };
    audit.corps.push(corpAudit);

    console.log(`[#${seq}] ${corp.name}`);
    console.log(
      `  before: ${before.total} entries (${before.corp} corp / ${before.human} human), totalShares=${corp.totalShares.toLocaleString()}`
    );
    console.log(
      `  after:  ${after.total} entries (${after.corp} corp / ${after.human} human), totalShares=${newTotalShares.toLocaleString()}`
    );
    console.log(
      `  restored: ${snapCorps.length} corp entries, ${restoredSum.toLocaleString()} shares`
    );
    if (merges.some((m) => m.action === "merged_into_existing")) {
      const merged = merges.filter((m) => m.action === "merged_into_existing");
      console.log(`  merged into existing post-destruction entries: ${merged.length}`);
      for (const m of merged)
        console.log(
          `    ${m.key}  ${m.prevShares.toLocaleString()} + ${m.addedShares.toLocaleString()} = ${m.newShares.toLocaleString()}`
        );
    }

    if (APPLY) {
      const res = await db
        .collection("corporations")
        .updateOne(
          { _id: corp._id },
          { $set: { shareholders: current, totalShares: newTotalShares, updatedAt: new Date() } }
        );
      if (res.modifiedCount === 1) {
        written++;
      } else {
        console.log(`  WRITE FAILED: modifiedCount=${res.modifiedCount}`);
        corpAudit.writeFailed = true;
        problems++;
      }
    }
  }

  audit.finishedAt = new Date().toISOString();
  audit.summary = { written, skipped, problems, totalConsidered: AFFECTED_SEQS.length };
  fs.writeFileSync(AUDIT_OUT, JSON.stringify(audit, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Considered: ${AFFECTED_SEQS.length} corps`);
  console.log(
    `${APPLY ? "Wrote" : "Would write"}: ${APPLY ? written : AFFECTED_SEQS.length - skipped} corps`
  );
  console.log(`Skipped:    ${skipped} corps`);
  console.log(`Problems:   ${problems}`);
  console.log(`Audit log:  ${AUDIT_OUT}`);
  if (!APPLY) console.log(`\nRe-run with --apply to actually write.`);

  await client.close();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
