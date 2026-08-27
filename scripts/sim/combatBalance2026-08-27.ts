/**
 * Combat balance report — driven by the LIVE engine against LIVE formations.
 *
 * READ ONLY. Loads the real conflict, the real units and the real doctrines, builds
 * battle sides exactly the way the turn resolver does (`buildBattleSide`), then runs
 * `resolvePvpBattle` over many seeds to turn a five-battle sample into a distribution.
 *
 *   npx tsx scripts/sim/combatBalance2026-08-27.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift } from "@/lib/military/occupation";
import { OCCUPATION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 400;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number) => Math.round(x).toLocaleString("en-US");

function quantiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), mean: s.reduce((a, b) => a + b, 0) / s.length };
}

/** Men actually standing at the front for one coalition. */
const menOf = (sides: BattleSide[]) =>
  sides.reduce(
    (a, s) =>
      a + s.units.filter((u) => u.theaterId === THEATER).reduce((t, u) => t + u.personnel, 0),
    0
  );
const unitsOf = (sides: BattleSide[]) =>
  sides.reduce((a, s) => a + s.units.filter((u) => u.theaterId === THEATER).length, 0);

interface Row {
  label: string;
  winRate: number;
  attLoss: ReturnType<typeof quantiles>;
  defLoss: ReturnType<typeof quantiles>;
  margin: ReturnType<typeof quantiles>;
  shift: ReturnType<typeof quantiles>;
  attMen: number;
  defMen: number;
  attUnits: number;
  defUnits: number;
  retreatRate: number;
  attPower: number;
  defPower: number;
}

/** Run one matchup over many seeds. `control` only affects the deep-push damper. */
function sweep(label: string, att: BattleSide[], def: BattleSide[], control = 50): Row {
  const wins: number[] = [];
  const aL: number[] = [];
  const dL: number[] = [];
  const mg: number[] = [];
  const sh: number[] = [];
  let retreats = 0;
  let attPower = 0;
  let defPower = 0;
  for (let i = 0; i < SEEDS; i++) {
    const r = resolvePvpBattle(att, def, THEATER, i * 7919 + 13);
    wins.push(r.win ? 1 : 0);
    aL.push(r.attacker.loss);
    dL.push(r.defender.loss);
    mg.push(r.margin);
    if (r.retreat) retreats++;
    attPower = r.attacker.power;
    defPower = r.defender.power;
    // Side A is the US in this conflict; the attacker here is whoever we passed.
    const winner = r.win ? "B" : "A";
    const next = occupationShift({
      control,
      winner,
      margin: r.margin,
      loserRetreated: !!r.retreat,
    });
    sh.push(Math.abs(next - control));
  }
  return {
    label,
    winRate: wins.reduce((a, b) => a + b, 0) / wins.length,
    attLoss: quantiles(aL),
    defLoss: quantiles(dL),
    margin: quantiles(mg),
    shift: quantiles(sh),
    attMen: menOf(att),
    defMen: menOf(def),
    attUnits: unitsOf(att),
    defUnits: unitsOf(def),
    retreatRate: retreats / SEEDS,
    attPower,
    defPower,
  };
}

function printRow(r: Row) {
  const attRate = r.attMen ? r.attLoss.mean / r.attMen : 0;
  const defRate = r.defMen ? r.defLoss.mean / r.defMen : 0;
  console.log(`\n### ${r.label}`);
  console.log(
    `  force      att ${r.attUnits} units / ${num(r.attMen)} men / power ${num(r.attPower)}` +
      `   vs   def ${r.defUnits} units / ${num(r.defMen)} men / power ${num(r.defPower)}`
  );
  console.log(
    `  power share att ${pct(r.attPower / Math.max(1, r.attPower + r.defPower))}` +
      `   win rate ${pct(r.winRate)}   retreat fires ${pct(r.retreatRate)}`
  );
  console.log(
    `  att losses  mean ${num(r.attLoss.mean)} (${pct(attRate)} of force)  p10 ${num(r.attLoss.p10)}  p90 ${num(r.attLoss.p90)}`
  );
  console.log(
    `  def losses  mean ${num(r.defLoss.mean)} (${pct(defRate)} of force)  p10 ${num(r.defLoss.p10)}  p90 ${num(r.defLoss.p90)}`
  );
  console.log(
    `  margin      mean ${r.margin.mean.toFixed(1)}   ground shift mean ${r.shift.mean.toFixed(2)} pts  p90 ${r.shift.p90.toFixed(2)}`
  );
  const totalDead = r.attLoss.mean + r.defLoss.mean;
  console.log(
    `  EFFICIENCY  ${num(totalDead / Math.max(0.001, r.shift.mean))} dead per control point` +
      `   ->  ${(50 / Math.max(0.001, r.shift.mean)).toFixed(0)} straight wins to take the map`
  );
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const gs = await db.collection("gameState").findOne({ _id: "current" as never });
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const front = conflictToFront(conflict);
    const fronts = { [THEATER]: front };

    console.log(`turn ${gs?.currentTurn}  year ${gs?.currentYear}`);
    console.log(`conflict ${THEATER} "${conflict.name}"  control=${conflict.control.toFixed(2)}`);
    console.log(
      `front terrain="${front.terrain}" terr=${front.terr} infra=${front.infra}  ` +
        `supplyA=${conflict.supplyA} supplyB=${conflict.supplyB}`
    );
    console.log(`seeds per matchup: ${SEEDS}\n`);
    console.log(
      `OCCUPATION: maxShift=${OCCUPATION.maxShift} decisiveMargin=${OCCUPATION.decisiveMargin} ` +
        `retreatYield=${OCCUPATION.retreatYield} -> hard ceiling ${OCCUPATION.maxShift * OCCUPATION.retreatYield} pts/battle when the loser breaks`
    );

    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all) {
      const k = String(u.countryId);
      byCountry.set(k, [...(byCountry.get(k) ?? []), u]);
    }
    for (const [c, us] of byCountry) {
      console.log(
        `  live at front: ${c} ${us.length} units ${num(us.reduce((a, u) => a + u.personnel, 0))} men ` +
          `avg readiness ${(us.reduce((a, u) => a + u.readiness, 0) / us.length).toFixed(0)}`
      );
    }

    const sideOf = async (c: string, us: MilitaryUnit[], side: "A" | "B", supply: number) =>
      buildBattleSide(db, c, us, fronts, supply, side);

    const US = await sideOf("US", byCountry.get("US") ?? [], "A", conflict.supplyA);
    const DD = await sideOf("DD", byCountry.get("DD") ?? [], "B", conflict.supplyB);
    const RU = await sideOf("RU", byCountry.get("RU") ?? [], "B", conflict.supplyB);

    console.log("\n\n================ LIVE MATCHUPS ================");
    printRow(sweep("DD attacks US (the recurring offensive)", [DD], [US]));
    printRow(sweep("DD+RU attack US (the T420 coalition)", [DD, RU], [US]));
    printRow(sweep("US attacks DD", [US], [DD]));
    printRow(sweep("US attacks DD+RU", [US], [DD, RU]));

    console.log("\n\n================ DOES MASS PAY? ================");
    console.log("Same defender. Attacker committed in increasing depth, RU units only.");
    const ruUnits = (byCountry.get("RU") ?? []).slice();
    for (const k of [1, 3, 5, 10, 15, 25]) {
      const part = await sideOf("RU", ruUnits.slice(0, k), "B", conflict.supplyB);
      printRow(sweep(`RU commits ${k} of ${ruUnits.length} formations`, [part], [US]));
    }

    console.log("\n\n================ COALITION vs SINGLE FLAG ================");
    console.log("Identical army, fought as one contingent vs split across two nations.");
    const ddU = byCountry.get("DD") ?? [];
    const ruHalf = ruUnits.slice(0, ddU.length);
    const merged = await sideOf("DD", [...ddU, ...ruHalf], "B", conflict.supplyB);
    const splitA = await sideOf("DD", ddU, "B", conflict.supplyB);
    const splitB = await sideOf("RU", ruHalf, "B", conflict.supplyB);
    printRow(sweep(`one flag: ${ddU.length + ruHalf.length} formations under DD`, [merged], [US]));
    printRow(
      sweep(
        `two flags: same ${ddU.length + ruHalf.length} formations, DD + RU`,
        [splitA, splitB],
        [US]
      )
    );

    console.log("\n\n================ ATTRITION vs GROUND: WHO RUNS OUT FIRST ================");
    const base = sweep("baseline", [DD], [US]);
    const ddLossRate = base.attLoss.mean / base.attMen;
    const winsNeeded = 50 / base.shift.mean;
    console.log(
      `\nDD loses ${pct(ddLossRate)} of its front force per engagement.` +
        `\nAt that rate the army is gone in ${(1 / ddLossRate).toFixed(1)} engagements (no reinforcement).` +
        `\nTaking the map from 50 needs ${winsNeeded.toFixed(0)} consecutive wins at the observed mean shift.` +
        `\n=> the army is destroyed ${(winsNeeded / (1 / ddLossRate)).toFixed(1)}x over before the ground is taken.`
    );
    const decisive = OCCUPATION.maxShift * OCCUPATION.retreatYield;
    console.log(
      `\nEven at the ABSOLUTE ceiling (${decisive} pts, a decisive win every time), ` +
        `taking the map needs ${(50 / decisive).toFixed(0)} straight decisive victories.`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
