/**
 * One-time migration: give every country a defence appropriation holding ONE YEAR of
 * accrual, and capture the baseline GDP that military prices are anchored to.
 *
 * A year of grace is deliberate. The turn loop begins charging standing-force upkeep
 * against this account the moment the feature ships, and seeding it at a full year of
 * accrual means no existing force lands in arrears on that turn — every defence minister
 * gets a full game year to right-size before the mechanic bites.
 *
 * Idempotent: skips budgets that already carry `defenseAppropriation`, and only writes the
 * price baseline where `gdp > 0` (a zero baseline would anchor prices at zero and make
 * every unit free — the exact bug the anchor exists to avoid).
 *
 * REFUSES TO APPLY if any country would reach arrears inside a game year. That means the
 * seeded-roster measurement is stale relative to the defence lines, and applying anyway
 * would ship an army that starts sagging.
 *
 * Usage — TESTING database (MONGODB_URI):
 *   npx tsx scripts/migrations/2026-08-08-seed-defence-appropriation.ts
 *   npx tsx scripts/migrations/2026-08-08-seed-defence-appropriation.ts --apply
 *
 * Usage — LIVE database (MONGODB_URI_LIVE, Railway):
 *   npx tsx scripts/migrations/2026-08-08-seed-defence-appropriation.ts --live
 *   npx tsx scripts/migrations/2026-08-08-seed-defence-appropriation.ts --live --apply --i-understand-this-is-live
 *
 * The third flag is not decoration: `--apply --live` is one autocomplete away from the
 * testing command, and this writes to every country's budget document on the real game.
 */

import { MongoClient, type Db } from "mongodb";
import * as fs from "fs";
import type { FederalBudget } from "../../src/lib/db/types/budget";
import { resolveDefenseLineFrom } from "../../src/lib/turn/defenseEnvelope";
import { aggregateForce } from "../../src/lib/constants/military";
import { accrualPerTurn, upkeepPerTurn } from "../../src/lib/military/appropriation";
import { seedRosterUpkeepFor } from "../../src/lib/military/seedRosterUpkeep";
import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";
import { DEFAULT_SEED_PRESET } from "../../src/lib/constants/seedPreset";
import type { MilitaryUnit } from "../../src/lib/db/types/militaryUnit";

interface Row {
  countryId: string;
  line: number;
  accrual: number;
  upkeep: number;
  net: number;
  units: number;
  turnsToArrears: number;
}

async function buildRows(db: Db, preset: string): Promise<Row[]> {
  const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  const rows: Row[] = [];

  for (const budget of budgets) {
    const line = resolveDefenseLineFrom(budget);
    const units = (await db
      .collection("militaryUnits")
      .find({ countryId: budget.countryId })
      .toArray()) as unknown as MilitaryUnit[];
    // "standard" mirrors the measurement tier; a country with a cabinet tier setting will
    // differ slightly at runtime, which the year of grace absorbs.
    const totalUpkeep = units.length
      ? aggregateForce(units, budget.countryId, "standard").totalUpkeep
      : 0;
    const accrual = accrualPerTurn(line);
    const upkeep = upkeepPerTurn(totalUpkeep, seedRosterUpkeepFor(preset, budget.countryId), line);
    const net = accrual - upkeep;
    // Opening balance is one year's accrual; the floor is one year BELOW zero, so a
    // country burning `net` per turn has two years of line to consume before arrears.
    const turnsToArrears = net >= 0 ? Infinity : Math.ceil((line + line) / -net);

    rows.push({
      countryId: budget.countryId,
      line,
      accrual,
      upkeep,
      net,
      units: units.length,
      turnsToArrears,
    });
  }
  return rows.sort((a, b) => a.turnsToArrears - b.turnsToArrears);
}

function report(rows: Row[]): void {
  const e = (v: number) => (v === 0 ? "0" : v.toExponential(2));
  console.log("\ncountry      line       accrual/t    upkeep/t     net/t      units  toArrears");
  console.log("-".repeat(84));
  for (const r of rows) {
    console.log(
      [
        r.countryId.padEnd(6),
        e(r.line).padStart(10),
        e(r.accrual).padStart(11),
        e(r.upkeep).padStart(11),
        e(r.net).padStart(11),
        String(r.units).padStart(6),
        (Number.isFinite(r.turnsToArrears) ? String(r.turnsToArrears) : "never").padStart(10),
      ].join("  ")
    );
  }
}

/**
 * Resolve the target connection string.
 *
 * Regexes are ANCHORED to the start of a line. `.env.local` carries an archived
 * `OLD_MONGODB_URI_LIVE=` alongside the live one, and an unanchored `MONGODB_URI_LIVE=(.+)`
 * would happily match whichever appeared first — pointing a production migration at a dead
 * database, or worse, a live one when a dry run was intended.
 */
function resolveUri(live: boolean): string {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const key = live ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const match = envFile.match(new RegExp(`^${key}=(.+)$`, "m"));
  if (!match) throw new Error(`${key} not found in .env.local`);

  let uri = match[1].trim();
  // Railway's Mongo needs an explicit direct connection — without it the driver attempts
  // replica-set discovery against hostnames that do not resolve from outside, and hangs
  // until timeout rather than failing usefully.
  if (live && !uri.includes("directConnection=")) {
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  }
  return uri;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const live = process.argv.includes("--live");
  // A production write takes THREE deliberate flags. `--apply --live` alone is one
  // autocomplete away from a testing-world command, and this one writes to every country's
  // budget document on the real game.
  const acknowledged = process.argv.includes("--i-understand-this-is-live");

  if (live) {
    console.log("\n" + "=".repeat(70));
    console.log(
      apply ? "  *** LIVE DATABASE — WRITING ***" : "  LIVE DATABASE — read-only dry run"
    );
    console.log("=".repeat(70));
  }
  if (live && apply && !acknowledged) {
    console.error(
      "\nREFUSING: --apply --live also requires --i-understand-this-is-live.\n" +
        "Run the dry run first (drop --apply) and read the table before writing."
    );
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(resolveUri(live));
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    const gs = await db.collection("gameState").findOne({ _id: "current" as never });
    const currentTurn = (gs?.currentTurn as number | undefined) ?? 1;
    const preset = (gs?.preset as string | undefined) ?? DEFAULT_SEED_PRESET;
    console.log(`preset=${preset} currentTurn=${currentTurn} apply=${apply}`);

    const rows = await buildRows(db, preset);
    report(rows);

    const tooTight = rows.filter(
      (r) => Number.isFinite(r.turnsToArrears) && r.turnsToArrears < TURNS_PER_YEAR
    );
    if (tooTight.length > 0) {
      console.error(
        `\nREFUSING: these countries reach arrears within a game year:\n  ` +
          tooTight.map((r) => `${r.countryId} (${r.turnsToArrears} turns)`).join("\n  ")
      );
      console.error(
        "Re-run scripts/calibrate-defence-upkeep.ts — the seeded-roster measurement and the " +
          "defence lines disagree."
      );
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log(
        `\n${rows.length} budgets examined on the ${live ? "LIVE" : "testing"} database. ` +
          `Dry run — nothing written.`
      );
      return;
    }

    let applied = 0;
    for (const r of rows) {
      const budget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ countryId: r.countryId });
      if (!budget) continue;

      const set: Record<string, unknown> = {};
      if (!budget.defenseAppropriation) {
        set.defenseAppropriation = {
          balance: Math.round(r.line),
          accruedThroughTurn: currentTurn,
          arrearsRatio: 0,
        };
      }
      // Only when gdp is usable: a 0 baseline would anchor prices at zero. Leaving it
      // absent means "price off live GDP", which is the pre-anchor behaviour.
      if (
        budget.militaryPriceBaselineGdp == null &&
        typeof budget.gdp === "number" &&
        budget.gdp > 0
      ) {
        set.militaryPriceBaselineGdp = budget.gdp;
      }
      if (Object.keys(set).length > 0) {
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ countryId: r.countryId }, { $set: set });
        applied++;
      }
    }
    console.log(`\nApplied to ${applied} of ${rows.length} budgets.`);
  } finally {
    await client.close();
  }
}

void main();
