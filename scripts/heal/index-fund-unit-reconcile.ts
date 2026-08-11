/**
 * One-off repair: reconcile index-fund `unitSupply` to the real sum of holder
 * positions, then recompute NAV and backing.
 *
 * Background: a bug let `indexFunds.unitSupply` drift ABOVE the actual sum of
 * `indexFundPositions[].units` for a fund. Because NAV = backing / unitSupply,
 * an inflated unitSupply craters NAV and backing. JP25 was the worst case
 * (unitSupply 10,089,252 vs 500,000 real units, NAV → ~0) and additionally had
 * its cash drained to ~135, so it is reset to the seed baseline (NAV 100).
 *
 * Positions are the source of truth — this sets unitSupply = sum(positions).
 *
 * Usage (dry-run by default; pass --apply to write):
 *   npx tsx scripts/heal/index-fund-unit-reconcile.ts            # preview
 *   npx tsx scripts/heal/index-fund-unit-reconcile.ts --apply    # execute
 *
 * DB target: reads MONGODB_URI from .env.local by default. To target prod, set
 *   HEAL_MONGO_URI to the prod connection string before running.
 */
import { config } from "dotenv";
import { MongoClient, type ObjectId } from "mongodb";

config({ path: ".env.local" });

const INITIAL_NAV = 100; // INDEX_FUND_INITIAL_NAV
const DB_NAME = "a-house-divided";
const APPLY = process.argv.includes("--apply");

type Holding = { shares: number; avgCostPerShareAnchor?: number; lastValueAnchor?: number };
type BondAllocation = { principalAnchor: number };
type Fund = {
  _id: ObjectId;
  slug: string;
  tickerSymbol: string;
  anchorCurrencyCode: string;
  status: string;
  quotedNav: number;
  unitSupply: number;
  reserveUnits: number;
  cashAnchor: number;
  holdings: Holding[];
  bondAllocations?: BondAllocation[];
};
type Position = { holderKind: string; units: number };

function holdingsValueAnchor(fund: Fund): number {
  return (fund.holdings ?? []).reduce((sum, h) => {
    const v = h.lastValueAnchor ?? h.shares * (h.avgCostPerShareAnchor ?? 0);
    return sum + (Number.isFinite(v) ? Math.max(0, v) : 0);
  }, 0);
}
function bondPrincipalAnchor(fund: Fund): number {
  return (fund.bondAllocations ?? []).reduce(
    (sum, r) => sum + (Number.isFinite(r.principalAnchor) ? Math.max(0, r.principalAnchor) : 0),
    0
  );
}

async function main() {
  const uri = process.env.HEAL_MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("No MONGODB_URI / HEAL_MONGO_URI in environment");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — index fund unit reconcile\n`);

  try {
    const funds = (await db.collection("indexFunds").find({}).toArray()) as unknown as Fund[];
    let changed = 0;

    for (const fund of funds) {
      const positions = (await db
        .collection("indexFundPositions")
        .find({ fundId: fund._id })
        .toArray()) as unknown as Position[];
      const posSum = positions.reduce((a, p) => a + p.units, 0);
      const nonReserve = positions.filter((p) => p.holderKind !== "fund_reserve");
      const hVal = holdingsValueAnchor(fund);
      const bVal = bondPrincipalAnchor(fund);

      if (fund.unitSupply === posSum) continue; // in sync, skip

      changed++;
      const set: Partial<Fund> = {};

      // JP25-style total casualty: no real holders, no holdings, and backing per
      // real unit has collapsed far below the seed NAV (cash was drained too).
      // Reset to seed baseline so NAV returns to 100.
      const reconciledNav = posSum > 0 ? (fund.cashAnchor + hVal + bVal) / posSum : 0;
      const isEmptyCasualty =
        nonReserve.length === 0 && hVal === 0 && reconciledNav < INITIAL_NAV * 0.5;
      if (isEmptyCasualty) {
        set.unitSupply = posSum; // = reserve units
        set.cashAnchor = INITIAL_NAV * posSum + bVal; // backing for NAV 100
        set.quotedNav = INITIAL_NAV;
      } else {
        // Reconcile unit count; NAV = backing / units, backing ratio → 1.0.
        const backing = fund.cashAnchor + hVal + bVal;
        set.unitSupply = posSum;
        set.quotedNav = posSum > 0 ? backing / posSum : fund.quotedNav;
      }
      const newNav = set.quotedNav ?? fund.quotedNav;
      const newCash = set.cashAnchor ?? fund.cashAnchor;
      const newBacking = newCash + hVal + bVal;
      const newRatio = newNav * posSum > 0 ? newBacking / (newNav * posSum) : 1;

      console.log(
        `${fund.tickerSymbol.padEnd(7)} ${fund.status.padEnd(8)} ` +
          `units ${fund.unitSupply} → ${set.unitSupply} | ` +
          `NAV ${fund.quotedNav.toPrecision(4)} → ${newNav.toPrecision(4)} | ` +
          `cash ${Math.round(fund.cashAnchor).toLocaleString()} → ${Math.round(newCash).toLocaleString()} ${fund.anchorCurrencyCode} | ` +
          `backing → ${(newRatio * 100).toFixed(1)}%${isEmptyCasualty ? "  [SEED RESET]" : ""}`
      );

      if (APPLY) {
        await db
          .collection("indexFunds")
          .updateOne(
            { _id: fund._id },
            { $set: { ...set, backingRatio: newRatio, updatedAt: new Date() } }
          );
      }
    }

    console.log(`\n${changed} fund(s) ${APPLY ? "repaired" : "would be repaired"}.`);
    if (!APPLY && changed > 0) console.log("Re-run with --apply to write changes.\n");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
