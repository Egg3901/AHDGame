/**
 * Intelligence funding balance report: what does each funding level buy?
 *
 * The balance gate for `OP_COST_GDP_FRACTION`, `ACTION_COST_GDP_FRACTION` and
 * `NETWORK_UPKEEP_GDP_FRACTION` (src/lib/intelligence/config.ts), which are action
 * costs and so may not ship on judgement alone. Issue Egg3901/AHDGame#1409.
 *
 * WHAT IS REAL. Every GDP below is read live from `federalBudget`. Nothing is
 * written. Unlike the phase 3 sabotage report, nothing here is reconstructed: the
 * affordability of a funding level is arithmetic over the enacted line and the cost
 * constants, so it is measurable exactly rather than sampled.
 *
 * THE DEFECT THIS FIXES. `federalBudget.gdp` is denominated in each country's own
 * currency, so the flat costs this replaces (75,000 a collection, 220,000 a covert
 * action) were not a balance dial at all: at an identical share of GDP they bought
 * the UK three operations a turn and the USSR two hundred. Pricing everything as a
 * fraction of the owner's own GDP makes GDP cancel against the funding line, which
 * is what the CANCELLATION check below proves.
 *
 * THE LADDER. Level 0 is "Unfunded" and is the seeded baseline for every country,
 * so shipping this changes no economy anywhere: no line, no accrual, no pot. The
 * levels are checked against two design claims:
 *   - money BINDS below level 2 (a service cannot work both slots), and
 *   - slots bind at and above level 2, so the surplus buys reach instead of tempo.
 *
 *   npx tsx scripts/sim/intelligenceFunding2026-09-04.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { FederalBudget } from "@/lib/db/types/budget";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { OP_SLOTS_PER_TURN } from "@/lib/intelligence/config";
import { intelligenceAccrualPerTurn } from "@/lib/intelligence/appropriationLine";
import { networkUpkeep, operationCost } from "@/lib/intelligence/cost";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const COUNTRIES = ["US", "UK", "RU", "DD"];

/** The funding law's levels, as authored in the four catalogs. */
const LEVELS: { name: string; fraction: number }[] = [
  { name: "0 Unfunded", fraction: 0 },
  { name: "1 Nominal Provision", fraction: 0.0005 },
  { name: "2 Standing Service", fraction: 0.0015 },
  { name: "3 Expanded Service", fraction: 0.003 },
  { name: "4 Unrestricted Vote", fraction: 0.005 },
];

const sci = (n: number) => n.toExponential(3);
const f2 = (n: number) => n.toFixed(2);

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ countryId: { $in: COUNTRIES } })
    .project({ countryId: 1, gdp: 1, "spending.byCategory.intelligence": 1 })
    .toArray();
  await client.close();

  const rows = budgets.map((b) => ({ id: b.countryId, gdp: b.gdp })).sort((a, z) => z.gdp - a.gdp);

  console.log("# Intelligence funding affordability\n");
  console.log(`Turns per year: ${TURNS_PER_YEAR}. Operation slots per turn: ${OP_SLOTS_PER_TURN}.`);
  console.log("Live GDP, local currency (four different denominations):");
  for (const r of rows) console.log(`  ${r.id}  ${sci(r.gdp)}`);

  console.log("\n## What each country can sustain per turn\n");
  console.log(
    "country  level                  annual line   accrual/turn   collect ops   actions   steady networks"
  );
  for (const r of rows) {
    for (const lv of LEVELS) {
      const line = r.gdp * lv.fraction;
      const accrual = intelligenceAccrualPerTurn(line);
      const collect = operationCost("collect", r.gdp);
      const action = operationCost("action", r.gdp);
      const steady = networkUpkeep("steady", r.gdp);
      console.log(
        `${r.id.padEnd(8)} ${lv.name.padEnd(22)} ${sci(line).padStart(11)}   ` +
          `${sci(accrual).padStart(12)}   ${f2(accrual / collect).padStart(11)}   ` +
          `${f2(accrual / action).padStart(7)}   ${f2(accrual / steady).padStart(15)}`
      );
    }
    console.log("");
  }

  console.log("## The GDP cancellation\n");
  console.log(
    "If costs are a fraction of the owner's own GDP and the line is too, GDP cancels and a"
  );
  console.log("funding level buys the same thing in every currency. Collection ops per turn:\n");
  console.log("level                   " + rows.map((r) => r.id.padStart(9)).join(""));
  let cancelOk = true;
  for (const lv of LEVELS) {
    const counts = rows.map(
      (r) => intelligenceAccrualPerTurn(r.gdp * lv.fraction) / operationCost("collect", r.gdp)
    );
    if (counts.some((c) => Math.abs(c - counts[0]) > 1e-6)) cancelOk = false;
    console.log(lv.name.padEnd(24) + counts.map((c) => f2(c).padStart(9)).join(""));
  }
  console.log(`\nCancellation holds across all ${rows.length} countries: ${cancelOk}`);

  console.log("\n## Where money binds and where slots bind\n");
  const probe = rows[0];
  for (const lv of LEVELS) {
    const accrual = intelligenceAccrualPerTurn(probe.gdp * lv.fraction);
    const collect = operationCost("collect", probe.gdp);
    const steady = networkUpkeep("steady", probe.gdp);
    const affordableOps = collect > 0 ? accrual / collect : 0;
    const binds = affordableOps < OP_SLOTS_PER_TURN ? "MONEY" : "SLOTS";
    const spare = Math.max(0, accrual - OP_SLOTS_PER_TURN * collect);
    console.log(
      `${lv.name.padEnd(22)} binds on ${binds.padEnd(6)} ` +
        `(affords ${f2(affordableOps)} ops; after both slots, ` +
        `${f2(steady > 0 ? spare / steady : 0)} steady networks)`
    );
  }

  console.log(
    "\nEvery country is seeded at level 0, so deploying this changes no economy anywhere."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
