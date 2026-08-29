/**
 * Combat odds calibration: is the number the war room shows a probability?
 *
 * The balance report for `ATTRITION.fortuneSpread`. Two arms, same engine, same
 * seeds, same real formations off the live front:
 *
 *   BEFORE  fortuneSpread 0  -- the bare force balance, which is what `resolvePvpBattle`
 *                              fought at before this change
 *   AFTER   fortuneSpread from config
 *
 * Arm A measures calibration directly: for a projected `oddsPct`, how often does the
 * attacker actually win? Arm B replays the real US/DD front so the verdict mix,
 * retreat rate and casualty load are measured on live formations rather than on
 * fixtures tuned to make a point.
 *
 *   npx tsx scripts/sim/combatOddsCalibration2026-08-29.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { battleForecast, resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildCoalitionSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { ATTRITION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = process.env.SIM_THEATER ?? "war_us_dd_415";
/**
 * Trials per cell. The live front fields ~120 formations, and every trial resolves all
 * of them, so this is the wall-clock knob. 800 gives a standard error of ~1.8pp on a
 * win rate, which is well inside the effect being measured (the BEFORE arm misses the
 * projection by 15-80pp).
 */
const TRIALS = Number(process.env.SIM_TRIALS ?? 800);
const pct = (n: number) => (n * 100).toFixed(1) + "%";

/**
 * Scale a side's formations so the pair projects near a target ratio.
 *
 * Calibration is a statement about the ODDS, not about any particular army, so the
 * sweep has to reach odds the live front does not currently sit at. Scaling
 * `basePower` moves the force balance through the same `battleForecast` every other
 * caller uses -- nothing here reimplements the strength math.
 */
function scaled(sides: BattleSide[], factor: number): BattleSide[] {
  return sides.map((s) => ({
    ...s,
    units: s.units.map((u) => ({ ...u, basePower: Math.max(1, u.basePower * factor) })),
  }));
}

interface Arm {
  wins: number;
  verdicts: Record<string, number>;
  retreats: number;
  attackerLoss: number;
  defenderLoss: number;
}

function emptyArm(): Arm {
  return { wins: 0, verdicts: {}, retreats: 0, attackerLoss: 0, defenderLoss: 0 };
}

function run(a: BattleSide[], d: BattleSide[], spread: number, trials: number): Arm {
  const arm = emptyArm();
  for (let s = 0; s < trials; s++) {
    const r = resolvePvpBattle(a, d, THEATER, s * 7919, undefined, undefined, spread);
    if (r.win) arm.wins++;
    arm.verdicts[r.verdict] = (arm.verdicts[r.verdict] ?? 0) + 1;
    if (r.retreat) arm.retreats++;
    arm.attackerLoss += r.attacker.loss;
    arm.defenderLoss += r.defender.loss;
  }
  return arm;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    if (!conflict) throw new Error(`No conflict ${THEATER}`);
    const fronts = { [THEATER]: conflictToFront(conflict) };
    const units = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];

    /**
     * ⚠️ `buildBattleSide` does NOT filter the units it is handed — it takes the array
     * as that country's contingent. Partitioning by `countryId` first is therefore
     * load-bearing, not tidiness: handing it the whole front puts every belligerent
     * on BOTH sides, which reads as a plausible near-even matchup and silently makes
     * the report a measurement of an army fighting itself.
     */
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of units) {
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);
    }
    // Only belligerents that actually have formations here — an empty contingent adds
    // nothing to the fight and only pads the roster line printed below.
    const westCountries = conflict.sideA.countries.filter((c) => byCountry.get(c)?.length);
    const eastCountries = conflict.sideB.countries.filter((c) => byCountry.get(c)?.length);
    const [baseA, baseD] = await Promise.all([
      buildCoalitionSide(db, westCountries, byCountry, fronts, conflict.supplyA, "A"),
      buildCoalitionSide(db, eastCountries, byCountry, fronts, conflict.supplyB, "B"),
    ]);

    const formations = (sides: BattleSide[]) => sides.reduce((a, s) => a + s.units.length, 0);
    console.log(`Front ${THEATER}: ${conflict.sideA.label} vs ${conflict.sideB.label}`);
    console.log(`  A: ${westCountries.join("+")} — ${formations(baseA)} formations`);
    console.log(`  B: ${eastCountries.join("+")} — ${formations(baseD)} formations`);
    console.log(`fortuneSpread under test: ${ATTRITION.fortuneSpread}\n`);

    console.log("=== ARM A: calibration sweep ===");
    console.log("Does a projected N% win N% of the time?\n");
    console.log("  projected |  BEFORE win% |   AFTER win% | after error");
    console.log("  ----------+--------------+--------------+------------");
    let worst = 0;
    // Scaled in OPPOSITE directions. Front capacity caps how much mass either side can
    // get into contact, so scaling only the attacker saturates and the sweep never
    // leaves the middle of the range -- it topped out at 66% before this.
    //
    // The factors are NOT evenly spaced, because the odds they produce are not. Both
    // sides sit far over capacity on this front, so everything from 0.7x to 3x lands
    // on the same ~37% plateau while 3x..8x sweeps 40% to 74% -- the spacing is
    // bunched where the odds actually move, so the 45..70% band that decides most
    // real offensives is covered rather than jumped over.
    for (const factor of [0.05, 0.12, 0.22, 0.35, 0.5, 1, 3, 4, 5, 6, 7, 8, 12, 20]) {
      const a = scaled(baseA, factor);
      const d = scaled(baseD, 1 / factor);
      const projected = battleForecast(a, d, THEATER).ratio;
      const before = run(a, d, 0, TRIALS).wins / TRIALS;
      const after = run(a, d, ATTRITION.fortuneSpread, TRIALS).wins / TRIALS;
      const err = after - projected;
      // The clamp holds `ratio` at 0.02..0.98 and round noise smears across it, so
      // the tails are expected to pull inward. The middle is the load-bearing part.
      if (projected > 0.1 && projected < 0.9) worst = Math.max(worst, Math.abs(err));
      console.log(
        "  " +
          pct(projected).padStart(9) +
          " | " +
          pct(before).padStart(12) +
          " | " +
          pct(after).padStart(12) +
          " | " +
          (err >= 0 ? "+" : "") +
          (err * 100).toFixed(1) +
          "pp"
      );
    }
    // Quoted so the worst-error line can be read honestly: at low trial counts most of
    // it is sampling noise, not miscalibration. The exact calibration of the round loop
    // is measured separately in `ATTRITION.fortuneSpread` over 300k seeds; what this arm
    // shows is that the effect survives real formations, capacity and supply.
    //
    // ⚠️ Every row replays the SAME seed sequence, so the rows are one correlated
    // sample rather than twelve independent ones. A run where most rows miss in the
    // same direction is the expected shape of that correlation, NOT evidence of a
    // systematic bias — do not retune the spread off the sign pattern in one run.
    const se = Math.sqrt(0.25 / TRIALS) * 100;
    console.log(`\n  worst error over 10%..90%: ${(worst * 100).toFixed(1)}pp`);
    console.log(`  standard error at ${TRIALS} trials: +/-${se.toFixed(1)}pp per cell`);

    console.log("\n=== ARM B: the live front, as it actually stands ===");
    const projected = battleForecast(baseA, baseD, THEATER).ratio;
    console.log(`  projected odds for a ${westCountries.join("+")} offensive: ${pct(projected)}\n`);
    for (const [label, spread] of [
      ["BEFORE", 0],
      ["AFTER ", ATTRITION.fortuneSpread],
    ] as const) {
      const arm = run(baseA, baseD, spread, TRIALS);
      const order = ["Decisive Victory", "Victory", "Pyrrhic Victory", "Costly Defeat", "Rout"];
      console.log(
        `  ${label}  win ${pct(arm.wins / TRIALS).padStart(6)}` +
          `  retreat ${pct(arm.retreats / TRIALS).padStart(6)}` +
          `  mean losses A/D ${Math.round(arm.attackerLoss / TRIALS).toLocaleString("en-US")}` +
          ` / ${Math.round(arm.defenderLoss / TRIALS).toLocaleString("en-US")}`
      );
      console.log(
        "          " + order.map((v) => `${v} ${pct((arm.verdicts[v] ?? 0) / TRIALS)}`).join("  ")
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
