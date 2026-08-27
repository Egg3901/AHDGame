/**
 * Naval reach: what a carrier/escort split actually does to the live German front.
 *
 * `combatValue` is linear in `basePower` (effPower -> basePower x posture x tech x vet
 * x equipment x strengthRatio), so scaling basePower by a reach factor is an exact
 * stand-in for a multiplicative factor on the unit's contribution. That lets this
 * measure candidate numbers without editing the engine.
 *
 *   npx tsx scripts/sim/navalReachOptions.ts
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
import { occupationShift } from "@/lib/military/occupation";
import { computeCard } from "@/lib/military/combat";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 500;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** True for the one naval hull that can put ordnance well inland: the carrier air wing. */
const isCarrier = (u: MilitaryUnit) =>
  u.domain === "naval" && computeCard(u).traitKeys.includes("strategic");

/** Apply a candidate reach rule by scaling basePower, which cv is linear in. */
function withReach(units: MilitaryUnit[], carrier: number, escort: number): MilitaryUnit[] {
  return units.map((u) => {
    if (u.domain !== "naval") return u;
    const f = isCarrier(u) ? carrier : escort;
    return { ...u, basePower: u.basePower * f };
  });
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
    const us = all.filter((u) => String(u.countryId) === "US");
    const dd = all.filter((u) => String(u.countryId) === "DD");

    console.log("US naval formations at this front, classified:");
    for (const u of us.filter((x) => x.domain === "naval")) {
      console.log(
        `  ${isCarrier(u) ? "CARRIER" : "escort "}  ${u.type.padEnd(26)} ${String(u.personnel).padStart(6)} men`
      );
    }

    const ddSide = await buildBattleSide(db, "DD", dd, fronts, conflict.supplyB, "B");

    async function scenario(label: string, carrier: number, escort: number) {
      const side = await buildBattleSide(
        db,
        "US",
        withReach(us, carrier, escort),
        fronts,
        conflict.supplyA,
        "A"
      );
      const f = battleForecast([ddSide], [side], THEATER);
      let w = 0,
        ddDead = 0,
        usDead = 0,
        gain = 0;
      for (let i = 0; i < SEEDS; i++) {
        const r = resolvePvpBattle([ddSide], [side], THEATER, i * 7919 + 13);
        if (r.win) w++;
        ddDead += r.attacker.loss;
        usDead += r.defender.loss;
        const next = occupationShift({
          control: 50,
          winner: r.win ? "B" : "A",
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });
        gain += r.win ? next - 50 : -(50 - next);
      }
      const net = gain / SEEDS;
      console.log(
        `${label.padEnd(38)} US power ${num(f.defStr).padStart(5)}  ` +
          `DD odds ${String(f.oddsPct).padStart(3)}%  DD win ${pct(w / SEEDS).padStart(6)}  ` +
          `net ground ${net >= 0 ? "+" : ""}${net.toFixed(2).padStart(5)}  ` +
          `DD dead ${num(ddDead / SEEDS).padStart(6)}  US dead ${num(usDead / SEEDS).padStart(5)}`
      );
    }

    console.log("\n======== GERMANY IS COASTAL (DD and DE both hold a naval branch) ========\n");
    await scenario("today: no naval rule at all", 1.0, 1.0);
    await scenario("coastal  carrier 1.00 escort 0.50", 1.0, 0.5);
    await scenario("coastal  carrier 1.00 escort 0.35", 1.0, 0.35);
    await scenario("coastal  carrier 0.90 escort 0.40", 0.9, 0.4);

    console.log(
      "\n======== THE SAME FLEET AT AN INLAND FRONT (e.g. a Czechoslovak war) ========\n"
    );
    await scenario("inland   carrier 0.55 escort 0.12", 0.55, 0.12);
    await scenario("inland   carrier 0.45 escort 0.10", 0.45, 0.1);
    console.log("\nfor reference, the blunt instrument from the first report:");
    await scenario("flat naval 0.60, carrier included", 0.6, 0.6);
    await scenario("fleet removed entirely", 0.0, 0.0);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
