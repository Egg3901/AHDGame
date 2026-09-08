/**
 * Strategy-aware capacity pricing: does making capacity cost what it earns
 * price focused production methods out of the game?
 *
 * The balance report for threading `strategyId` through `capacityPricePerUnit`
 * and `computeBuildCost`.
 *
 *   BEFORE  price = GROWTH_COST_MULTIPLIER x RPU(sectorType default) x eraIndex
 *   AFTER   price = GROWTH_COST_MULTIPLIER x RPU(sectorType, strategy) x eraIndex
 *
 * Three arms:
 *
 *   A  PAYBACK. For every (type, strategy) pair, turns of revenue needed to
 *      repay one unit of capacity, before and after. This is the defect: the
 *      design intends a uniform GROWTH_COST_MULTIPLIER days for everyone, and
 *      BEFORE it ranges over four orders of magnitude.
 *
 *   B  THE SPECIALISATION QUESTION, which is the one a reviewer will actually
 *      ask. If a focused strategy costs proportionally more to build AND earns
 *      proportionally more, is there any reason left to focus? Measured as the
 *      return on a fixed capex budget, before and after, per pair.
 *
 *   C  LIVE EXPOSURE. Against the live board: how many sectors run each
 *      strategy, what they would cost to rebuild at the new price, and which
 *      pairs are extreme enough to be defects rather than design.
 *
 *   npx tsx scripts/sim/strategyCapacityPricing2026-09-07.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  CAPACITY_ANCHOR_YEAR,
  capacityPricePerUnit,
  revenuePerCapacityUnit,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { GROWTH_COST_MULTIPLIER } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

/** The pre-fix price: always the sector type's default mix. */
function priceBefore(type: CorporationType, year: number, scale: number): number {
  return GROWTH_COST_MULTIPLIER * revenuePerCapacityUnit(type, scale) * eraIndexOf(year);
}
/** Era index, recovered by dividing the real function through its other terms. */
function eraIndexOf(year: number): number {
  const at1 = capacityPricePerUnit("manufacturing", year, 1, null);
  const atAnchor = capacityPricePerUnit("manufacturing", CAPACITY_ANCHOR_YEAR, 1, null);
  return atAnchor > 0 ? at1 / atAnchor : 1;
}

interface Row {
  type: string;
  strategy: string;
  rpu: number;
  paybackBefore: number;
  paybackAfter: number;
  returnRatio: number;
}

function buildRows(year: number, scale: number): Row[] {
  const rows: Row[] = [];
  for (const [type, strategies] of Object.entries(SECTOR_STRATEGIES)) {
    const t = type as CorporationType;
    for (const s of strategies ?? []) {
      const rpu = revenuePerCapacityUnitForStrategy(t, s.id, scale);
      if (!(rpu > 0)) continue;
      const before = priceBefore(t, year, scale);
      const after = capacityPricePerUnit(t, year, scale, s.id);
      // Payback in TURNS: price is anchor-per-unit, rpu is anchor-per-DAY-per-unit.
      rows.push({
        type,
        strategy: s.id,
        rpu,
        paybackBefore: (before / rpu) * TURNS_PER_DAY,
        paybackAfter: (after / rpu) * TURNS_PER_DAY,
        // Arm B: revenue/day bought per unit of capex, after / before.
        returnRatio: before > 0 && after > 0 ? before / after : Number.NaN,
      });
    }
  }
  return rows;
}

async function main() {
  const year = Number(process.env.SIM_YEAR ?? 1966);
  const scale = Number(process.env.SIM_ERA_UNIT_SCALE ?? 70);
  const rows = buildRows(year, scale);
  const intended = GROWTH_COST_MULTIPLIER * TURNS_PER_DAY;

  console.log(`\nstrategy capacity pricing, year ${year}, eraUnitScale ${scale}`);
  console.log(`intended payback: GROWTH_COST_MULTIPLIER x TURNS_PER_DAY = ${intended} turns\n`);

  // ── ARM A ────────────────────────────────────────────────────────────────
  console.log("=== ARM A: payback in turns, per unit of capacity ===");
  console.log("pair".padEnd(46) + "before".padStart(12) + "after".padStart(10));
  const sorted = [...rows].sort((a, b) => a.paybackBefore - b.paybackBefore);
  for (const r of sorted) {
    const flag =
      r.paybackBefore < intended / 5 || r.paybackBefore > intended * 5 ? "  <-- extreme" : "";
    console.log(
      `${(r.type + "/" + r.strategy).padEnd(46)}${r.paybackBefore.toFixed(2).padStart(12)}${r.paybackAfter.toFixed(2).padStart(10)}${flag}`
    );
  }
  const spreadBefore =
    Math.max(...rows.map((r) => r.paybackBefore)) / Math.min(...rows.map((r) => r.paybackBefore));
  const afterOk = rows.every((r) => Math.abs(r.paybackAfter - intended) < 1e-6);
  console.log(`\nBEFORE payback spread: ${spreadBefore.toFixed(0)}x across ${rows.length} pairs`);
  console.log(`AFTER  every pair repays in exactly ${intended} turns: ${afterOk}\n`);

  // ── ARM B ────────────────────────────────────────────────────────────────
  console.log("=== ARM B: does focusing still pay? ===");
  console.log("Revenue/day bought per unit of capex, AFTER / BEFORE.");
  console.log("1.00 = unchanged. Below 1 = focusing got relatively dearer.\n");
  const cheaper = rows.filter((r) => r.returnRatio > 1.05);
  const dearer = rows.filter((r) => r.returnRatio < 0.95);
  console.log(`  ${dearer.length} pairs get relatively DEARER (they were underpriced)`);
  console.log(`  ${cheaper.length} pairs get relatively CHEAPER (they were OVERpriced)`);
  console.log(`  ${rows.length - cheaper.length - dearer.length} within 5%\n`);
  console.log("most affected, both directions:");
  const byRatio = [...rows].sort((a, b) => a.returnRatio - b.returnRatio);
  for (const r of [...byRatio.slice(0, 8), ...byRatio.slice(-8)]) {
    console.log(
      `${(r.type + "/" + r.strategy).padEnd(46)}${r.returnRatio.toFixed(3).padStart(10)}x`
    );
  }
  console.log(
    "\nREADING: after the fix every strategy returns GROWTH_COST_MULTIPLIER days\n" +
      "of revenue per unit of capex, so capital efficiency no longer varies by\n" +
      "production method. Focusing still pays, but through the commodity market\n" +
      "(shortage premiums, dominance in one commodity, supply agreements) rather\n" +
      "than through a hidden discount on capacity. That is the intended shape;\n" +
      "confirm it is the DESIRED shape before shipping.\n"
  );

  // ── ARM C ────────────────────────────────────────────────────────────────
  let uri = process.env.MONGODB_URI_LIVE;
  if (!uri) {
    console.log("=== ARM C skipped: MONGODB_URI_LIVE not set ===");
    return;
  }
  if (!/directConnection=/.test(uri))
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const sectors = await db
      .collection("corporateSectors")
      .aggregate([
        {
          $group: {
            _id: { t: "$sectorType", s: "$strategyId" },
            n: { $sum: 1 },
            stock: { $sum: "$capitalStock" },
          },
        },
        { $sort: { n: -1 } },
      ])
      .toArray();
    console.log("=== ARM C: live exposure ===");
    console.log("pair".padEnd(46) + "sectors".padStart(9) + "payback now".padStart(14));
    let extreme = 0;
    let total = 0;
    for (const row of sectors) {
      const t = row._id.t as CorporationType;
      const s = (row._id.s as string | null) ?? "standard";
      const match = rows.find((r) => r.type === t && r.strategy === s);
      total += row.n;
      if (!match) continue;
      const isExtreme = match.paybackBefore < intended / 5;
      if (isExtreme) extreme += row.n;
      console.log(
        `${(t + "/" + s).padEnd(46)}${String(row.n).padStart(9)}${match.paybackBefore.toFixed(2).padStart(14)}${isExtreme ? "  <-- extreme" : ""}`
      );
    }
    console.log(
      `\n${total} sectors on the board; ${extreme} sit on a pair repaying in under ${(intended / 5).toFixed(0)} turns.`
    );
    console.log(
      "Those are the defect candidates. Everything else is inside a factor of 5\n" +
        "of the intended payback and is arguably the designed reward for focusing."
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
