/**
 * Projects the commodity-market impact of the three arsenal defence strategies, and reports
 * the lot economics C2's two cost constants are derived from.
 *
 * WHY A PROJECTION, NOT A BEFORE/AFTER. Authoring a production strategy changes nothing on
 * the live board until a CEO adopts it, so measuring the market before and after the edit
 * would show a zero delta and prove nothing. The question that actually matters is
 * conditional: IF the existing defence sectors switched to each new line, what happens to
 * the commodities they touch? That is what this computes.
 *
 * Read-only. Touches no game state.
 *
 * Usage: npx tsx scripts/calibrate-arsenal.ts
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";
import { SECTOR_STRATEGIES } from "../src/lib/constants/sectorStrategies";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../src/lib/constants/commodities";

const NEW_LINES = ["naval_systems", "missile_systems", "aerospace"] as const;
const EXISTING_LINES = ["heavy_armor", "munitions", "directed_energy", "cyber", "standard"];

interface SectorRow {
  countryId?: string;
  strategyId?: string;
  revenue?: number;
  realizedRevenue?: number;
}

/** Commodity units a sector's revenue generates at a given rate: units = revenue × rate / basePrice. */
function units(revenue: number, rate: number, commodity: string): number {
  const base = COMMODITY_BASE_PRICES[commodity as CommodityType] ?? 1;
  return (revenue * rate) / base;
}

function footprint(strategyId: string, revenue: number) {
  const s = SECTOR_STRATEGIES.defense.find((x) => x.id === strategyId);
  if (!s) return null;
  const supply: Record<string, number> = {};
  const demand: Record<string, number> = {};
  for (const [c, r] of Object.entries(s.supply)) supply[c] = units(revenue, r as number, c);
  for (const [c, r] of Object.entries(s.demand)) demand[c] = units(revenue, r as number, c);
  return { supply, demand };
}

async function main() {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uri = envFile.match(/MONGODB_URI=(.+)/)?.[1].trim();
  if (!uri) throw new Error("MONGODB_URI not found in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    const sectors = (await db
      .collection("corporateSectors")
      .find({ sectorType: "defense" })
      .toArray()) as unknown as SectorRow[];

    const totalRevenue = sectors.reduce((s, x) => s + (x.realizedRevenue ?? x.revenue ?? 0), 0);
    console.log(`\n=== DEFENCE SECTORS ===`);
    console.log(
      `${sectors.length} defence sectors, total daily revenue ${totalRevenue.toExponential(3)}`
    );
    const byStrategy = new Map<string, number>();
    for (const s of sectors) {
      const id = s.strategyId ?? "standard";
      byStrategy.set(id, (byStrategy.get(id) ?? 0) + 1);
    }
    for (const [id, n] of [...byStrategy].sort((a, b) => b[1] - a[1])) {
      const known = [...EXISTING_LINES, ...NEW_LINES].includes(id) ? "" : "  <- UNKNOWN";
      console.log(`  ${id.padEnd(18)} ${String(n).padStart(4)} sectors${known}`);
    }

    // Per-unit-of-revenue footprint, so the new lines can be compared to the old ones on
    // equal terms regardless of how big the sectors currently are.
    console.log(`\n=== FOOTPRINT PER 1,000 REVENUE (units) ===`);
    console.log(`strategy            commodity            supply     demand      net`);
    for (const id of [...EXISTING_LINES, ...NEW_LINES]) {
      const f = footprint(id, 1_000);
      if (!f) continue;
      const commodities = new Set([...Object.keys(f.supply), ...Object.keys(f.demand)]);
      const isNew = (NEW_LINES as readonly string[]).includes(id);
      for (const c of [...commodities].sort()) {
        const sup = f.supply[c] ?? 0;
        const dem = f.demand[c] ?? 0;
        console.log(
          [
            (isNew ? `* ${id}` : `  ${id}`).padEnd(20),
            c.padEnd(20),
            sup.toFixed(3).padStart(8),
            dem.toFixed(3).padStart(10),
            (sup - dem).toFixed(3).padStart(9),
          ].join(" ")
        );
      }
    }

    // The conditional the design actually needs answered — and it must be a DELTA against
    // what those sectors run TODAY, not against zero. Every defence sector currently sits on
    // one of the existing lines, so adopting a new one changes the board by (new − current),
    // and an absolute footprint invites exactly the wrong conclusion.
    console.log(`\n=== PROJECTED DELTA IF EVERY DEFENCE SECTOR SWITCHED TO EACH NEW LINE ===`);
    console.log(`(vs what they run today, weighted by each sector's own revenue)`);

    const currentNet = new Map<string, number>();
    for (const s of sectors) {
      const rev = s.realizedRevenue ?? s.revenue ?? 0;
      const f = footprint(s.strategyId ?? "standard", rev);
      if (!f) continue;
      for (const c of new Set([...Object.keys(f.supply), ...Object.keys(f.demand)])) {
        currentNet.set(c, (currentNet.get(c) ?? 0) + (f.supply[c] ?? 0) - (f.demand[c] ?? 0));
      }
    }

    for (const id of NEW_LINES) {
      const f = footprint(id, totalRevenue);
      if (!f) continue;
      console.log(`\n  ${id}`);
      const commodities = new Set([
        ...Object.keys(f.supply),
        ...Object.keys(f.demand),
        ...currentNet.keys(),
      ]);
      const rows: { c: string; delta: number }[] = [];
      for (const c of commodities) {
        const proposed = (f.supply[c] ?? 0) - (f.demand[c] ?? 0);
        const delta = proposed - (currentNet.get(c) ?? 0);
        if (Math.abs(delta) > 1e-9) rows.push({ c, delta });
      }
      rows.sort((a, b) => a.delta - b.delta);
      for (const { c, delta } of rows) {
        console.log(
          `    ${c.padEnd(22)} ${delta > 0 ? "+" : ""}${delta.toExponential(2).padStart(11)}  ` +
            `${delta > 0 ? "relieves" : "tightens"}`
        );
      }
    }
    // A raw delta is unreadable without the size of the market it lands in. Total demand
    // across ALL sectors is what says whether a defence-sector shift is a rounding error or
    // a re-rate — this is the number that decides whether the authored rates stand.
    console.log(`\n=== DELTA AS A SHARE OF EACH COMMODITY'S TOTAL MARKET DEMAND ===`);
    const allSectors = (await db
      .collection("corporateSectors")
      .find({}, { projection: { sectorType: 1, strategyId: 1, revenue: 1, realizedRevenue: 1 } })
      .toArray()) as unknown as (SectorRow & { sectorType?: string })[];

    const marketDemand = new Map<string, number>();
    for (const s of allSectors) {
      const list = SECTOR_STRATEGIES[s.sectorType as keyof typeof SECTOR_STRATEGIES];
      const strat = list?.find((x) => x.id === (s.strategyId ?? "standard")) ?? list?.[0];
      if (!strat) continue;
      const rev = s.realizedRevenue ?? s.revenue ?? 0;
      for (const [c, r] of Object.entries(strat.demand)) {
        marketDemand.set(c, (marketDemand.get(c) ?? 0) + units(rev, r as number, c));
      }
    }

    for (const id of NEW_LINES) {
      const f = footprint(id, totalRevenue);
      if (!f) continue;
      console.log(`\n  ${id}`);
      for (const c of [...new Set([...Object.keys(f.supply), ...Object.keys(f.demand)])].sort()) {
        const proposed = (f.supply[c] ?? 0) - (f.demand[c] ?? 0);
        const delta = proposed - (currentNet.get(c) ?? 0);
        const total = marketDemand.get(c) ?? 0;
        const pct = total > 0 ? (delta / total) * 100 : 0;
        const flag = Math.abs(pct) >= 5 ? "  <-- RE-RATE IF THIS COMMODITY IS SHORT" : "";
        console.log(
          `    ${c.padEnd(22)} ${pct >= 0 ? "+" : ""}${pct.toFixed(2).padStart(7)}% of market demand${flag}`
        );
      }
    }

    console.log(
      `\nCross-check every flagged row against scripts/debug/audit-commodity-balance.mjs.\n` +
        `A line moving >5% of a market that is already short (D/S > 1.5) must be re-rated.`
    );
  } finally {
    await client.close();
  }
}

void main();
