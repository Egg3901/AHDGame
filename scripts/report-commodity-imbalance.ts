/**
 * Report the supply/demand imbalance per commodity for a world.
 *
 * Built while diagnosing why a 400-turn 1953 soak at the `ledger` tier ends with
 * an 18x spread between the dearest and cheapest commodity. The aggregate
 * `inflationIndex` hides this completely — it is a mean over 28 commodities, so
 * a world where natural gas runs at 6x base and food at 0.36x reports as
 * "2.33x inflation" and looks like ordinary inflation.
 *
 * Reads `commodityFlows` (per-turn supply/demand/unmet/stock) and joins the
 * price ratio from `commodityPrices`. Read-only.
 *
 * Two failure shapes to look for:
 *   - unmet% high with stockUnits 0: chronic shortage, no buffer ever forms,
 *     price compounds upward every turn.
 *   - coverTurns very high: a glut nobody consumes, sitting as dead inventory.
 *
 * Usage:
 *   MONGODB_URI=... npx tsx scripts/report-commodity-imbalance.ts
 *   MONGODB_URI=... npx tsx scripts/report-commodity-imbalance.ts --turn=401
 */

import { connectDb, closeDb } from "./utils/db";

const turnArg = process.argv.find((a) => a.startsWith("--turn="));

interface FlowRow {
  commodity: string;
  turn: number;
  supplyUnits?: number;
  demandUnits?: number;
  unmetDemandUnits?: number;
  stockUnits?: number;
  coverTurns?: number | null;
}

async function main() {
  const db = await connectDb();

  const latest = turnArg
    ? Number(turnArg.split("=")[1])
    : (
        await db
          .collection<FlowRow>("commodityFlows")
          .find({}, { projection: { turn: 1 } })
          .sort({ turn: -1 })
          .limit(1)
          .toArray()
      )[0]?.turn;

  if (latest == null) {
    console.log("No commodityFlows rows — this world has not run a market turn.");
    await closeDb();
    return;
  }

  const flows = await db.collection<FlowRow>("commodityFlows").find({ turn: latest }).toArray();
  const prices = await db
    .collection<{ commodity: string; basePrice: number; globalPrice: number }>("commodityPrices")
    .find({})
    .toArray();
  const priceRatio = new Map(prices.map((p) => [p.commodity, p.globalPrice / p.basePrice]));

  const rows = flows
    .map((f) => {
      const demand = f.demandUnits ?? 0;
      return {
        commodity: f.commodity,
        supply: f.supplyUnits ?? 0,
        demand,
        unmetPct: demand > 0 ? (100 * (f.unmetDemandUnits ?? 0)) / demand : 0,
        stock: f.stockUnits ?? 0,
        cover: f.coverTurns ?? null,
        x: priceRatio.get(f.commodity) ?? null,
      };
    })
    .sort((a, b) => b.unmetPct - a.unmetPct);

  console.log(`Commodity imbalance at turn ${latest}\n`);
  console.log("commodity                price     supply     demand   unmet%      stock  cover");
  for (const r of rows) {
    console.log(
      "  " +
        r.commodity.padEnd(23) +
        (r.x != null ? `${r.x.toFixed(2)}x` : "-").padStart(6) +
        String(Math.round(r.supply)).padStart(11) +
        String(Math.round(r.demand)).padStart(11) +
        `${r.unmetPct.toFixed(0)}%`.padStart(8) +
        String(Math.round(r.stock)).padStart(11) +
        (r.cover != null ? r.cover.toFixed(0) : "-").padStart(7)
    );
  }

  const starved = rows.filter((r) => r.unmetPct >= 25 && r.stock === 0);
  const glutted = rows.filter((r) => (r.cover ?? 0) >= 24);
  const ratios = rows.map((r) => r.x).filter((v): v is number => v != null && v > 0);
  const spread = ratios.length ? Math.max(...ratios) / Math.min(...ratios) : 0;

  console.log(
    `\n${starved.length} commodities starved (>=25% unmet with zero stock): ${starved.map((r) => r.commodity).join(", ") || "none"}`
  );
  console.log(
    `${glutted.length} glutted (>=24 turns of cover): ${glutted.map((r) => `${r.commodity} ${r.cover?.toFixed(0)}t`).join(", ") || "none"}`
  );
  console.log(`price spread dearest/cheapest: ${spread.toFixed(1)}x`);

  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
