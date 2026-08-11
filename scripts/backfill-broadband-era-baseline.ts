/**
 * One-off repair: lift stranded broadband values to their era-normal level.
 *
 * The 1991 preset seeds broadbandAccess at 0; the policy-decay phase kept the
 * value resting at that anachronistic seed, so a 2010 world reads ~0-3%. The
 * code fix (calculateMetricTarget era-aware baseline) makes broadband rest at
 * the era-band `best` going forward, but decay is 0.25%/turn, so this migration
 * sets the value immediately. simBaseline is left untouched (already ~71).
 *
 * Targets ONLY states whose broadband seed is out-of-era (seed < era-band worst)
 * and whose current value is below era-band best — per country, at the live year.
 *
 * Usage:
 *   npx tsx scripts/backfill-broadband-era-baseline.ts            # dry-run
 *   npx tsx scripts/backfill-broadband-era-baseline.ts --apply    # write
 *
 * Connects to MONGODB_URI_LIVE (directConnection) per project convention.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { getEraBand } from "../src/lib/era/metricCatalog";
import { resolveGameYear } from "../src/lib/era/era";
import type { GameState } from "../src/lib/db/types/gameState";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

interface Row {
  id: string;
  cc: string;
  before: number;
  target: number;
}

async function main() {
  const client = new MongoClient(uri!, { directConnection: true });
  await client.connect();
  const db = client.db();

  const gs = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1, eraSystemEnabled: 1 } }
    );
  const eraYear = gs?.eraSystemEnabled
    ? resolveGameYear(gs as { currentYear?: number; currentTurn?: number; startingYear?: number })
    : null;
  console.log(`eraSystemEnabled=${gs?.eraSystemEnabled} eraYear=${eraYear} APPLY=${APPLY}`);
  if (eraYear == null) {
    console.log("Era system off — nothing to repair (fix is era-gated). Exiting.");
    await client.close();
    return;
  }

  const states = await db
    .collection("stateMetrics")
    .find({}, { projection: { _id: 1, countryId: 1, "infrastructure.broadbandAccess.value": 1 } })
    .toArray();
  const baselines = new Map<string, Record<string, Record<string, number>> | undefined>(
    (await db.collection("stateBaselines").find({}).toArray()).map((b) => [
      String(b._id),
      b.baselines as Record<string, Record<string, number>> | undefined,
    ])
  );

  const toFix: Row[] = [];
  for (const s of states) {
    const cc = s.countryId as string | undefined;
    if (!cc) continue;
    const band = getEraBand("broadbandAccess", cc, eraYear);
    if (!band) continue;
    const seed = baselines.get(String(s._id))?.infrastructure?.broadbandAccess;
    const value = (s.infrastructure as { broadbandAccess?: { value?: number } } | undefined)
      ?.broadbandAccess?.value;
    if (!Number.isFinite(seed) || !Number.isFinite(value)) continue;
    // out-of-era seed AND currently below the era-normal
    if ((seed as number) < band.worst && (value as number) < band.best) {
      toFix.push({ id: String(s._id), cc, before: value as number, target: band.best });
    }
  }

  // Per-country summary
  const byCc = new Map<string, Row[]>();
  for (const r of toFix) byCc.set(r.cc, [...(byCc.get(r.cc) ?? []), r]);
  console.log(`\nStates to repair: ${toFix.length}`);
  for (const [cc, rows] of byCc) {
    const befores = rows.map((r) => r.before).sort((a, b) => a - b);
    console.log(
      `  ${cc}: n=${rows.length} target=${rows[0].target.toFixed(2)} ` +
        `before[min=${befores[0].toFixed(2)} max=${befores[befores.length - 1].toFixed(2)}]`
    );
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — no writes. Re-run with --apply to write.");
    await client.close();
    return;
  }

  const ops = toFix.map((r) => ({
    updateOne: {
      filter: { _id: r.id },
      update: { $set: { "infrastructure.broadbandAccess.value": r.target } },
    },
  }));
  if (ops.length) {
    const res = await db.collection("stateMetrics").bulkWrite(ops as never);
    console.log(`\nAPPLIED: modified ${res.modifiedCount} states.`);
  } else {
    console.log("\nNothing to apply.");
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
