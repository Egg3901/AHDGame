/**
 * Naval and air repair: what the three new constants actually do.
 *
 * The trigger was ticket #1243, a defence secretary who could not blockade the DDR's
 * ports. Two causes: a conflict-status filter bug (fixed separately on
 * `fix/blockade-during-war`), and the fact that nothing in the game had ever restored
 * `integrity`. `engagement.ts` is its only writer and it only subtracts, so at turn 525
 * eleven hulls sat at zero permanently, including the UK's entire navy.
 *
 * This branch wires up the `REPAIR` block that has sat calibrated and unread in
 * `config.ts` since the subsystem was written, and adds three constants that ARE new:
 *
 *   FREE_REPAIR_CEILING   home 100 / allied 90 / station 80
 *   REPAIR_LOT_SHARE      0.5, the arsenal cost of mending a hull
 *   BLOCKADE.wornKnee     50, where lane pressure falls off faster than linear
 *
 * The "before" column is not produced by running this script on `development`, because
 * on `development` the answer to every question here is definitionally fixed: repair does
 * not exist, so recovery never happens and no lot is ever spent on it, and there is no
 * knee, so blockade pressure is the linear `integrityMult` alone. Those baselines are
 * computed inline instead, which is exact rather than measured.
 *
 * Read-only against the live world.
 *
 *   npx tsx scripts/sim/navalRepair2026-08-31.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import * as R from "@/lib/navair/config";
import {
  FREE_REPAIR_CEILING,
  freeRepairCeiling,
  repairedIntegrity,
  supplyScale,
} from "@/lib/navair/repair";
import { BLOCKADE, wornPenalty } from "@/lib/navair/blockade";
import { integrityMult } from "@/lib/navair/engineCore";
import {
  lotsRequired,
  lotsToRepair,
  lotsToFillUnit,
  REPAIR_LOT_SHARE,
} from "@/lib/military/arsenal";
import { getUnitArchetype } from "@/lib/constants/military";
import { WITHDRAW_INTEGRITY } from "@/lib/navair/missions";
import type { BasingKey } from "@/lib/navair/config";
import type { NavairUnit } from "@/lib/navair/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
if (!uri) throw new Error("Set MONGODB_URI_LIVE or MONGODB_URI in .env.local");

/** Turns for a formation to climb from `from` to its ceiling, or null if it never does. */
function turnsToRecover(
  from: number,
  basing: BasingKey,
  supply: number,
  resting: boolean
): number | null {
  let integrity = from;
  const unit = {
    integrity,
    supply,
    mission: resting ? "PORT" : "BLOCKADE",
    domain: "naval",
  } as unknown as NavairUnit;
  const ceiling = freeRepairCeiling(basing, resting);
  for (let turn = 1; turn <= 500; turn++) {
    const next = repairedIntegrity({ ...unit, integrity }, basing);
    if (next <= integrity) return null; // plateaued short of the ceiling
    integrity = next;
    if (integrity >= ceiling) return turn;
  }
  return null;
}

async function main(): Promise<void> {
  const client = new MongoClient(
    uri!.includes("directConnection")
      ? uri!
      : `${uri!}${uri!.includes("?") ? "&" : "?"}directConnection=true`
  );
  await client.connect();
  const db = client.db();

  const units = (await db
    .collection<MilitaryUnit>("militaryUnits")
    .find({ domain: { $in: ["naval", "air"] } })
    .toArray()) as unknown as NavairUnit[];
  const arsenals = await db.collection("nationalArsenal").find({}).toArray();
  const gs = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" });

  const out: string[] = [];
  const say = (line = "") => {
    out.push(line);
    console.log(line);
  };

  say(`# Naval repair simulation, turn ${gs?.currentTurn ?? "?"}`);
  say();
  say(
    `Constants under test: ceilings ${FREE_REPAIR_CEILING.home}/${FREE_REPAIR_CEILING.allied}/${FREE_REPAIR_CEILING.station}, REPAIR_LOT_SHARE ${REPAIR_LOT_SHARE}, wornKnee ${BLOCKADE.wornKnee}.`
  );
  say(
    `Existing calibration, unchanged: inPort ${R.REPAIR.inPort}, onStation ${R.REPAIR.onStation}, minSupply ${R.REPAIR.minSupply}.`
  );
  say();

  // ── Q1: time to recover ────────────────────────────────────────────────────
  say("## 1. Turns for a wreck to return to service");
  say();
  say("Before this branch: NEVER, at any supply, in any basing. That is the whole bug.");
  say();
  say("| basing | resting | supply | turns to ceiling | ceiling |");
  say("| --- | --- | --- | --- | --- |");
  for (const basing of ["home", "allied", "neutral"] as BasingKey[]) {
    for (const supply of [100, 75, 50, 40, 30]) {
      for (const resting of [true, false]) {
        const t = turnsToRecover(0, basing, supply, resting);
        const ceil = freeRepairCeiling(basing, resting);
        say(
          `| ${basing} | ${resting ? "yes" : "no"} | ${supply}% | ${t === null ? "never" : t} | ${ceil}% |`
        );
      }
    }
  }
  say();
  say(
    `Supply scaling: at ${R.REPAIR.minSupply}% or below, scale is 0 and nothing mends. This is why the withdraw rule matters: a front is exactly where supply is lowest, and a hull nudged off zero then sent back would plateau. Formations below ${WITHDRAW_INTEGRITY}% condition that the engine stationed are pulled home until seaworthy.`
  );
  say();

  // ── Q2: arsenal pressure ───────────────────────────────────────────────────
  say("## 2. Arsenal pressure: does repair starve refit?");
  say();
  say(
    "Lots each country's damaged naval and air formations would ask for, against what is in store. Repair draws first, so 'refit left' is what the existing sweep still sees."
  );
  say();
  say(
    "| country | store (naval/air) | hulls below ceiling | repair lots wanted | refit lots wanted | refit left |"
  );
  say("| --- | --- | --- | --- | --- | --- |");
  const byCountry = new Map<string, NavairUnit[]>();
  for (const u of units) {
    if (!byCountry.has(u.countryId)) byCountry.set(u.countryId, []);
    byCountry.get(u.countryId)!.push(u);
  }
  const rows: {
    c: string;
    repair: number;
    refit: number;
    store: number;
    n: number;
    naval: number;
    air: number;
  }[] = [];
  for (const [countryId, own] of byCountry) {
    const ars = arsenals.find((a) => a.countryId === countryId);
    const naval = (ars?.stock?.naval as number) ?? 0;
    const air = (ars?.stock?.air as number) ?? 0;
    let repair = 0;
    let refit = 0;
    let n = 0;
    for (const u of own) {
      const arch = getUnitArchetype(u.domain, u.type);
      if (!arch) continue;
      const full = lotsRequired(arch);
      // `<=`, matching `applyNavalRepair`: free repair parks a forward hull on exactly
      // the ceiling, and the paid tier has to be able to reach it there.
      if ((u.integrity ?? 100) <= FREE_REPAIR_CEILING.station) {
        repair += lotsToRepair(u, full);
        n++;
      }
      refit += lotsToFillUnit(u, full);
    }
    if (repair > 0 || refit > 0)
      rows.push({ c: countryId, repair, refit, store: naval + air, n, naval, air });
  }
  rows.sort((a, b) => b.repair - a.repair);
  for (const r of rows.slice(0, 20)) {
    say(
      `| ${r.c} | ${r.naval}/${r.air} | ${r.n} | ${r.repair} | ${r.refit} | ${Math.max(0, r.store - r.repair)} |`
    );
  }
  say();
  say(
    `Only formations at or below the ${FREE_REPAIR_CEILING.station}% station ceiling draw materiel at all: above it free repair reaches unaided, and a lot buys one point of condition there against a hundred at the bottom. Without that gate the sweep drains the store on scratches and starves refit, which runs immediately after it. At the ceiling exactly is deliberately included, because free repair parks every forward-deployed hull on precisely that number.`
  );
  say();

  // ── Q3: blockade strength ──────────────────────────────────────────────────
  say("## 3. Blockade pressure by hull condition");
  say();
  say(
    "Share of nominal lane pressure one hull applies. 'Linear only' is the behaviour before this branch, where `baseCv` already scaled by `integrityMult` and nothing else did."
  );
  say();
  say("| condition | linear only (before) | with knee (after) | change |");
  say("| --- | --- | --- | --- |");
  for (const i of [100, 80, 60, 50, 40, 25, 20, 10]) {
    const before = integrityMult(i);
    const after = integrityMult(i) * wornPenalty(i);
    say(
      `| ${i}% | ${(before * 100).toFixed(1)}% | ${(after * 100).toFixed(1)}% | ${before > 0 ? `${(((after - before) / before) * 100).toFixed(0)}%` : "n/a"} |`
    );
  }
  say();
  say(
    `The knee is at ${BLOCKADE.wornKnee}%, below the ${FREE_REPAIR_CEILING.station}% ceiling free repair reaches on station, so a fleet mending where it stands always climbs clear of the penalty band. If the knee were ever raised above that ceiling a blockade would become unrecoverable without going home, which is the trap this design exists to remove.`
  );
  say();

  // ── Q4: does the ceiling actually bite? ────────────────────────────────────
  say("## 4. How often the station ceiling binds");
  say();
  const damaged = units.filter((u) => (u.integrity ?? 100) < 100);
  const wrecked = units.filter((u) => (u.integrity ?? 100) <= 0);
  const belowKnee = units.filter((u) => (u.integrity ?? 100) < BLOCKADE.wornKnee);
  const inBand = units.filter((u) => {
    const i = u.integrity ?? 100;
    return i >= FREE_REPAIR_CEILING.station && i < 100;
  });
  say(`- naval and air formations in the world: ${units.length}`);
  say(`- damaged at all: ${damaged.length}`);
  say(`- at zero, unrecoverable before this branch: ${wrecked.length}`);
  say(`- below the worn knee, blockading badly: ${belowKnee.length}`);
  say(
    `- in the ${FREE_REPAIR_CEILING.station}-100% band where only a home port or materiel helps: ${inBand.length}`
  );
  say();
  say(
    `Live supply readings matter here: ${units.filter((u) => supplyScale(u.supply) <= 0).length} formations currently sit at or below ${R.REPAIR.minSupply}% supply, where free repair does nothing at all. Every one of those is either in a yard it should leave or holding water it cannot be sustained in.`
  );
  say();

  await client.close();

  const fs = await import("fs");
  const dir = path.resolve(process.cwd(), "scripts/sim/reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "naval-repair-2026-08-31.md"), out.join("\n"), "utf8");
  console.log("\nwritten: scripts/sim/reports/naval-repair-2026-08-31.md");
}

void main();
