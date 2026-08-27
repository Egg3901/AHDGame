/**
 * Combat balance, part three: the naval-on-a-landlocked-front hole, and whether the
 * casualty rate is sustainable at all.
 *
 *   npx tsx scripts/sim/combatBalance2026-08-27c.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, battleForecast } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import {
  terrainFactor,
  terrainFamilyOf,
  computeCard,
  recommendRole,
  TERRAIN,
} from "@/lib/military/combat";
import { computeEffectivePower } from "@/lib/constants/military";
import { ATTRITION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 400;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const front = conflictToFront(conflict);
    const fronts = { [THEATER]: front };
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all)
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);

    const family = terrainFamilyOf(front.terrain);
    console.log("======== THE FRONT ========");
    console.log(`terrain "${front.terrain}" -> family "${family}"`);
    console.log(
      `domain multipliers for that family: ${JSON.stringify(family ? TERRAIN[family].domain : {})}`
    );
    console.log(
      `  (compare maritime, which does bar ground: ${JSON.stringify(TERRAIN.maritime.domain)})`
    );
    console.log(
      `  (compare highland, which does bar naval: ${JSON.stringify(TERRAIN.highland.domain)})`
    );

    console.log("\n======== EVERY FORMATION AT THIS LAND FRONT ========");
    console.log("country | type | domain | role | men | effPower | terrainFactor");
    const navalDomains = new Set(["naval", "marine"]);
    const tally: Record<string, { power: number; men: number; n: number }> = {};
    for (const [c, us] of byCountry) {
      for (const u of us) {
        const tf = terrainFactor(front, u.domain, computeCard(u).traitKeys);
        const p = computeEffectivePower(u);
        console.log(
          `${c} | ${u.type} | ${u.domain} | ${recommendRole(u)} | ${num(u.personnel)} | ${num(p)} | ${tf.toFixed(2)}`
        );
        const k = `${c}::${navalDomains.has(u.domain) ? "SEA" : "land/air"}`;
        tally[k] ??= { power: 0, men: 0, n: 0 };
        tally[k].power += p;
        tally[k].men += u.personnel;
        tally[k].n++;
      }
    }
    console.log("\nSea power committed to a landlocked German front:");
    for (const [k, v] of Object.entries(tally).sort()) {
      console.log(
        `  ${k.padEnd(16)} ${v.n} units  ${num(v.men).padStart(8)} men  effPower ${num(v.power).padStart(5)}`
      );
    }

    const mk = (c: string, us: MilitaryUnit[], side: "A" | "B", sup: number, f = fronts) =>
      buildBattleSide(db, c, us, f, sup, side);

    const usUnits = byCountry.get("US") ?? [];
    const usLand = usUnits.filter((u) => !navalDomains.has(u.domain));
    const DD = await mk("DD", byCountry.get("DD") ?? [], "B", conflict.supplyB);
    const usAll = await mk("US", usUnits, "A", conflict.supplyA);
    const usNoSea = await mk("US", usLand, "A", conflict.supplyA);

    console.log("\n\n======== WHAT THE NAVY IS WORTH ON DRY LAND ========");
    const fAll = battleForecast([DD], [usAll], THEATER);
    const fLand = battleForecast([DD], [usNoSea], THEATER);
    console.log(
      `US defence WITH its fleet  : ${usUnits.length} units, power ${num(fAll.defStr)}, DD's odds ${fAll.oddsPct}%`
    );
    console.log(
      `US defence LAND+AIR only   : ${usLand.length} units, power ${num(fLand.defStr)}, DD's odds ${fLand.oddsPct}%`
    );
    console.log(
      `=> the fleet supplies ${pct(1 - fLand.defStr / fAll.defStr)} of the US defensive power at a front it cannot reach.`
    );

    const run = (
      label: string,
      att: Parameters<typeof resolvePvpBattle>[0],
      def: Parameters<typeof resolvePvpBattle>[1]
    ) => {
      let w = 0,
        aL = 0,
        dL = 0;
      for (let i = 0; i < SEEDS; i++) {
        const r = resolvePvpBattle(att, def, THEATER, i * 7919 + 13);
        if (r.win) w++;
        aL += r.attacker.loss;
        dL += r.defender.loss;
      }
      console.log(
        `  ${label.padEnd(34)} DD win ${pct(w / SEEDS).padStart(6)}  DD dead ${num(aL / SEEDS).padStart(6)}  US dead ${num(dL / SEEDS).padStart(6)}`
      );
    };
    run("vs US with fleet", [DD], [usAll]);
    run("vs US land+air only", [DD], [usNoSea]);

    console.log("\n  counterfactual: temperate given naval 0.60, the value highland already uses");
    const patched = { ...TERRAIN.temperate.domain } as Record<string, number>;
    TERRAIN.temperate.domain = { ...patched, naval: 0.6 };
    const usPatched = await mk("US", usUnits, "A", conflict.supplyA);
    const ddPatched = await mk("DD", byCountry.get("DD") ?? [], "B", conflict.supplyB);
    const fp = battleForecast([ddPatched], [usPatched], THEATER);
    console.log(
      `  US power would fall ${num(fAll.defStr)} -> ${num(fp.defStr)}, DD odds ${fAll.oddsPct}% -> ${fp.oddsPct}%`
    );
    run("vs US with fleet at naval 0.60", [ddPatched], [usPatched]);
    TERRAIN.temperate.domain = patched;

    console.log("\n\n======== CAN THE LOSSES BE REPLACED? ========");
    console.log(
      `ATTRITION.trainedFillRatio=${ATTRITION.trainedFillRatio} conscriptFillRatio=${ATTRITION.conscriptFillRatio}` +
        `  (share of ESTABLISHMENT refilled per turn)`
    );
    for (const [c, us] of byCountry) {
      const men = us.reduce((a, u) => a + u.personnel, 0);
      // Establishment is the unit's full table; personnel is what is actually present.
      const est = us.reduce((a, u) => a + (u.establishment ?? u.personnel), 0);
      let dead = 0;
      const enemy = c === "US" ? [DD] : [usAll];
      const own = await mk(
        c,
        us,
        c === "US" ? "A" : "B",
        c === "US" ? conflict.supplyA : conflict.supplyB
      );
      for (let i = 0; i < SEEDS; i++) {
        dead += resolvePvpBattle([own], enemy, THEATER, i * 7919 + 13).attacker.loss;
      }
      dead /= SEEDS;
      const refillTrained = est * ATTRITION.trainedFillRatio;
      const refillConscript = est * ATTRITION.conscriptFillRatio;
      console.log(
        `${c}: ${num(men)} men present, establishment ${num(est)}` +
          `\n    losses attacking ~${num(dead)}/engagement` +
          `\n    refill  trained ${num(refillTrained)}/turn (${(refillTrained / dead).toFixed(2)}x losses)` +
          ` · conscript ${num(refillConscript)}/turn (${(refillConscript / dead).toFixed(2)}x losses)`
      );
    }

    console.log("\n\n======== MANPOWER POOL CEILING ========");
    console.log(
      `pool cap = population x ${ATTRITION.manpowerPoolCapFraction}, regen = population x ${ATTRITION.manpowerRegenFraction}/turn`
    );
    for (const c of ["DD", "US", "RU"]) {
      const cc = await db.collection("countries").findOne({ _id: c as never });
      const pop = (cc as unknown as { population?: number })?.population;
      if (!pop) {
        console.log(`  ${c}: population not on the country doc`);
        continue;
      }
      console.log(
        `  ${c}: pop ${num(pop)} -> pool cap ${num(pop * ATTRITION.manpowerPoolCapFraction)}, ` +
          `regen ${num(pop * ATTRITION.manpowerRegenFraction)}/turn`
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
