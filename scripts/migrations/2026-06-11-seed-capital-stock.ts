/**
 * Seed the per-region Solow capital stock (P1c-0): `state.capitalStock ≈ 3 × gdp`
 * (millions — the SAME unit as `state.gdp`). The metric-engine phase advances the
 * stock each turn and cold-starts from `gdp` on first touch, so this migration is
 * only a convenience to stand up a sane initial `K/Y ≈ 3` for live games before
 * the P1c-1 potential layer reads `ΔK/K`.
 *
 * Imports the REAL `seedCapitalStock` SSOT (no duplicated logic). Only seeds
 * regions that LACK `capitalStock`, so re-running never clobbers a stock the
 * engine has already advanced (safe to re-run on a live game).
 *
 * Guarded (mirrors 2026-06-10-seed-cohort-vectors.ts):
 *   - DRY RUN by default. `--apply` to write.
 *   - `--live` targets MONGODB_URI_LIVE (else MONGODB_URI).
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-06-11-seed-capital-stock.ts                 # dry-run (local)
 *   npx tsx scripts/migrations/2026-06-11-seed-capital-stock.ts --apply         # write (local)
 *   npx tsx scripts/migrations/2026-06-11-seed-capital-stock.ts --live --apply  # write (live)
 */

import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { CountryId } from "@/lib/constants/countries";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { seedCapitalStock } from "@/lib/metricEngine/capitalStock";
import type { State } from "@/lib/db/types/state";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const useLive = argv.includes("--live");

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

interface StateDoc {
  _id: string;
  countryId: CountryId;
  gdp?: number;
  capitalStock?: number;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  console.log(apply ? "=== APPLY MODE ===" : "=== DRY RUN ===");
  try {
    const db = client.db();

    const states = await db
      .collection("states")
      .find<StateDoc>({}, { projection: { _id: 1, countryId: 1, gdp: 1, capitalStock: 1 } })
      .toArray();
    const realStates = states.filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id)));

    const ops: AnyBulkWriteOperation<State>[] = [];
    const skipped: string[] = [];
    let totalGdp = 0;
    let totalCapital = 0;

    for (const state of realStates) {
      const id = String(state._id);
      if (typeof state.capitalStock === "number" && Number.isFinite(state.capitalStock)) {
        skipped.push(`${id}: already has capitalStock (${fmt(state.capitalStock)})`);
        continue;
      }
      const gdp = state.gdp ?? 0;
      if (!(gdp > 0)) {
        skipped.push(`${id}: no positive gdp`);
        continue;
      }
      const capital = seedCapitalStock(gdp);
      totalGdp += gdp;
      totalCapital += capital;
      ops.push({ updateOne: { filter: { _id: id }, update: { $set: { capitalStock: capital } } } });
    }

    const ratio = totalGdp > 0 ? totalCapital / totalGdp : 0;
    console.log(
      `\nSeeding ${ops.length}/${realStates.length} regions (${skipped.length} skipped). ` +
        `Σ gdp: ${fmt(totalGdp)}M, Σ capital: ${fmt(totalCapital)}M, K/Y = ${ratio.toFixed(2)}`
    );
    if (skipped.length) {
      console.log("Skipped:");
      for (const s of skipped) console.log(`  - ${s}`);
    }

    if (apply) {
      if (ops.length) await db.collection<State>("states").bulkWrite(ops);
      console.log(`\nApplied: set capitalStock on ${ops.length} regions.`);
    } else {
      console.log(`\nDry run only — re-run with --apply to write ${ops.length} regions.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
