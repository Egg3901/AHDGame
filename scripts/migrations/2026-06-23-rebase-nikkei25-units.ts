/**
 * One-off value-preserving reverse split for the "Nikkei 25 Index" fund.
 *
 * Nikkei 25 has an anomalous unit basis (~2.24B units at ~0.038 ₳/unit) from a
 * historical bad subscription — unlike every other fund (incl. the sibling
 * Nikkei 50, which is healthy). The fund VALUE is correct; only the unit count /
 * per-unit NAV are nonsensical. This rebases the live unit basis to a sane scale
 * (~100 ₳/unit) by dividing every unit count by a single factor F and
 * multiplying NAV by F, so each holder's value (units × NAV) is unchanged.
 *
 * Touches the live unit basis only — fund (unitSupply, quotedNav), holder
 * positions, and any PENDING redemption-queue units. Historical snapshots and
 * transaction rows are immutable point-in-time records and are left as-is (a
 * reverse split legitimately shows a discontinuity in history).
 *
 * Dry-run by default; pass --apply to write.
 *   npx tsx scripts/migrations/2026-06-23-rebase-nikkei25-units.ts
 *   npx tsx scripts/migrations/2026-06-23-rebase-nikkei25-units.ts --apply
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI must be set in .env.local");
const APPLY = process.argv.includes("--apply");
const TARGET_NAV = 100; // ₳ per unit — mid-range of healthy funds

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  try {
    const db = client.db("a-house-divided");
    const fund = (await db.collection("indexFunds").findOne({ name: /Nikkei 25/ })) as {
      _id: ObjectId;
      name: string;
      unitSupply: number;
      quotedNav: number;
    } | null;
    if (!fund) throw new Error("Nikkei 25 fund not found");

    const oldSupply = Number(fund.unitSupply);
    const oldNav = Number(fund.quotedNav);
    if (!(oldNav > 0) || !(oldSupply > 0)) throw new Error("Fund has no valid supply/nav");
    if (oldNav >= 1) {
      console.log(`Nikkei 25 NAV is already ${oldNav.toFixed(4)} ₳ — no rebase needed.`);
      return;
    }
    const F = TARGET_NAV / oldNav;
    const newSupply = Math.round(oldSupply / F);
    const newNav = (oldSupply * oldNav) / newSupply; // preserve total liability exactly

    const positions = (await db
      .collection("indexFundPositions")
      .find({ fundId: fund._id })
      .toArray()) as { _id: ObjectId; units: number }[];
    const pendingQueue = (await db
      .collection("indexFundRedemptionQueue")
      .find({ fundId: fund._id, status: { $nin: ["paid", "cancelled"] } })
      .toArray()) as { _id: ObjectId; units: number }[];

    // ── Value-preservation proof ──────────────────────────────────────────────
    const oldHolderValue = positions.reduce((s, p) => s + (p.units || 0) * oldNav, 0);
    const newHolderValue = positions.reduce(
      (s, p) => s + Math.round((p.units || 0) / F) * newNav,
      0
    );
    const drift = oldHolderValue > 0 ? (newHolderValue - oldHolderValue) / oldHolderValue : 0;

    console.log(`=== Nikkei 25 rebase (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
    console.log(`factor F = ${F.toFixed(2)}×`);
    console.log(
      `fund: unitSupply ${Math.round(oldSupply).toLocaleString()} → ${newSupply.toLocaleString()}`
    );
    console.log(`fund: quotedNav ${oldNav.toFixed(4)} → ${newNav.toFixed(4)} ₳`);
    console.log(
      `liability: old ${Math.round(oldSupply * oldNav).toLocaleString()} ₳ | new ${Math.round(newSupply * newNav).toLocaleString()} ₳`
    );
    console.log(`positions: ${positions.length} | pending redemptions: ${pendingQueue.length}`);
    console.log(`holder-value drift: ${(drift * 100).toFixed(6)}% (must be ~0)`);
    if (Math.abs(drift) > 0.001) throw new Error("Holder-value drift too large — aborting");

    if (!APPLY) {
      console.log("\nDry-run only — no writes. Re-run with --apply to commit.");
      return;
    }

    const now = new Date();
    await db
      .collection("indexFunds")
      .updateOne(
        { _id: fund._id },
        { $set: { unitSupply: newSupply, quotedNav: newNav, updatedAt: now } }
      );
    const posOps = positions.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { units: Math.round((p.units || 0) / F), updatedAt: now } },
      },
    }));
    if (posOps.length) await db.collection("indexFundPositions").bulkWrite(posOps);
    const queueOps = pendingQueue.map((q) => ({
      updateOne: {
        filter: { _id: q._id },
        update: { $set: { units: Math.round((q.units || 0) / F), updatedAt: now } },
      },
    }));
    if (queueOps.length) await db.collection("indexFundRedemptionQueue").bulkWrite(queueOps);

    console.log(
      `\nApplied: fund + ${posOps.length} positions + ${queueOps.length} queued redemptions rebased.`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
