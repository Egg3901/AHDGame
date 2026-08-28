/**
 * Calibrating a passive arsenal accrual for planned-defence economies.
 *
 * RU and DD cannot use the defence-contract pipeline the arsenal is fed by, so their
 * stores sit empty and battle-destroyed equipment is never replaced. A flat per-turn
 * accrual has to clear three bars:
 *
 *   1. PEACETIME UPKEEP  - cover the drip of refit a resting army needs, so equipment
 *      does not decay when nobody is shooting.
 *   2. RECRUITMENT       - let a new formation be equipped in a reasonable span.
 *   3. WAR IS FINITE     - stay BELOW what a war actually consumes, so a long campaign
 *      still empties the stores.
 *
 *   npx tsx scripts/sim/stateArmsIndustry2026-08-28.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { lotsRequired, lotsToFillUnit, EQUIPMENT_TRACK_MAX } from "@/lib/military/arsenal";
import { getUnitArchetype } from "@/lib/constants/military";
import { stateArmsLotsPerTurn } from "@/lib/military/stateArmsIndustry";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const THEATER = "war_us_dd_415";
const eqAvg = (u: MilitaryUnit) =>
  ((u.equipment?.firepower ?? 0) + (u.equipment?.protection ?? 0) + (u.equipment?.support ?? 0)) /
  3;

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const all = (await db
      .collection("militaryUnits")
      .find({})
      .toArray()) as unknown as MilitaryUnit[];

    console.log("======== WHAT A FULL ROSTER COSTS, IN LOTS ========");
    console.log("(EQUIPMENT_TRACK_MAX = 3, so eqAvg 3.0 is fully equipped)\n");
    console.log("country  units  avg eq  % kitted   lots to FULLY equip   lots per unit");
    for (const c of ["RU", "DD", "US"]) {
      const us = all.filter((u) => String(u.countryId) === c);
      if (!us.length) continue;
      let lots = 0,
        full = 0;
      for (const u of us) {
        const arch = getUnitArchetype(u.domain, u.type);
        if (!arch) continue;
        const need = lotsRequired(arch as never);
        full += need;
        lots += lotsToFillUnit(u, need);
      }
      const avg = us.reduce((a, u) => a + eqAvg(u), 0) / us.length;
      console.log(
        `${c.padEnd(8)} ${String(us.length).padStart(5)}  ${avg.toFixed(2).padStart(6)}  ${((avg / EQUIPMENT_TRACK_MAX) * 100).toFixed(0).padStart(7)}%` +
          `   ${String(lots).padStart(19)}   ${(full / us.length).toFixed(1).padStart(13)}`
      );
    }

    // ---- what a turn of war costs, in lots ----
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const fronts = { [THEATER]: conflictToFront(conflict) };
    const inWar = all.filter((u) => u.theaterId === THEATER);
    const byC = new Map<string, MilitaryUnit[]>();
    for (const u of inWar)
      byC.set(String(u.countryId), [...(byC.get(String(u.countryId)) ?? []), u]);

    const mk = (c: string, side: "A" | "B") =>
      buildBattleSide(
        db,
        c,
        byC.get(c) ?? [],
        fronts,
        side === "A" ? conflict.supplyA : conflict.supplyB,
        side
      );
    const B = [await mk("DD", "B"), await mk("RU", "B")];
    const A = [await mk("US", "A")];

    console.log(
      "\n\n======== WHAT ONE BATTLE DESTROYS, IN LOTS (averaged over 40 seeds) ========\n"
    );
    for (const [label, att, def] of [
      ["DD+RU attacking", B, A],
      ["DD+RU defending", A, B],
    ] as const) {
      let lotsLost = 0;
      const N = 40;
      for (let s = 0; s < N; s++) {
        const r = resolvePvpBattle(att as never, def as never, THEATER, 1000 + s * 977);
        const results = label.startsWith("DD+RU attacking")
          ? r.attacker.unitResults
          : r.defender.unitResults;
        for (const ur of results) {
          const u = inWar.find((x) => String(x._id) === ur.id);
          if (!u) continue;
          const arch = getUnitArchetype(u.domain, u.type);
          if (!arch) continue;
          const need = lotsRequired(arch as never);
          // materiel is equipment TRACKS destroyed; convert that shortfall back to lots.
          // Measured against a FULLY EQUIPPED formation. A force already stripped to
          // 0.58 cannot lose what it does not have, which understates the burn rate a
          // stocked army would actually face.
          const full = {
            equipment: {
              firepower: EQUIPMENT_TRACK_MAX,
              protection: EQUIPMENT_TRACK_MAX,
              support: EQUIPMENT_TRACK_MAX,
            },
          };
          const after = {
            equipment: {
              firepower: Math.max(0, EQUIPMENT_TRACK_MAX - ur.materiel),
              protection: Math.max(0, EQUIPMENT_TRACK_MAX - ur.materiel),
              support: Math.max(0, EQUIPMENT_TRACK_MAX - ur.materiel),
            },
          };
          lotsLost += lotsToFillUnit(after as never, need) - lotsToFillUnit(full as never, need);
        }
      }
      console.log(
        `${label.padEnd(20)} ${(lotsLost / N).toFixed(1).padStart(7)} lots destroyed per battle`
      );
    }

    console.log("\n\n======== WHAT AN ACCRUAL RATE WOULD MEAN ========\n");
    const ruUnits = all.filter((u) => String(u.countryId) === "RU");
    let ruFullLots = 0;
    for (const u of ruUnits) {
      const arch = getUnitArchetype(u.domain, u.type);
      if (arch) ruFullLots += lotsToFillUnit(u, lotsRequired(arch as never));
    }
    console.log("rate/turn   turns to fully re-equip RU's current roster");
    for (const rate of [1, 2, 3, 4, 6, 8, 12]) {
      console.log(
        `${String(rate).padStart(9)}   ${String(Math.ceil(ruFullLots / rate)).padStart(44)}`
      );
    }

    console.log("\n\n======== THE CHOSEN RATES, RUN FORWARD ========");
    console.log(
      `RU ${stateArmsLotsPerTurn("RU")} lots/turn, DD ${stateArmsLotsPerTurn("DD")} lots/turn.`
    );
    console.log(
      "Reserve ceiling is one full re-equip of the roster, so peace banks a war stock.\n"
    );
    for (const c of ["RU", "DD"]) {
      const us = all.filter((u) => String(u.countryId) === c);
      let ceiling = 0;
      let shortfall = 0;
      for (const u of us) {
        const a = getUnitArchetype(u.domain, u.type);
        if (!a) continue;
        ceiling += lotsRequired(a as never);
        shortfall += lotsToFillUnit(u, lotsRequired(a as never));
      }
      const rate = stateArmsLotsPerTurn(c);
      console.log(
        `${c}: ${us.length} formations · reserve ceiling ${ceiling} lots · currently short ${shortfall}`
      );
      console.log(
        `    fully equipped in ${Math.ceil(shortfall / rate)} turns; full reserve a further ${Math.ceil(ceiling / rate)}` +
          `; a new formation kitted in ${Math.ceil(ceiling / Math.max(1, us.length) / rate)}`
      );
    }

    const sideRate = stateArmsLotsPerTurn("RU") + stateArmsLotsPerTurn("DD");
    console.log(
      `\nSide B produces ${sideRate} lots/turn between them. Against measured battle losses:\n`
    );
    console.log("war tempo                          burned/turn   net/turn   verdict");
    for (const [label, perTurn] of [
      ["quiet (a battle every 3 turns)", 2.5 / 3],
      ["the live war (one every 2)", 2.5 / 2],
      ["pressing (a battle every turn)", 2.5],
      ["both sides attacking each turn", 2.5 + 4.0],
    ] as [string, number][]) {
      const net = sideRate - perTurn;
      console.log(
        `${label.padEnd(34)} ${perTurn.toFixed(2).padStart(11)}   ${((net >= 0 ? "+" : "") + net.toFixed(2)).padStart(8)}   ${net >= 0 ? "sustainable" : "DRAINS"}`
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
