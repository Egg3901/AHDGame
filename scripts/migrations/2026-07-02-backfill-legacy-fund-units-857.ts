/**
 * Ticket #857 grandfather backfill.
 *
 * Every index-fund position that exists right now was acquired BEFORE the
 * currency-scale fix, when subscribe charged the raw ₳ magnitude as native
 * (no × rate). Stamp those units as `legacyUnits` so the fixed redeem/cron pay
 * them out rate-free (× 1) — exactly what they paid — instead of handing them a
 * rate× windfall. Positions created AFTER this runs get `legacyUnits: 0` from
 * creditFundPosition, so they redeem at the correct × rate.
 *
 * Also stamps `redeemFxRate: 1` on any already-pending queued redemptions so the
 * cron pays them rate-free explicitly (the cron defaults absent → 1 anyway).
 *
 * Purely ADDITIVE — no money field is touched, no unit count changes. Safe to
 * re-run (only fills rows still missing the field).
 *
 * Dry-run (default): prints what WOULD change.
 *   MONGODB_URI="$(grep '^MONGODB_URI=' .env.local | cut -d= -f2-)" \
 *     npx tsx scripts/migrations/2026-07-02-backfill-legacy-fund-units-857.ts
 * Apply: append  --apply
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not set");
const APPLY = process.argv.includes("--apply");

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();
  console.log(`Connected. DB = ${db.databaseName}   mode = ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const positions = db.collection("indexFundPositions");
  const queue = db.collection("indexFundRedemptionQueue");

  const posMissing = await positions.countDocuments({ legacyUnits: { $exists: false } });
  const posTotal = await positions.countDocuments({});
  const queueMissing = await queue.countDocuments({
    status: { $in: ["queued", "partial"] },
    redeemFxRate: { $exists: false },
  });

  console.log(
    `indexFundPositions: ${posTotal} total, ${posMissing} missing legacyUnits (would set legacyUnits = units)`
  );
  console.log(
    `pending redemptions missing redeemFxRate: ${queueMissing} (would set redeemFxRate = 1)\n`
  );

  // Sample of what will change (largest positions first — the whales).
  const sample = await positions
    .find({ legacyUnits: { $exists: false }, units: { $gt: 0 } })
    .sort({ units: -1 })
    .limit(6)
    .toArray();
  console.log("Largest positions to be stamped legacy:");
  for (const p of sample) {
    console.log(
      `  fund=${p.fundId} ${p.holderKind} units=${p.units.toLocaleString()} → legacyUnits=${p.units.toLocaleString()}`
    );
  }
  console.log();

  if (!APPLY) {
    console.log("DRY-RUN — no writes. Re-run with --apply to commit.");
    await client.close();
    return;
  }

  // legacyUnits = units, per document (pipeline update).
  const posRes = await positions.updateMany({ legacyUnits: { $exists: false } }, [
    { $set: { legacyUnits: "$units", updatedAt: new Date() } },
  ]);
  const queueRes = await queue.updateMany(
    { status: { $in: ["queued", "partial"] }, redeemFxRate: { $exists: false } },
    { $set: { redeemFxRate: 1, updatedAt: new Date() } }
  );

  console.log(`APPLIED: positions matched=${posRes.matchedCount} modified=${posRes.modifiedCount}`);
  console.log(
    `APPLIED: pending redemptions matched=${queueRes.matchedCount} modified=${queueRes.modifiedCount}`
  );

  const stillMissing = await positions.countDocuments({ legacyUnits: { $exists: false } });
  console.log(`\nVerify: positions still missing legacyUnits = ${stillMissing} (expect 0)`);
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
