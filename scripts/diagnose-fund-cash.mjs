/**
 * Diagnose index fund cash state on production.
 * Run via: railway run --service "Main Site" node scripts/diagnose-fund-cash.mjs
 */

import { MongoClient } from "mongodb";

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) throw new Error("MONGO_URL not set");

const client = new MongoClient(MONGO_URL);
await client.connect();
const db = client.db("a-house-divided");

// ── 1. Fund cash state ────────────────────────────────────────────────────────
console.log("\n=== FUND CASH STATE ===");
const funds = await db
  .collection("indexFunds")
  .find({})
  .project({
    slug: 1,
    name: 1,
    status: 1,
    cashAnchor: 1,
    unitSupply: 1,
    quotedNav: 1,
    backingRatio: 1,
  })
  .toArray();

for (const f of funds) {
  const aum = (f.quotedNav ?? 0) * (f.unitSupply ?? 0);
  const cashPct = aum > 0 ? ((f.cashAnchor / aum) * 100).toFixed(1) : "N/A";
  console.log(
    `  ${f.slug} | status=${f.status} | cashAnchor=${f.cashAnchor?.toFixed(2)} ` +
      `| NAV=${f.quotedNav?.toFixed(2)} | units=${f.unitSupply} | AUM=${aum.toFixed(2)} | cash%AUM=${cashPct}% ` +
      `| backingRatio=${f.backingRatio?.toFixed(4) ?? "N/A"}`
  );
}

// ── 2. Open limit buy orders placed by funds (escrowed cash) ──────────────────
console.log("\n=== OPEN FUND BID ORDERS (ESCROWED CASH) ===");
const openBids = await db
  .collection("shareOrders")
  .find({ placerFundId: { $exists: true }, type: "buy", status: "open" })
  .toArray();

const escrowByFundId = new Map();
const bidCountByFundId = new Map();
for (const o of openBids) {
  const key = o.placerFundId.toString();
  escrowByFundId.set(key, (escrowByFundId.get(key) ?? 0) + (o.escrowAnchor ?? 0));
  bidCountByFundId.set(key, (bidCountByFundId.get(key) ?? 0) + 1);
}

const fundById = new Map(funds.map((f) => [f._id.toString(), f]));
for (const [fundId, escrow] of escrowByFundId) {
  const f = fundById.get(fundId);
  console.log(
    `  ${f?.slug ?? fundId} | openBids=${bidCountByFundId.get(fundId)} | escrowAnchor=${escrow.toFixed(2)}`
  );
}
console.log(
  `  Total open fund bids: ${openBids.length}, Total escrowed: ${[...escrowByFundId.values()].reduce((a, b) => a + b, 0).toFixed(2)}`
);

// ── 3. Recent fund tx history (last 50 per fund sorted by largest cash drains) ─
console.log("\n=== LARGEST RECENT CASH DRAINS (indexFundTransactions, past 48h) ===");
const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
const drainKinds = ["public_float_buy", "cross_fund_buy", "bond_allocation"];
const recentDrains = await db
  .collection("indexFundTransactions")
  .find({ kind: { $in: drainKinds }, createdAt: { $gte: since } })
  .sort({ amountAnchor: -1 })
  .limit(20)
  .toArray();

for (const tx of recentDrains) {
  const f = fundById.get(tx.fundId.toString());
  console.log(
    `  ${f?.slug ?? tx.fundId} | kind=${tx.kind} | amount=${tx.amountAnchor?.toFixed(2)} ` +
      `| shares=${tx.shares ?? "-"} | createdAt=${tx.createdAt?.toISOString()}`
  );
}

// ── 4. Redemptions paid in last 48h ──────────────────────────────────────────
console.log("\n=== RECENT REDEMPTIONS PAID (past 48h) ===");
const recentRedemptions = await db
  .collection("indexFundTransactions")
  .find({ kind: "redemption", createdAt: { $gte: since } })
  .sort({ amountAnchor: -1 })
  .limit(20)
  .toArray();

let totalRedemptionPaid = 0;
for (const tx of recentRedemptions) {
  totalRedemptionPaid += tx.amountAnchor ?? 0;
  const f = fundById.get(tx.fundId.toString());
  console.log(
    `  ${f?.slug ?? tx.fundId} | units=${tx.units} | amount=${tx.amountAnchor?.toFixed(2)} ` +
      `| nav=${tx.navAnchor?.toFixed(4)} | createdAt=${tx.createdAt?.toISOString()}`
  );
}
console.log(`  Total redeemed: ${totalRedemptionPaid.toFixed(2)}`);

// ── 5. Fund snapshots: cash trend over last 24 turns ─────────────────────────
console.log("\n=== FUND CASH TREND (last 24 snapshots per fund) ===");
for (const fund of funds) {
  const snaps = await db
    .collection("indexFundSnapshots")
    .find({ fundId: fund._id })
    .sort({ turn: -1 })
    .limit(24)
    .project({ turn: 1, cashAnchor: 1, totalHoldingsValueAnchor: 1, backingRatio: 1 })
    .toArray();

  if (snaps.length === 0) continue;
  const oldest = snaps[snaps.length - 1];
  const newest = snaps[0];
  const cashDelta = newest.cashAnchor - oldest.cashAnchor;
  console.log(
    `  ${fund.slug} | turns ${oldest.turn}→${newest.turn} | ` +
      `cashAnchor: ${oldest.cashAnchor?.toFixed(2)} → ${newest.cashAnchor?.toFixed(2)} ` +
      `(delta: ${cashDelta >= 0 ? "+" : ""}${cashDelta.toFixed(2)})`
  );
}

// ── 6. Pending redemption queue ───────────────────────────────────────────────
console.log("\n=== PENDING REDEMPTION QUEUE ===");
const pendingQueue = await db
  .collection("indexFundRedemptionQueue")
  .find({ status: { $in: ["queued", "partial"] } })
  .toArray();

let totalQueued = 0;
for (const entry of pendingQueue) {
  totalQueued += entry.requestedAmountAnchor ?? 0;
  const f = fundById.get(entry.fundId.toString());
  console.log(
    `  ${f?.slug ?? entry.fundId} | units=${entry.units} ` +
      `| requestedAmt=${entry.requestedAmountAnchor?.toFixed(2)} | status=${entry.status}`
  );
}
console.log(`  Total pending redemption obligations: ${totalQueued.toFixed(2)}`);

await client.close();
console.log("\nDone.");
