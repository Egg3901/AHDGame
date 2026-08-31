/**
 * Combat balance, part two: NET ground, and where combat power actually comes from.
 *
 * Part one measured the magnitude of the ground shift regardless of who won, which
 * flatters a suicidal attack -- a force that is annihilated moves the front a long way
 * in the DEFENDER's favour. This measures the attacker's EXPECTED NET ground, which is
 * the number a commander is actually buying with casualties.
 *
 *   npx tsx scripts/sim/combatBalance2026-08-27b.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, battleForecast, type BattleSide } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift } from "@/lib/military/occupation";
import { computeEffectivePower } from "@/lib/constants/military";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 400;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const menOf = (ss: BattleSide[]) =>
  ss.reduce(
    (a, s) =>
      a + s.units.filter((u) => u.theaterId === THEATER).reduce((t, u) => t + u.personnel, 0),
    0
  );

/** Expected NET ground for the attacking side, and what it costs them. */
function net(label: string, att: BattleSide[], def: BattleSide[], control = 50) {
  let wins = 0;
  let gain = 0;
  let attLoss = 0;
  let defLoss = 0;
  for (let i = 0; i < SEEDS; i++) {
    const r = resolvePvpBattle(att, def, THEATER, i * 7919 + 13);
    attLoss += r.attacker.loss;
    defLoss += r.defender.loss;
    if (r.win) wins++;
    // The attacker here is side B in this conflict's orientation; ground toward the
    // attacker is positive, ground lost to the defender is negative.
    const winner = r.win ? "B" : "A";
    const next = occupationShift({
      control,
      winner,
      margin: r.margin,
      loserRetreated: !!r.retreat,
    });
    gain += r.win ? next - control : -(control - next);
  }
  const men = menOf(att);
  const netGain = gain / SEEDS;
  const cost = attLoss / SEEDS;
  console.log(
    `${label.padEnd(46)} win ${pct(wins / SEEDS).padStart(6)}  ` +
      `NET ground ${netGain >= 0 ? "+" : ""}${netGain.toFixed(2).padStart(6)} pts  ` +
      `own dead ${num(cost).padStart(7)} (${pct(cost / Math.max(1, men)).padStart(6)})  ` +
      `enemy dead ${num(defLoss / SEEDS).padStart(6)}  ` +
      (netGain > 0.001
        ? `cost/pt ${num(cost / netGain).padStart(8)}`
        : `cost/pt        —  (no net progress)`)
  );
  return { netGain, cost, men };
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const fronts = { [THEATER]: conflictToFront(conflict) };
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all)
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);

    console.log("======== WHERE COMBAT POWER COMES FROM ========\n");
    console.log(
      "country | units | men | men/unit | basePower | tech | vet | equip(f/p/s) | readiness | effPower | effPower/man"
    );
    for (const [c, us] of byCountry) {
      const men = us.reduce((a, u) => a + u.personnel, 0);
      const bp = us.reduce((a, u) => a + u.basePower, 0) / us.length;
      const tech = us.reduce((a, u) => a + (u.techTier ?? 0), 0) / us.length;
      const vet = us.reduce((a, u) => a + (u.vet ?? 0), 0) / us.length;
      const eq = us
        .reduce(
          (a, u) => {
            const e = u.equipment ?? { firepower: 0, protection: 0, support: 0 };
            return [a[0] + e.firepower, a[1] + e.protection, a[2] + e.support] as [
              number,
              number,
              number,
            ];
          },
          [0, 0, 0] as [number, number, number]
        )
        .map((x) => (x / us.length).toFixed(1));
      const rd = us.reduce((a, u) => a + u.readiness, 0) / us.length;
      const eff = us.reduce((a, u) => a + computeEffectivePower(u), 0);
      console.log(
        `${c} | ${us.length} | ${num(men)} | ${num(men / us.length)} | ${bp.toFixed(0)} | ${tech.toFixed(1)} | ${vet.toFixed(1)} | ${eq.join("/")} | ${rd.toFixed(0)} | ${num(eff)} | ${(eff / men).toFixed(4)}`
      );
    }

    console.log("\nUnit type mix:");
    for (const [c, us] of byCountry) {
      const t: Record<string, number> = {};
      for (const u of us) t[u.type] = (t[u.type] ?? 0) + 1;
      console.log(
        `  ${c}: ${Object.entries(t)
          .map(([k, v]) => `${v}x ${k}`)
          .join(", ")}`
      );
    }

    const mk = (c: string, us: MilitaryUnit[], side: "A" | "B", sup: number) =>
      buildBattleSide(db, c, us, fronts, sup, side);
    const US = await mk("US", byCountry.get("US") ?? [], "A", conflict.supplyA);
    const DD = await mk("DD", byCountry.get("DD") ?? [], "B", conflict.supplyB);
    const ruUnits = byCountry.get("RU") ?? [];

    console.log("\n\n======== NET GROUND: DOES COMMITTING MORE PAY? ========");
    console.log("RU attacking the live US force, committing k formations.\n");
    for (const k of [1, 3, 5, 10, 15, 20, 25]) {
      const s = await mk("RU", ruUnits.slice(0, k), "B", conflict.supplyB);
      await net(`RU commits ${String(k).padStart(2)} formations`, [s], [US]);
    }

    console.log("\n\n======== NET GROUND: THE LIVE MATCHUPS ========\n");
    const RU = await mk("RU", ruUnits, "B", conflict.supplyB);
    await net("DD alone attacks US", [DD], [US]);
    await net("DD + RU attack US", [DD, RU], [US]);
    await net("US attacks DD", [US], [DD]);
    await net("US attacks DD+RU", [US], [DD, RU]);

    console.log("\n\n======== READINESS: WHAT DD'S EXHAUSTION COSTS IT ========");
    console.log("DD's front force sits at 54 readiness after five engagements.\n");
    for (const rd of [30, 54, 70, 85, 100]) {
      const rested = (byCountry.get("DD") ?? []).map((u) => ({ ...u, readiness: rd }));
      const s = await mk("DD", rested, "B", conflict.supplyB);
      const f = battleForecast([s], [US], THEATER);
      process.stdout.write(
        `readiness ${String(rd).padStart(3)}  power ${num(f.attStr).padStart(5)}  odds ${String(f.oddsPct).padStart(3)}%   `
      );
      await net(``, [s], [US]);
    }

    console.log("\n\n======== TERRAIN AND THE DEFENDER'S EDGE ========");
    console.log(`live front terr=${fronts[THEATER].terr} (defender multiplier)\n`);
    for (const terr of [0.95, 1.15, 1.35]) {
      const f2 = { [THEATER]: { ...fronts[THEATER], terr } };
      const a = await buildBattleSide(
        db,
        "DD",
        byCountry.get("DD") ?? [],
        f2,
        conflict.supplyB,
        "B"
      );
      const d = await buildBattleSide(
        db,
        "US",
        byCountry.get("US") ?? [],
        f2,
        conflict.supplyA,
        "A"
      );
      process.stdout.write(`terr ${terr.toFixed(2)}  `);
      await net(`DD attacks US`, [a], [d]);
    }

    console.log("\n\n======== HOW LONG DOES THIS WAR RUN? ========");
    const dd = await net("DD alone (reference)", [DD], [US]);
    if (dd.netGain > 0) {
      const battles = 50 / dd.netGain;
      const dead = battles * dd.cost;
      console.log(
        `\nAt DD's expected net ${dd.netGain.toFixed(2)} pts/battle it needs ${battles.toFixed(0)} engagements to take the map.` +
          `\nThat costs ${num(dead)} DD dead -- against a front force of ${num(dd.men)} men,` +
          ` i.e. ${(dead / dd.men).toFixed(1)}x its entire army.` +
          `\nOffensives resolve one per turn, so ${battles.toFixed(0)} engagements is ${battles.toFixed(0)} turns minimum.`
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
