/**
 * What a war does to the ground it is fought over, measured.
 *
 * The War for Germany killed 1.24 million men across 130 turns and left both
 * German states' infrastructure untouched, because nothing in `src/lib/economy`
 * read conflict state at all. A player put it plainly: "Germans + Soviets got 0
 * wartime penalties, though, and somehow perfectly paved the roads that they bombed."
 *
 * This drives the REAL `roadCondition` node, turn by turn, at peace and at war, and
 * prints the trajectory. `roadCondition` feeds `transportEfficiency`, which is a TFP
 * basket input, which sets potential growth, which sets GDP — so a number here is a
 * number the economy eventually feels.
 *
 * Deterministic and offline: no database, no live world.
 *
 *   npx tsx scripts/sim/warRoadDamage.ts
 */
import { roadConditionNode } from "@/lib/metricEngine/registry/infrastructure";
import type { EngineNodeContext } from "@/lib/metricEngine/types";
import type { WarDamage } from "@/lib/military/warDamage";

const ID = "infrastructure.roadCondition";
const INERTIA = 0.85;

/** A well-funded region: infrastructure spend high enough to hold roads up. */
const SPEND = 900;

function ctxFor(baseline: number, value: number, war: WarDamage | undefined): EngineNodeContext {
  return {
    countryId: "DD",
    current: {},
    prev: { [ID]: value },
    prevSimBaseline: { [ID]: baseline },
    providers: { warDamage: war },
    spending: { infrastructure: SPEND },
    policyValue: value,
  } as unknown as EngineNodeContext;
}

/** Run the node for `turns`, returning the value trajectory. */
function run(turns: number, war: WarDamage | undefined, start = 78): number[] {
  let baseline = start;
  let value = start;
  const out: number[] = [];
  for (let t = 0; t < turns; t++) {
    baseline = roadConditionNode.compute!(ctxFor(baseline, value, war));
    // The engine's EMA: the stored value chases the baseline, damped by inertia.
    value = value * INERTIA + baseline * (1 - INERTIA);
    out.push(value);
  }
  return out;
}

const n = (x: number) => x.toFixed(1);
console.log("=".repeat(74));
console.log("WAR ROAD DAMAGE: the real roadCondition node, driven turn by turn");
console.log("=".repeat(74));

const WAR_TURNS = 130; // the length of the War for Germany
const peace = run(WAR_TURNS, undefined);
console.log(`\n1. A WELL-FUNDED REGION AT PEACE (${WAR_TURNS} turns)`);
console.log(`   start ${n(78)} -> end ${n(peace[peace.length - 1])}   (funding holds it up)`);

console.log("\n2. THE SAME REGION, WAR FOUGHT ACROSS IT");
for (const progress of [0.25, 0.5, 1]) {
  const war = run(WAR_TURNS, { frontProgress: progress });
  const end = war[war.length - 1];
  console.log(
    `   front moved ${(progress * 100).toFixed(0).padStart(3)}%: ` +
      `${n(78)} -> ${n(end).padStart(5)}   (${n(end - peace[peace.length - 1])} vs peace)`
  );
}

console.log("\n3. THE ARC OF A TOTAL WAR (front fully mobile)");
const total = run(WAR_TURNS, { frontProgress: 1 });
for (const t of [10, 25, 50, 75, 100, 130]) {
  console.log(`   turn ${String(t).padStart(3)}: ${n(total[t - 1])}`);
}

console.log("\n4. RECOVERY — the war ends at turn 130, funding continues");
let v = total[total.length - 1];
let b = v;
const recovery: number[] = [];
for (let t = 0; t < 200; t++) {
  b = roadConditionNode.compute!(ctxFor(b, v, undefined));
  v = v * INERTIA + b * (1 - INERTIA);
  recovery.push(v);
}
for (const t of [10, 50, 100, 200]) {
  console.log(`   +${String(t).padStart(3)} turns of peace: ${n(recovery[t - 1])}`);
}
console.log("");
