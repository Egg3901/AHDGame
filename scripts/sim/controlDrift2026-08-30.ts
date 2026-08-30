/**
 * Control drift: how fast does the last quarter of a war move?
 *
 * The balance report for removing `OCCUPATION.deepPushMult`. Two arms, same engine,
 * same seeds, same real formations off a live front, walked from the war's starting
 * pole all the way to the far pole:
 *
 *   BEFORE  the step halves once the winner's ABSOLUTE share of the host reaches
 *           `deepPushDepth` (the deep-push drag this change removes)
 *   AFTER   `occupationShift` as it now stands: margin, retreat yield, clamp
 *
 * Both arms keep the supply drag: each step re-derives both sides' supply from the
 * front's distance from its start (`derivedSupplies`) and fights the next battle at
 * that supply, exactly as `applyOccupation` writes it and `resolvePvpBattle` reads it.
 * So the difference between the arms is the halving and nothing else.
 *
 * Each campaign is one attacking side pressing offensives until the front reaches a
 * pole or the campaign cap is hit. The defender fights every engagement; a defensive
 * win pushes the line back by the same rule. Per campaign we count offensives to the
 * pole, offensives spent in the last quarter of the track, and the dead on each side.
 *
 * Why the halving bit harder than "half pace": it keyed on the WINNER's share, so past
 * the three-quarter mark the attacker's wins were halved while the defender's were
 * not. On a near-even front that is not a slowdown, it is a wall: the line drifts
 * back toward the three-quarter mark faster than it advances past it. The BEFORE arm
 * reports how many campaigns reach the pole at all, not only how long it took.
 *
 *   npx tsx scripts/sim/controlDrift2026-08-30.ts            # run the report
 *   npx tsx scripts/sim/controlDrift2026-08-30.ts --list     # list live theaters
 *   SIM_THEATER=<conflictId> SIM_CAMPAIGNS=200 npx tsx scripts/sim/controlDrift2026-08-30.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildCoalitionSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import {
  derivedSupplies,
  occupationShift,
  shareOf,
  type Side,
  type ShiftInput,
} from "@/lib/military/occupation";
import { OCCUPATION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = process.env.SIM_THEATER ?? "war_us_dd_415";
/** Campaigns per arm. Each is up to `CAP` full engagements on ~100 live formations. */
const CAMPAIGNS = Number(process.env.SIM_CAMPAIGNS ?? 120);
/** Offensives before a campaign is abandoned as making no progress. */
const CAP = 400;
/** The halving this change removed, reproduced here so the BEFORE arm is exact. */
const LEGACY_DEEP_PUSH_MULT = 0.5;

const num = (x: number) => x.toFixed(1);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** `occupationShift` as it stood before this change. */
function legacyShift(input: ShiftInput): number {
  const { control, winner, margin, loserRetreated } = input;
  let shift = Math.min(1, Math.abs(margin) / OCCUPATION.decisiveMargin) * OCCUPATION.maxShift;
  if (loserRetreated) shift *= OCCUPATION.retreatYield;
  if (shareOf(control, winner) >= OCCUPATION.deepPushDepth) shift *= LEGACY_DEEP_PUSH_MULT;
  const next = winner === "B" ? control + shift : control - shift;
  return Math.max(0, Math.min(100, next));
}

interface Campaign {
  /** Offensives until the front reached the attacker's pole; `CAP` if it never did. */
  toPole: number;
  /** Offensives fought while the attacker held at least three quarters of the host. */
  lastQuarter: number;
  /** Offensives fought before the attacker held three quarters of the host. */
  firstThreeQuarters: number;
  reachedPole: boolean;
  attackerDead: number;
  defenderDead: number;
  attackerWins: number;
  /** Lowest attacker supply seen on the way, so the supply drag is visible in the log. */
  minAttackerSupply: number;
  /** Where the front stood when the campaign ended: the pole, or wherever the cap hit. */
  finalControl: number;
}

function quantiles(xs: number[]): { p25: number; p50: number; p75: number; mean: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return {
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length),
  };
}

function runCampaign(
  attacker: BattleSide[],
  defender: BattleSide[],
  attackerSide: Side,
  controlStart: number,
  shift: (input: ShiftInput) => number,
  seed: number
): Campaign {
  let control = controlStart;
  const out: Campaign = {
    toPole: CAP,
    lastQuarter: 0,
    firstThreeQuarters: 0,
    reachedPole: false,
    attackerDead: 0,
    defenderDead: 0,
    attackerWins: 0,
    minAttackerSupply: 100,
    finalControl: controlStart,
  };
  const pole = attackerSide === "A" ? 0 : 100;
  for (let i = 0; i < CAP; i++) {
    // Supply follows the front, exactly as `applyOccupation` derives it after a write.
    const { supplyA, supplyB } = derivedSupplies({
      control,
      controlStart,
      supplyA: OCCUPATION.supplyNeutral,
      supplyB: OCCUPATION.supplyNeutral,
      supplyBaseA: OCCUPATION.supplyNeutral,
      supplyBaseB: OCCUPATION.supplyNeutral,
    });
    const attSupply = attackerSide === "A" ? supplyA : supplyB;
    const defSupply = attackerSide === "A" ? supplyB : supplyA;
    out.minAttackerSupply = Math.min(out.minAttackerSupply, attSupply);
    const att = attacker.map((s) => ({ ...s, conflictSupply: attSupply }));
    const def = defender.map((s) => ({ ...s, conflictSupply: defSupply }));

    const r = resolvePvpBattle(att, def, THEATER, seed * 100_003 + i * 7919 + 13);
    out.attackerDead += r.attacker.loss;
    out.defenderDead += r.defender.loss;
    if (r.win) out.attackerWins++;

    const deep = shareOf(control, attackerSide) >= OCCUPATION.deepPushDepth;
    if (deep) out.lastQuarter++;
    else out.firstThreeQuarters++;

    const winner: Side = r.win ? attackerSide : attackerSide === "A" ? "B" : "A";
    control = shift({ control, winner, margin: r.margin, loserRetreated: !!r.retreat });
    out.finalControl = control;
    if (control === pole) {
      out.toPole = i + 1;
      out.reachedPole = true;
      break;
    }
  }
  return out;
}

function report(label: string, runs: Campaign[], attackerSide: Side) {
  const finished = runs.filter((r) => r.reachedPole);
  const stalled = runs.filter((r) => !r.reachedPole);
  // Over every campaign, a stalled one counted at the cap. This is the honest pace
  // figure: quoting only the campaigns that finished would flatter an arm in which
  // almost none did.
  const toPoleAll = quantiles(runs.map((r) => r.toPole));
  const toPole = quantiles(finished.map((r) => r.toPole));
  const last = quantiles(finished.map((r) => r.lastQuarter));
  const first = quantiles(finished.map((r) => r.firstThreeQuarters));
  const attDead = quantiles(finished.map((r) => r.attackerDead));
  const defDead = quantiles(finished.map((r) => r.defenderDead));
  const winRate = quantiles(runs.map((r) => r.attackerWins / Math.max(1, r.toPole)));
  const minSupply = quantiles(runs.map((r) => r.minAttackerSupply));
  const stalledHeld = quantiles(stalled.map((r) => shareOf(r.finalControl, attackerSide)));
  console.log(`\n== ${label} ==`);
  console.log(
    `  campaigns ${runs.length}, reached the pole ${finished.length} (${pct(finished.length / runs.length)}), cap ${CAP}`
  );
  console.log(
    `  offensives to the pole, all campaigns (stalled = cap)   p25 ${num(toPoleAll.p25)}  median ${num(toPoleAll.p50)}  p75 ${num(toPoleAll.p75)}`
  );
  if (stalled.length) {
    console.log(
      `  stalled campaigns: attacker held at the cap   p25 ${pct(stalledHeld.p25)}  median ${pct(stalledHeld.p50)}  p75 ${pct(stalledHeld.p75)}`
    );
  }
  console.log(`  over the ${finished.length} campaigns that reached the pole:`);
  console.log(
    `    offensives to the pole    p25 ${num(toPole.p25)}  median ${num(toPole.p50)}  p75 ${num(toPole.p75)}  mean ${num(toPole.mean)}`
  );
  console.log(
    `    first three quarters      p25 ${num(first.p25)}  median ${num(first.p50)}  p75 ${num(first.p75)}  mean ${num(first.mean)}`
  );
  console.log(
    `    last quarter              p25 ${num(last.p25)}  median ${num(last.p50)}  p75 ${num(last.p75)}  mean ${num(last.mean)}`
  );
  console.log(
    `    dead per campaign         attacker median ${Math.round(attDead.p50).toLocaleString("en-US")}   defender median ${Math.round(defDead.p50).toLocaleString("en-US")}`
  );
  console.log(
    `  attacker win rate           median ${pct(winRate.p50)}   lowest attacker supply median ${num(minSupply.p50)}`
  );
  return { toPole, toPoleAll, last, first, finished: finished.length };
}

async function listTheaters(db: Db) {
  const conflicts = (await db
    .collection("conflicts")
    .find(
      {},
      {
        projection: {
          status: 1,
          type: 1,
          hostCountry: 1,
          control: 1,
          controlStart: 1,
          sideA: 1,
          sideB: 1,
        },
      }
    )
    .toArray()) as unknown as ConflictDoc[];
  for (const c of conflicts) {
    const units = await db.collection("militaryUnits").countDocuments({ theaterId: String(c._id) });
    console.log(
      `${String(c._id).padEnd(28)} ${String(c.status).padEnd(14)} ${String(c.type).padEnd(10)} host ${String(c.hostCountry).padEnd(6)} ` +
        `control ${String(c.control).padStart(5)} start ${String(c.controlStart ?? "-").padStart(5)}  ` +
        `A ${c.sideA.countries.join("+")}  B ${c.sideB.countries.join("+")}  units ${units}`
    );
  }
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    if (process.argv.includes("--list")) {
      await listTheaters(db);
      return;
    }
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc | null;
    if (!conflict) {
      console.error(`No conflict ${THEATER}. Run with --list to see live theaters.`);
      process.exit(1);
    }
    const fronts = { [THEATER]: conflictToFront(conflict) };
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all) {
      const list = byCountry.get(String(u.countryId)) ?? [];
      list.push(u);
      byCountry.set(String(u.countryId), list);
    }
    // Sides are built once at neutral supply; each step overrides `conflictSupply`,
    // which is the only per-step input `resolvePvpBattle` reads from the side.
    const sideA = await buildCoalitionSide(
      db,
      conflict.sideA.countries,
      byCountry,
      fronts,
      undefined,
      "A"
    );
    const sideB = await buildCoalitionSide(
      db,
      conflict.sideB.countries,
      byCountry,
      fronts,
      undefined,
      "B"
    );

    // The attacker is the side the live front has moved toward, so the replay presses
    // the campaign that is actually being fought. On an untouched front it is whoever
    // does NOT hold the starting pole: the invader.
    const controlStart = conflict.controlStart ?? conflict.control;
    const attackerSide: Side =
      conflict.control > controlStart
        ? "B"
        : conflict.control < controlStart
          ? "A"
          : controlStart >= 50
            ? "A"
            : "B";
    const attacker = attackerSide === "A" ? sideA : sideB;
    const defender = attackerSide === "A" ? sideB : sideA;

    console.log(
      `theater ${THEATER}: host ${conflict.hostCountry}, control ${conflict.control}, start ${controlStart}`
    );
    console.log(
      `  side A ${conflict.sideA.countries.join("+")} (${sideA.reduce((n, s) => n + s.units.length, 0)} formations)  ` +
        `side B ${conflict.sideB.countries.join("+")} (${sideB.reduce((n, s) => n + s.units.length, 0)} formations)`
    );
    console.log(
      `  attacker: side ${attackerSide}, pressing from control ${controlStart} toward ${attackerSide === "A" ? 0 : 100}`
    );
    console.log(
      `  OCCUPATION: maxShift ${OCCUPATION.maxShift}, decisiveMargin ${OCCUPATION.decisiveMargin}, retreatYield ${OCCUPATION.retreatYield}, ` +
        `deepPushDepth ${OCCUPATION.deepPushDepth}; BEFORE arm halves past that depth, AFTER arm does not`
    );

    const before: Campaign[] = [];
    const after: Campaign[] = [];
    for (let seed = 0; seed < CAMPAIGNS; seed++) {
      before.push(runCampaign(attacker, defender, attackerSide, controlStart, legacyShift, seed));
      after.push(
        runCampaign(attacker, defender, attackerSide, controlStart, occupationShift, seed)
      );
    }
    const b = report("BEFORE: deep-push halving in place", before, attackerSide);
    const a = report("AFTER: halving removed (this change)", after, attackerSide);

    console.log("\n== Delta (AFTER vs BEFORE) ==");
    console.log(
      `  campaigns reaching the pole                     ${b.finished}/${before.length} -> ${a.finished}/${after.length}`
    );
    console.log(
      `  offensives to the pole, all campaigns, median   ${num(b.toPoleAll.p50)} -> ${num(a.toPoleAll.p50)}`
    );
    console.log("  over the campaigns that reached the pole (medians):");
    console.log(
      `    offensives to the pole   ${num(b.toPole.p50)} -> ${num(a.toPole.p50)}  (${pct(a.toPole.p50 / Math.max(1, b.toPole.p50) - 1)})`
    );
    console.log(
      `    first three quarters     ${num(b.first.p50)} -> ${num(a.first.p50)}  (${pct(a.first.p50 / Math.max(1, b.first.p50) - 1)})`
    );
    console.log(
      `    last quarter             ${num(b.last.p50)} -> ${num(a.last.p50)}  (${pct(a.last.p50 / Math.max(1, b.last.p50) - 1)})`
    );
    console.log(
      `    last quarter as a share of the campaign   ${pct(b.last.p50 / Math.max(1, b.toPole.p50))} -> ${pct(a.last.p50 / Math.max(1, a.toPole.p50))}`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
