/**
 * Coalition casualty share: what the `share` denominator is worth, measured.
 *
 * `unitOutcomes` bills a unit `(0.6 + share)` of its casualty rate, where `share` is
 * that unit's slice of a combat-value total. The total used to be the CONTINGENT's,
 * which renormalises to 1.0 inside every nation on a side: a country with three
 * divisions in a ten-nation coalition was charged as though those three were the whole
 * army. The War for Germany is where it showed: on turn 518 Ireland put 38 points of
 * combat power into the line and lost 6,862 men, while the United States put in 601
 * and lost 3,171.
 *
 * This script measures the thing the front-capacity calibration never did. That run
 * asked "does the size of an army order the result", which is a question about who
 * wins. It never asked what a battle COSTS, so a term that only moved casualties was
 * invisible to it. Two numbers here that the old harness does not produce:
 *
 *   - exchange ratio: dead on side A per dead on side B, over many seeds
 *   - split invariance: whether one army fighting as two contingents bleeds the same
 *     as it does fighting as one. It should. Any gap is the bug, in men.
 *
 * Deterministic and offline: no database, no live world. Same fixtures the battle
 * tests use, so a number here and a number in a test mean the same thing.
 *
 *   npx tsx scripts/sim/coalitionCasualtyShare.ts
 */
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { natMods } from "@/lib/military/doctrineTree";
import type { CombatUnit, Front } from "@/lib/military/combat";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

const FRONT: Front = {
  id: "germany",
  name: "germany",
  region: "eeu",
  terrain: "Plain / forest",
  contested: true,
  terr: 0.95,
  infra: 70,
  enemyMix: ["armor", "mech", "infantry", "arty", "air", "airdef"],
};
const FRONTS_MAP: Record<string, Front> = {
  reserve: { ...FRONT, id: "reserve", contested: false },
  germany: FRONT,
};

function unit(over: Partial<CombatUnit> = {}): CombatUnit {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "Infantry Division",
    type: "Infantry Division",
    icon: "soldier",
    basePower: 48,
    personnel: 12000,
    upkeepBase: 70,
    posture: "standard",
    techTier: 1,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "germany",
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  };
}

function side(country: string, s: "A" | "B", n: number): BattleSide {
  return {
    units: Array.from({ length: n }, () => unit({ countryId: country as CountryId })),
    assignments: [],
    generalsById: {},
    positions: {},
    natMods: natMods({}),
    countryScale: 1,
    side: s,
    country,
    fronts: FRONTS_MAP,
  };
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i * 7919 + 13);
const n = (x: number) => Math.round(x).toLocaleString("en-US");
/** Per-battle average, so a figure here is comparable to a single battle report. */
const avg = (x: number) => Math.round(x / SEEDS.length).toLocaleString("en-US");

/** Total casualties for a side across every seed. */
function run(att: BattleSide[], def: BattleSide[]) {
  let a = 0,
    d = 0;
  const per = new Map<string, number>();
  for (const seed of SEEDS) {
    const r = resolvePvpBattle(att, def, "germany", seed);
    a += r.attacker.loss;
    d += r.defender.loss;
    for (const c of r.defender.contingents ?? [])
      per.set(c.country, (per.get(c.country) ?? 0) + c.loss);
    for (const c of r.attacker.contingents ?? [])
      per.set(c.country, (per.get(c.country) ?? 0) + c.loss);
  }
  return { a, d, per };
}

console.log("=".repeat(78));
console.log("COALITION CASUALTY SHARE — " + SEEDS.length + " seeds per configuration");
console.log("=".repeat(78));

// ── 1. Split invariance ────────────────────────────────────────────────────────
// One 12-division army, fought as one contingent and then as four. Same men, same
// front, same seeds. Any difference is the denominator, not the fighting.
const enemy = () => [side("DD", "B", 12)];
const asOne = run([side("US", "A", 12)], enemy());
const asFour = run(
  [side("US", "A", 3), side("UK", "A", 3), side("FR", "A", 3), side("IT", "A", 3)],
  enemy()
);
const drift = ((asFour.a - asOne.a) / asOne.a) * 100;
console.log("\n1. SPLIT INVARIANCE — the same army, fought as one nation vs four");
console.log(`   as ONE contingent  : ${avg(asOne.a).padStart(9)} dead/battle`);
console.log(`   as FOUR contingents: ${avg(asFour.a).padStart(9)} dead/battle`);
console.log(`   drift              : ${drift >= 0 ? "+" : ""}${drift.toFixed(1)}%   (target: ~0%)`);

// ── 2. The small-ally tax ──────────────────────────────────────────────────────
// A coalition shaped like turn 518: one big contingent, several tiny ones. Compare
// per-man cost of a division in the big contingent against one in a tiny ally.
console.log("\n2. SMALL-ALLY TAX — per-division cost inside one coalition");
const coalition = [side("US", "A", 12), side("IE", "A", 1), side("SE", "A", 2), side("GR", "A", 3)];
const co = run(coalition, enemy());
const divs: Record<string, number> = { US: 12, IE: 1, SE: 2, GR: 3 };
const base = (co.per.get("US") ?? 0) / divs.US;
for (const c of ["US", "IE", "SE", "GR"]) {
  const perDiv = (co.per.get(c) ?? 0) / divs[c];
  console.log(
    `   ${c.padEnd(3)} ${String(divs[c]).padStart(2)} div  ${avg(perDiv).padStart(7)} dead/div/battle   ` +
      `${(perDiv / base).toFixed(2)}x the US rate`
  );
}

// ── 3. Exchange ratio ──────────────────────────────────────────────────────────
// What the coalition costs against what it inflicts. The number the front-capacity
// calibration never reported.
console.log("\n3. EXCHANGE RATIO — coalition of 18 divisions vs 12");
console.log(`   side A dead : ${avg(co.a).padStart(9)} /battle`);
console.log(`   side B dead : ${avg(co.d).padStart(9)} /battle`);
console.log(`   A per B     : ${(co.a / co.d).toFixed(2)} : 1`);

// ── 4. Reinforcement value ─────────────────────────────────────────────────────
// Does adding an ally to a full front help or hurt? Six divisions arrive as one
// contingent; measure the side's dead and what it inflicts, before and after.
console.log("\n4. REINFORCEMENT — adding 6 divisions to an already-committed front");
const before = run([side("US", "A", 12)], enemy());
const after = run([side("US", "A", 12), side("IT", "A", 6)], enemy());
console.log(
  `   12 divisions      : ${avg(before.a).padStart(7)} dead/battle, inflicts ${avg(before.d)}`
);
console.log(
  `   18 divisions      : ${avg(after.a).padStart(7)} dead/battle, inflicts ${avg(after.d)}`
);
console.log(
  `   marginal          : ${after.a - before.a >= 0 ? "+" : ""}${avg(after.a - before.a)} own dead/battle ` +
    `for ${after.d - before.d >= 0 ? "+" : ""}${avg(after.d - before.d)} enemy dead ` +
    `(${((after.a - before.a) / Math.max(1, after.d - before.d)).toFixed(1)} own per enemy)`
);
console.log("");
